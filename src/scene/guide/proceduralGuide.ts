// The guide, built in code from Cassidy's painting (blender/reference/guide-reference.png)
// until the Blender model exists.
//
// Likeness pass: a sculpted, hand-painted face (brow creases, nose-bridge
// wrinkles, cheek folds, the long serene mouth and big tan lower lip), closed
// eyes drawn as lines, the turquoise third eye under the cuff, a mane of
// layered shaggy fur strands, the tall slouchy burnt-orange beanie leaning to
// his right, corduroy dungarees, gold hoops and pendant, and big peach feet.
//
// It is built to the same contract as the Blender character (bone names,
// eyesClosed / smile morphs, third_eye material), so the animator, camera and
// story code drive the real model unchanged.

import {
  LatheGeometry, Vector2, AdditiveBlending, CapsuleGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, TubeGeometry, CatmullRomCurve3,
  Vector3, type BufferGeometry, type Material, type Object3D,
} from 'three';
import { BONES } from './contract';
import {
  PALETTE, corduroyTexture, faceTexture, furTexture, furToonGradient, glowTexture, knitTexture, outlineMaterial, thirdEyeTexture, toon,
} from './toon';
import { bump, frontPoint, sculptEllipsoid, smoothstep, type Deform, type V3 } from './sculpt';
import { furPatch } from './fur';
import { buildProceduralClips } from './proceduralClips';
import type { GuideModel } from './types';

/** Rest positions relative to the parent bone (standing pose), metres. Eyes are placed on the face below. */
export const REST: Record<string, V3> = {
  root: [0, 0, 0],
  hips: [0, 0.6, 0],
  spine: [0, 0.11, 0],
  chest: [0, 0.19, 0],
  neck: [0, 0.1, 0.01],
  head: [0, 0.04, 0],
  eye_L: [0.08, 0.176, 0.17],
  eye_R: [-0.08, 0.176, 0.17],
  beanie: [0, 0.41, -0.01],
  upperarm_L: [0.21, 0.13, 0],
  forearm_L: [0, -0.22, 0],
  hand_L: [0, -0.2, 0],
  fingers_L: [0, -0.08, 0],
  thumb_L: [0, -0.03, 0.04],
  upperarm_R: [-0.21, 0.13, 0],
  forearm_R: [0, -0.22, 0],
  hand_R: [0, -0.2, 0],
  fingers_R: [0, -0.08, 0],
  thumb_R: [0, -0.03, 0.04],
  thigh_L: [0.11, -0.03, 0],
  shin_L: [0, -0.25, 0],
  foot_L: [0, -0.2, 0],
  thigh_R: [-0.11, -0.03, 0],
  shin_R: [0, -0.25, 0],
  foot_R: [0, -0.2, 0],
};

// ── face: a sculpted mask, front-projected texture ───────────
const FACE_C = new Vector3(0, 0.165, 0.09);
const FACE_R: V3 = [0.21, 0.22, 0.115];
const faceDeform: Deform = (u) => {
  const f = Math.max(0, u.z);
  const x = u.x, y = u.y;
  const dz = f * (
    1.0 * bump(x, y, 0, -0.42, 0.42, 0.13) // broad chimp muzzle
    + 0.26 * bump(0, y, 0, 0.2, 1, 0.012) * (1 - x * x) // brow ridge
    - 0.24 * bump(Math.abs(x), y, 0.42, 0.03, 0.025, 0.018) // eye sockets
    + 0.16 * bump(x, y, 0, -0.15, 0.012, 0.007) // flat nose
    + 0.42 * bump(x, y, 0, -0.66, 0.24, 0.035) // big lower lip
  );
  const dx = -x * (0.06 * smoothstep(0.1, -0.95, y) + 0.14 * smoothstep(0.3, 0.95, y)); // narrower forehead, slightly narrower chin
  const dy = -0.12 * Math.max(0, y) ** 2.5; // flatter top under the cuff
  return [dx, dy, dz];
};
/** A point on the face surface at unit coords (x, y), in head space, nudged out by `out`. */
const onFace = (x: number, y: number, out = 0) => {
  const p = frontPoint(FACE_R, faceDeform, x, y).add(FACE_C);
  const n = new Vector3(x / FACE_R[0], y / FACE_R[1], Math.sqrt(Math.max(0, 1 - x * x - y * y)) / FACE_R[2]).normalize();
  return { p: p.addScaledVector(n, out), n };
};

const mats = {
  fur: toon('#ffffff', { map: furTexture(), gradientMap: furToonGradient() }),
  face: toon('#ffffff', { map: faceTexture() }),
  skin: toon(PALETTE.face),
  skinShade: toon(PALETTE.faceShade),
  lash: new MeshBasicMaterial({ color: PALETTE.lash }),
  mouth: new MeshBasicMaterial({ color: PALETTE.mouth }),
  nostril: new MeshBasicMaterial({ color: '#4a2016' }),
  hat: toon('#ffffff', { map: knitTexture('#d9461a') }),
  hatShade: toon('#ffffff', { map: knitTexture(PALETTE.hatShade, 'rgba(110, 24, 4, 0.35)') }),
  cuff: toon('#ffffff', { side: DoubleSide, map: (() => { const t = knitTexture('#ef5f1c', 'rgba(140, 32, 4, 0.75)', true); t.repeat.set(14, 1); return t; })() }),
  dungarees: toon('#ffffff', { map: corduroyTexture() }),
  gold: toon(PALETTE.gold, { emissive: PALETTE.goldDeep, emissiveIntensity: 0.3 }),
  eyeWhite: toon(PALETTE.eyeWhite),
  iris: new MeshBasicMaterial({ color: PALETTE.iris }),
  glint: new MeshBasicMaterial({ color: '#ffffff' }),
};
mats.gold.name = 'gold_jewellery';

interface PartOpts { p?: V3 | Vector3; r?: V3; s?: V3; q?: Quaternion; outline?: number; name?: string }
function part(parent: Object3D, geo: BufferGeometry, mat: Material, o: PartOpts = {}) {
  const m = new Mesh(geo, mat);
  if (o.name) m.name = o.name;
  if (o.p) { if (Array.isArray(o.p)) m.position.set(...o.p); else m.position.copy(o.p); }
  if (o.r) m.rotation.set(...o.r);
  if (o.q) m.quaternion.copy(o.q);
  if (o.s) m.scale.set(...o.s);
  parent.add(m);
  if (o.outline) {
    const avg = o.s ? (o.s[0] + o.s[1] + o.s[2]) / 3 : 1;
    const hull = new Mesh(geo, outlineMaterial(o.outline / avg));
    hull.name = `${m.name || 'part'}__outline`;
    hull.userData.isOutline = true;
    m.add(hull);
  }
  return m;
}
const ell = (rx: number, ry: number, rz: number, seg: [number, number] = [28, 20]) => sculptEllipsoid({ radii: [rx, ry, rz], segments: seg });
const capsule = (r: number, len: number) => new CapsuleGeometry(r, len, 6, 14);

// ── eyelids: one geometry, rotated open / closed, as a morph target ──
function rotatedX(src: ArrayLike<number>, angle: number) {
  const out = new Float32Array(src.length);
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < src.length; i += 3) {
    const y = src[i + 1], z = src[i + 2];
    out[i] = src[i];
    out[i + 1] = y * c - z * s;
    out[i + 2] = y * s + z * c;
  }
  return out;
}
function withLidMorph(geo: BufferGeometry, open: number, closed: number) {
  const pos = Float32Array.from(geo.getAttribute('position').array as ArrayLike<number>);
  const nrm = Float32Array.from(geo.getAttribute('normal').array as ArrayLike<number>);
  geo.setAttribute('position', new Float32BufferAttribute(rotatedX(pos, open), 3));
  geo.setAttribute('normal', new Float32BufferAttribute(rotatedX(nrm, open), 3));
  geo.morphAttributes.position = [new Float32BufferAttribute(rotatedX(pos, closed), 3)];
  geo.morphAttributes.normal = [new Float32BufferAttribute(rotatedX(nrm, closed), 3)];
  return geo;
}
const LID_R = 0.033;
const OPEN = -0.95, CLOSED = 0.42;
function eyelids(name: string, head: Object3D, p: Vector3) {
  const flat: V3 = [1.15, 0.9, 0.62];
  const lid = part(head, withLidMorph(new SphereGeometry(LID_R, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), OPEN, CLOSED), mats.skin, { p, s: flat, name });
  lid.morphTargetDictionary = { eyesClosed: 0 };
  lid.morphTargetInfluences = [0];
  const lash = part(head, withLidMorph(new TorusGeometry(LID_R * 1.01, 0.0058, 5, 24, Math.PI).rotateX(Math.PI / 2), OPEN, CLOSED), mats.lash, { p, s: flat, name: `${name}_lash` });
  lash.morphTargetDictionary = { eyesClosed: 0 };
  lash.morphTargetInfluences = [0];
  // lower lid: fixed, meets the upper lid's closed edge
  part(head, new SphereGeometry(LID_R * 0.99, 20, 6, 0, Math.PI * 2, Math.PI * 0.64, Math.PI * 0.36), mats.skin, { p, s: flat });
}

/** Mouth: a long, calm line across the muzzle; the "smile" morph lifts its corners. */
function mouthGeometry() {
  const make = (a: number) => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const x = -0.58 + (i / 20) * 1.16;
      pts.push(onFace(x, -0.4 + a * x * x, 0.002).p);
    }
    return new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.006, 6, false);
  };
  const calm = make(-0.5);
  const smile = make(0.55);
  calm.morphAttributes.position = [smile.getAttribute('position')];
  return calm;
}

export function buildProceduralGuide(): GuideModel {
  const bones: Record<string, Object3D> = {};
  const all = [...BONES.required, 'beanie'];
  for (const name of all) {
    const node = new Group();
    node.name = name;
    node.position.set(...(REST[name] ?? [0, 0, 0]));
    bones[name] = node;
  }
  // eyes sit in their sockets on the sculpted face
  for (const s of ['L', 'R'] as const) {
    const { p } = onFace(s === 'L' ? 0.42 : -0.42, 0.03, -0.006);
    bones[`eye_${s}`].position.copy(p);
  }
  for (const name of all) {
    bones[name].userData.rest = bones[name].position.clone();
    const parent = BONES.parents[name];
    if (parent && bones[parent]) bones[parent].add(bones[name]);
  }
  const b = bones;
  const O = 0.005;

  // ── head ──────────────────────────────────────────────────
  const h = b.head;
  // skull + mane, shallow at the front so the face sits proud of it
  part(h, ell(0.28, 0.26, 0.16), mats.fur, { p: [0, 0.15, -0.04], outline: O });
  // mane bulging beside the cheeks, and the beard under the chin
  for (const s of [1, -1]) part(h, ell(0.11, 0.12, 0.1), mats.fur, { p: [s * 0.22, 0.06, -0.01], outline: O });
  part(h, ell(0.15, 0.08, 0.085), mats.fur, { p: [0, -0.1, 0.03], outline: O });
  // face
  part(h, sculptEllipsoid({ radii: FACE_R, segments: [64, 48], deform: faceDeform }), mats.face, { p: FACE_C, outline: 0.003, name: 'face' });
  // nose: soft tip and two dark nostrils
  const nose = onFace(0, -0.15, 0.004);
  part(h, ell(0.024, 0.012, 0.008), mats.skinShade, { p: nose.p.clone().add(new Vector3(0, -0.006, -0.002)) });
  for (const s of [1, -1]) part(h, ell(0.01, 0.006, 0.004), mats.nostril, { p: nose.p.clone().add(new Vector3(s * 0.012, -0.01, 0.003)) });
  // mouth
  const mouth = part(h, mouthGeometry(), mats.mouth, { name: 'mouth' });
  mouth.morphTargetDictionary = { smile: 0 };
  mouth.morphTargetInfluences = [0];
  // eyes: small, set in the sockets; closed lids read as drawn lines
  for (const s of ['L', 'R'] as const) {
    const eye = b[`eye_${s}`];
    part(eye, new SphereGeometry(0.026, 18, 14), mats.eyeWhite, { s: [1, 0.85, 0.62] });
    part(eye, new SphereGeometry(0.016, 16, 10), mats.iris, { p: [0, 0, 0.0095], s: [1, 1, 0.5] });
    part(eye, new SphereGeometry(0.0028, 8, 6), mats.glint, { p: [0.005, 0.005, 0.0168] });
    eyelids(`lid_${s}`, h, eye.position.clone());
  }
  // third eye, centred on the forehead under the cuff, glowing as he wakes
  const third = onFace(0, 0.47, 0.004);
  const qThird = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), third.n);
  const thirdEyeMat = new MeshBasicMaterial({ map: thirdEyeTexture(), transparent: true, alphaTest: 0.1 });
  thirdEyeMat.name = 'third_eye';
  part(h, new PlaneGeometry(0.072, 0.045), thirdEyeMat, { p: third.p, q: qThird, name: 'third_eye' });
  const glow = part(h, new PlaneGeometry(0.2, 0.2), new MeshBasicMaterial({
    map: glowTexture('140,240,230'), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, side: DoubleSide,
  }), { p: third.p.clone().addScaledVector(third.n, 0.004), q: qThird, name: 'third_eye_glow' });
  glow.renderOrder = 2;

  // ears: big peach C-shapes, gold hoops (three on his right lobe, a big one on his left)
  for (const s of [1, -1]) {
    const ear = part(h, ell(0.034, 0.088, 0.07), mats.skin, { p: [s * 0.3, 0.1, -0.01], r: [0, s * 0.55, s * -0.12], outline: 0.004 });
    part(ear, ell(0.02, 0.06, 0.045), mats.skinShade, { p: [s * 0.014, -0.004, 0.006] });
    const hoops: [V3, number][] = s < 0
      ? [[[-0.31, 0.045, 0.02], 0.016], [[-0.315, 0.06, 0.03], 0.015], [[-0.318, 0.077, 0.035], 0.014], [[-0.305, 0.16, 0.035], 0.015]]
      : [[[0.31, 0.03, 0.02], 0.026], [[0.318, 0.075, 0.035], 0.014], [[0.31, 0.155, 0.035], 0.013]];
    for (const [p, r] of hoops) part(h, new TorusGeometry(r * 1.3, 0.0058, 6, 22), mats.gold, { p, r: [0, Math.PI / 2 + s * 0.3, 0] });
  }
  // fur: mane around the face, beard, spikes at the hairline
  const faceZone = (u: Vector3) => u.z > 0.25 && Math.abs(u.x) < 0.62 && u.y > -0.45 && u.y < 0.9;
  furPatch(h, {
    center: [0, 0.15, -0.04], radii: [0.28, 0.26, 0.16], count: 520, length: [0.035, 0.07], width: 0.028, lift: 0.4, seed: 11,
    keep: (u) => !faceZone(u) && u.y < 0.62,
    flow: (p) => new Vector3(p.x - FACE_C.x, (p.y - FACE_C.y) - 0.1, p.z - FACE_C.z),
  });
  for (const s of [1, -1]) {
    furPatch(h, {
      center: [s * 0.22, 0.06, -0.01], radii: [0.11, 0.12, 0.1], count: 130, length: [0.04, 0.075], width: 0.028, lift: 0.45, seed: 12 + s,
      keep: (u) => u.x * s > -0.3,
      flow: () => new Vector3(s * 0.8, -1, 0),
    });
  }
  furPatch(h, { center: [0, -0.1, 0.03], radii: [0.15, 0.08, 0.085], count: 190, length: [0.04, 0.08], width: 0.026, lift: 0.3, seed: 14, keep: (u) => u.y < 0.2 });
  furPatch(h, {
    center: [0, 0.36, 0.0], radii: [0.21, 0.05, 0.13], count: 70, length: [0.025, 0.05], width: 0.02, lift: 1.1, seed: 15,
    keep: (u) => u.z > 0 && Math.abs(u.x) > 0.35, flow: () => new Vector3(0, 1, 0.2),
  });

  // ── beanie: oversized, slouchy, leaning to his right, ribbed cuff ──
  const hat = b.beanie;
  hat.rotation.set(-0.2, 0, 0.07);
  const crownDeform: Deform = (u) => {
    const up = Math.max(0, u.y);
    return [-0.5 * up ** 1.3, -0.2 * up * Math.max(0, u.x + 0.2), 0.05 * up];
  };
  part(hat, sculptEllipsoid({ radii: [0.19, 0.17, 0.185], segments: [40, 24], thetaLength: Math.PI * 0.5, deform: crownDeform }), mats.hat, { p: [0, 0.05, -0.008], outline: O });
  part(hat, ell(0.1, 0.07, 0.11), mats.hat, { p: [-0.15, 0.13, -0.01], r: [0, 0, 0.75], outline: O });
  // the slouch hanging down behind his right ear
  part(hat, ell(0.085, 0.2, 0.12), mats.hatShade, { p: [-0.2, -0.12, -0.04], r: [0.1, 0, 0.2], outline: O });
  // ribbed cuff across the forehead
  const band = new LatheGeometry([
    new Vector2(0.2, -0.056), new Vector2(0.219, -0.05), new Vector2(0.226, -0.025), new Vector2(0.227, 0.025),
    new Vector2(0.221, 0.05), new Vector2(0.2, 0.058),
  ], 64);
  part(hat, band, mats.cuff, { outline: O });

  // ── torso, dungarees, pendant ────────────────────────────
  part(b.hips, ell(0.17, 0.1, 0.15), mats.dungarees, { p: [0, 0.02, 0], outline: O });
  for (const s of [1, -1]) part(b.hips, ell(0.065, 0.075, 0.09), mats.dungarees, { p: [s * 0.22, 0.07, -0.02], outline: O });
  part(b.spine, ell(0.22, 0.17, 0.18), mats.fur, { p: [0, 0.06, 0.01], outline: O });
  part(b.spine, sculptEllipsoid({ radii: [0.115, 0.12, 0.04], segments: [24, 16] }), mats.dungarees, { p: [0, 0.09, 0.17], outline: 0.003 });
  part(b.chest, ell(0.27, 0.18, 0.2), mats.fur, { p: [0, 0.07, -0.01], outline: O });
  for (const s of [1, -1]) part(b.chest, ell(0.12, 0.12, 0.12), mats.fur, { p: [s * 0.22, 0.12, -0.01], outline: O });
  for (const s of [1, -1]) {
    part(b.chest, capsule(0.013, 0.27), mats.dungarees, { p: [s * 0.1, 0.11, 0.15], r: [-0.42, 0, s * -0.04], s: [1, 1, 0.5] });
  }
  part(b.chest, new CylinderGeometry(0.021, 0.021, 0.007, 22), mats.gold, { p: [0, 0.07, 0.2], r: [Math.PI / 2 + 0.3, 0, 0], outline: 0.002 });
  part(b.chest, new TorusGeometry(0.075, 0.0025, 4, 28, Math.PI), mats.gold, { p: [0, 0.135, 0.15], r: [-0.5, 0, Math.PI] });

  const bib = (u: Vector3) => u.z > 0.6 && Math.abs(u.x) < 0.45 && u.y > -0.6 && u.y < 0.55;
  furPatch(b.spine, { center: [0, 0.06, 0.01], radii: [0.22, 0.17, 0.18], count: 170, length: [0.04, 0.08], width: 0.03, seed: 21, keep: (u) => !bib(u) });
  furPatch(b.chest, { center: [0, 0.07, -0.01], radii: [0.25, 0.17, 0.19], count: 200, length: [0.045, 0.09], width: 0.03, seed: 22, keep: (u) => !(u.z > 0.55 && Math.abs(u.x) < 0.45 && u.y < 0.2) });
  for (const s of [1, -1]) furPatch(b.chest, { center: [s * 0.21, 0.12, -0.01], radii: [0.11, 0.11, 0.11], count: 70, length: [0.05, 0.09], width: 0.03, seed: 23 + s, flow: () => new Vector3(s * 0.4, -1, 0) });

  // ── arms: thick and furry, big peach hands ───────────────
  for (const s of ['L', 'R'] as const) {
    const ua = b[`upperarm_${s}`], fa = b[`forearm_${s}`];
    part(ua, capsule(0.094, 0.12), mats.fur, { p: [0, -0.11, 0], outline: O });
    part(fa, capsule(0.086, 0.12), mats.fur, { p: [0, -0.1, 0], outline: O });
    furPatch(ua, { center: [0, -0.11, 0], radii: [0.098, 0.16, 0.098], count: 150, length: [0.05, 0.09], width: 0.03, seed: s === 'L' ? 31 : 32 });
    furPatch(fa, { center: [0, -0.1, 0], radii: [0.09, 0.15, 0.09], count: 140, length: [0.05, 0.09], width: 0.03, seed: s === 'L' ? 33 : 34 });
    part(b[`hand_${s}`], ell(0.045, 0.062, 0.058), mats.skin, { p: [0, -0.045, 0], outline: 0.004 });
    part(b[`fingers_${s}`], capsule(0.03, 0.06), mats.skin, { p: [0, -0.045, 0], s: [0.75, 1, 1.5], outline: 0.004 });
    part(b[`thumb_${s}`], capsule(0.02, 0.035), mats.skin, { p: [0, -0.02, 0.005], r: [0.5, 0, 0], outline: 0.003 });
  }

  // ── legs: wide crossed base, big peach feet with toes ────
  for (const s of ['L', 'R'] as const) {
    const sx = s === 'L' ? 1 : -1;
    const th = b[`thigh_${s}`], sh = b[`shin_${s}`], ft = b[`foot_${s}`];
    part(th, capsule(0.105, 0.14), mats.fur, { p: [0, -0.12, 0], outline: O });
    part(sh, capsule(0.085, 0.12), mats.fur, { p: [0, -0.1, 0], outline: O });
    furPatch(th, { center: [0, -0.12, 0], radii: [0.11, 0.17, 0.11], count: 140, length: [0.05, 0.1], width: 0.032, seed: s === 'L' ? 41 : 42 });
    furPatch(sh, { center: [0, -0.1, 0], radii: [0.09, 0.15, 0.09], count: 110, length: [0.05, 0.09], width: 0.03, seed: s === 'L' ? 43 : 44 });
    part(ft, ell(0.07, 0.045, 0.13), mats.skin, { p: [0, -0.03, 0.07], outline: 0.004 });
    part(ft, ell(0.05, 0.03, 0.07), mats.skinShade, { p: [0, -0.06, 0.06] });
    for (let i = 0; i < 4; i++) {
      part(ft, ell(0.02, 0.018, 0.024, [12, 10]), mats.skin, { p: [sx * (0.035 - i * 0.022), -0.04, 0.19 - Math.abs(i - 1.5) * 0.012], outline: 0.003 });
    }
    part(ft, ell(0.026, 0.022, 0.03, [12, 10]), mats.skin, { p: [sx * -0.07, -0.03, 0.12], outline: 0.003 });
  }

  const clips = buildProceduralClips(bones);
  const wrapper = new Group();
  wrapper.name = 'guide';
  wrapper.add(bones.root);

  return {
    kind: 'procedural',
    object: wrapper,
    clips,
    dispose() {
      wrapper.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
}
