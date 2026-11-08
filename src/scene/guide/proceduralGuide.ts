// Stand-in guide built from primitives, used until the Blender GLB exists.
//
// It is deliberately built to the same contract as the Blender character:
// nodes named after contract bones, eyesClosed / smile morph targets, a
// "third_eye" material. So the animator, camera and flight code are already
// the code that will drive the real model. Swapping in the GLB changes data,
// not code.

import {
  BufferGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, Object3D, PlaneGeometry, SphereGeometry, TorusGeometry, type Material, AdditiveBlending,
  DoubleSide,
} from 'three';
import { BONES } from './contract';
import { PALETTE, glowTexture, outlineMaterial, ribTexture, thirdEyeTexture, toon } from './toon';
import { buildProceduralClips } from './proceduralClips';
import type { GuideModel } from './types';

type V3 = [number, number, number];

/** Rest positions (relative to the parent bone), standing pose, metres. */
export const REST: Record<string, V3> = {
  root: [0, 0, 0],
  hips: [0, 0.56, 0],
  spine: [0, 0.09, 0],
  chest: [0, 0.16, 0],
  neck: [0, 0.15, 0],
  head: [0, 0.04, 0],
  eye_L: [0.066, 0.2, 0.19],
  eye_R: [-0.066, 0.2, 0.19],
  beanie: [0, 0.22, -0.03],
  upperarm_L: [0.175, 0.1, 0],
  forearm_L: [0, -0.2, 0],
  hand_L: [0, -0.19, 0],
  fingers_L: [0, -0.07, 0],
  thumb_L: [0, -0.03, 0.035],
  upperarm_R: [-0.175, 0.1, 0],
  forearm_R: [0, -0.2, 0],
  hand_R: [0, -0.19, 0],
  fingers_R: [0, -0.07, 0],
  thumb_R: [0, -0.03, 0.035],
  thigh_L: [0.1, -0.03, 0],
  shin_L: [0, -0.2, 0],
  foot_L: [0, -0.17, 0],
  thigh_R: [-0.1, -0.03, 0],
  shin_R: [0, -0.2, 0],
  foot_R: [0, -0.17, 0],
};

const mats = {
  fur: toon(PALETTE.fur),
  furLight: toon(PALETTE.furLight),
  face: toon(PALETTE.face),
  faceShade: toon(PALETTE.faceShade),
  mouth: new MeshBasicMaterial({ color: PALETTE.mouth }),
  hat: toon(PALETTE.hat),
  overalls: toon(PALETTE.overalls),
  gold: toon(PALETTE.gold, { emissive: PALETTE.goldDeep, emissiveIntensity: 0.25 }),
  eyeWhite: toon(PALETTE.eyeWhite),
  iris: new MeshBasicMaterial({ color: PALETTE.iris }),
  glint: new MeshBasicMaterial({ color: '#ffffff' }),
  nostril: new MeshBasicMaterial({ color: PALETTE.ink }),
};

interface PartOpts { p?: V3; r?: V3; s?: V3; outline?: number; name?: string }

function part(parent: Object3D, geo: BufferGeometry, mat: Material, o: PartOpts = {}) {
  const m = new Mesh(geo, mat);
  if (o.name) m.name = o.name;
  if (o.p) m.position.set(...o.p);
  if (o.r) m.rotation.set(...o.r);
  if (o.s) m.scale.set(...o.s);
  m.castShadow = false;
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

const sphere = (r: number, w = 20, h = 14) => new SphereGeometry(r, w, h);
const capsule = (r: number, len: number) => new CapsuleGeometry(r, len, 6, 14);

/** Rotate positions/normals of a geometry about X (in place copy). */
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

/** Morph between an open and a closed rotation of the same geometry. */
function withEyelidMorph(geo: BufferGeometry, openAngle: number, closedAngle: number) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const basePos = Float32Array.from(pos.array as ArrayLike<number>);
  const baseNrm = Float32Array.from(nrm.array as ArrayLike<number>);
  geo.setAttribute('position', new Float32BufferAttribute(rotatedX(basePos, openAngle), 3));
  geo.setAttribute('normal', new Float32BufferAttribute(rotatedX(baseNrm, openAngle), 3));
  geo.morphAttributes.position = [new Float32BufferAttribute(rotatedX(basePos, closedAngle), 3)];
  geo.morphAttributes.normal = [new Float32BufferAttribute(rotatedX(baseNrm, closedAngle), 3)];
  return geo;
}

function eyelid(name: string, parent: Object3D, p: V3) {
  const OPEN = -0.62, CLOSED = 1.32;
  const lid = withEyelidMorph(new SphereGeometry(0.04, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), OPEN, CLOSED);
  const lidMesh = part(parent, lid, mats.face, { p, name });
  lidMesh.morphTargetDictionary = { eyesClosed: 0 };
  lidMesh.morphTargetInfluences = [0];
  // lash line riding the lid's rim
  const lash = withEyelidMorph(new TorusGeometry(0.0405, 0.0045, 5, 20, Math.PI).rotateX(Math.PI / 2), OPEN, CLOSED);
  const lashMesh = part(parent, lash, mats.mouth, { p, name: `${name}_lash` });
  lashMesh.morphTargetDictionary = { eyesClosed: 0 };
  lashMesh.morphTargetInfluences = [0];
  // fixed lower lid
  part(parent, new SphereGeometry(0.0395, 18, 6, 0, Math.PI * 2, Math.PI * 0.78, Math.PI * 0.22), mats.faceShade, { p });
}

/** Mouth arc with a "smile" morph. Both shapes share topology. */
function mouthGeometry() {
  const make = (radius: number, arc: number) => {
    const g = new TorusGeometry(radius, 0.0065, 6, 24, arc);
    g.rotateZ(-Math.PI / 2 - arc / 2);
    g.translate(0, radius, 0);
    const a = g.getAttribute('position');
    for (let i = 0; i < a.count; i++) a.setZ(i, a.getZ(i) - a.getX(i) ** 2 * 5); // wrap round the muzzle
    g.computeVertexNormals();
    return g;
  };
  const neutral = make(0.32, 0.36);
  const smile = make(0.075, 1.75);
  neutral.morphAttributes.position = [smile.getAttribute('position')];
  return neutral;
}

function tuft(parent: Object3D, p: V3, r: V3, size = 1) {
  part(parent, new ConeGeometry(0.03 * size, 0.08 * size, 5), mats.fur, { p, r, outline: 0.004 });
}

export function buildProceduralGuide(): GuideModel {
  const bones: Record<string, Object3D> = {};
  const all = [...BONES.required, 'beanie'];
  for (const name of all) {
    const node = new Group();
    node.name = name;
    node.position.set(...(REST[name] ?? [0, 0, 0]));
    node.userData.rest = node.position.clone();
    bones[name] = node;
  }
  for (const name of all) {
    const parent = BONES.parents[name];
    if (parent && bones[parent]) bones[parent].add(bones[name]);
  }
  const root = bones.root;
  const b = bones;
  const O = 0.006;

  // ── torso ────────────────────────────────────────────────
  part(b.hips, sphere(0.16), mats.overalls, { p: [0, 0, 0], s: [1.15, 0.75, 0.95], outline: O });
  part(b.spine, sphere(0.17), mats.fur, { p: [0, 0.06, 0.005], s: [1.1, 1, 0.95], outline: O });
  part(b.chest, sphere(0.18), mats.fur, { p: [0, 0.05, 0], s: [1.22, 0.9, 0.9], outline: O });
  for (const x of [0.16, -0.16]) part(b.chest, sphere(0.085), mats.fur, { p: [x, 0.1, 0], outline: O });
  // dungarees: bib + straps
  part(b.spine, capsule(0.085, 0.08), mats.overalls, { p: [0, 0.11, 0.152], s: [1.15, 1, 0.3], outline: 0.004 });
  for (const x of [0.075, -0.075]) {
    part(b.chest, new CapsuleGeometry(0.016, 0.2, 3, 6), mats.overalls, { p: [x, 0.07, 0.135], r: [-0.3, 0, x > 0 ? -0.1 : 0.1], s: [1, 1, 0.5] });
  }
  // gold pendant on a thin chain
  part(b.chest, new CylinderGeometry(0.024, 0.024, 0.008, 22), mats.gold, { p: [0, 0.105, 0.172], r: [Math.PI / 2 + 0.25, 0, 0], outline: 0.003 });
  part(b.chest, new TorusGeometry(0.075, 0.0028, 4, 28, Math.PI), mats.gold, { p: [0, 0.18, 0.115], r: [-0.55, 0, Math.PI] });
  // shaggy silhouette
  for (const [x, y, z, rz] of [[0.2, 0.14, 0, -1.2], [-0.2, 0.14, 0, 1.2], [0.2, 0.0, 0.02, -1.6], [-0.2, 0.0, 0.02, 1.6]] as const) tuft(b.chest, [x, y, z], [0, 0, rz], 1.2);
  for (const [x, rz] of [[0.17, -1.9], [-0.17, 1.9]] as const) tuft(b.spine, [x, 0.02, 0.04], [0, 0, rz], 1.1);

  // ── head ─────────────────────────────────────────────────
  const h = b.head;
  part(h, sphere(0.2, 24, 18), mats.fur, { p: [0, 0.2, -0.03], s: [1.08, 1, 1], outline: O });
  for (const x of [0.13, -0.13]) part(h, sphere(0.1), mats.fur, { p: [x, 0.12, 0.05], outline: O });
  part(h, sphere(0.08), mats.fur, { p: [0, 0.035, 0.1], s: [1.45, 0.85, 1], outline: O });
  for (const [x, rz] of [[0.2, -1.7], [-0.2, 1.7], [0.17, -2.3], [-0.17, 2.3]] as const) tuft(h, [x, 0.1, 0.07], [0, 0, rz]);
  tuft(h, [0.04, -0.03, 0.12], [0.3, 0, 2.9], 1.2);
  tuft(h, [-0.04, -0.03, 0.12], [0.3, 0, -2.9], 1.2);
  // face
  part(h, sphere(0.14, 24, 16), mats.face, { p: [0, 0.2, 0.115], s: [1.2, 1.1, 0.52], outline: 0.004 });
  part(h, capsule(0.03, 0.12), mats.face, { p: [0, 0.246, 0.185], r: [0, 0, Math.PI / 2], s: [1, 1, 0.9], outline: 0.003 });
  part(h, sphere(0.12, 24, 16), mats.face, { p: [0, 0.088, 0.16], s: [1.15, 0.8, 0.75], outline: 0.004 });
  part(h, sphere(0.028), mats.faceShade, { p: [0, 0.158, 0.236], s: [1.5, 0.7, 0.7] });
  for (const x of [0.014, -0.014]) part(h, sphere(0.0075, 8, 6), mats.nostril, { p: [x, 0.152, 0.252] });
  // brow and cheek creases from the painting
  for (const x of [0.05, -0.05]) part(h, new TorusGeometry(0.05, 0.0035, 4, 12, 1.4), mats.faceShade, { p: [x, 0.13, 0.215], r: [0, x > 0 ? 0.35 : -0.35, x > 0 ? -2.1 : -0.35 - 0.7] });
  const mouth = part(h, mouthGeometry(), mats.mouth, { p: [0, 0.062, 0.247], name: 'mouth' });
  mouth.morphTargetDictionary = { smile: 0 };
  mouth.morphTargetInfluences = [0];
  // ears with gold hoops
  for (const side of [1, -1]) {
    const ear = part(h, sphere(0.092), mats.face, { p: [side * 0.215, 0.18, -0.01], r: [0, side * 0.45, side * -0.15], s: [0.35, 1, 0.85], outline: 0.004 });
    part(ear, sphere(0.055), mats.faceShade, { p: [side * 0.03, 0, 0.005], s: [0.5, 0.85, 0.75] });
    const hoops: V3[] = side > 0 ? [[0.228, 0.122, 0.005], [0.226, 0.108, -0.02]] : [[-0.228, 0.122, 0.005], [-0.222, 0.255, 0.0], [-0.226, 0.1, -0.02]];
    for (const p of hoops) part(h, new TorusGeometry(0.019, 0.0042, 6, 18), mats.gold, { p, r: [0, Math.PI / 2, 0] });
  }
  // eyes (the eye bones rotate; lids stay with the head)
  for (const side of ['L', 'R'] as const) {
    const eye = b[`eye_${side}`];
    part(eye, sphere(0.036, 18, 14), mats.eyeWhite);
    part(eye, sphere(0.025, 16, 10), mats.iris, { p: [0, 0, 0.026], s: [1, 1, 0.55] });
    part(eye, sphere(0.0065, 8, 6), mats.glint, { p: [0.008, 0.009, 0.0395] });
    eyelid(`lid_${side}`, h, REST[`eye_${side}`]);
  }
  // third eye, glowing as he wakes
  const thirdEyeMat = new MeshBasicMaterial({ map: thirdEyeTexture(), transparent: true, alphaTest: 0.1 });
  thirdEyeMat.name = 'third_eye';
  part(h, new PlaneGeometry(0.085, 0.053), thirdEyeMat, { p: [0, 0.282, 0.192], r: [-0.4, 0, 0], name: 'third_eye' });
  const glow = new Mesh(new PlaneGeometry(0.22, 0.22), new MeshBasicMaterial({
    map: glowTexture('140,240,230'), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, side: DoubleSide,
  }));
  glow.name = 'third_eye_glow';
  glow.position.set(0, 0.286, 0.2);
  glow.rotation.x = -0.42;
  h.add(glow);
  // beanie: crown, slouch and ribbed cuff, worn tipped back and to one side
  const hat = b.beanie;
  hat.rotation.set(-0.5, 0, -0.12);
  part(hat, new SphereGeometry(0.2, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.hat, { p: [0, 0.085, -0.01], s: [1.04, 1.05, 1.06], outline: O });
  part(hat, sphere(0.12), mats.hat, { p: [-0.03, 0.2, -0.06], s: [1.1, 0.95, 1], outline: O });
  part(hat, new TorusGeometry(0.192, 0.042, 10, 40), toon('#ffffff', { map: ribTexture() }), { p: [0, 0.085, -0.01], r: [Math.PI / 2, 0, 0], outline: O });

  // ── arms ─────────────────────────────────────────────────
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    part(b[`upperarm_${side}`], capsule(0.062, 0.12), mats.fur, { p: [0, -0.1, 0], outline: O });
    tuft(b[`upperarm_${side}`], [sx * 0.055, -0.1, 0], [0, 0, sx * -1.7]);
    part(b[`forearm_${side}`], capsule(0.056, 0.12), mats.fur, { p: [0, -0.1, 0], outline: O });
    tuft(b[`forearm_${side}`], [0, 0.0, -0.055], [-1.9, 0, 0]);
    part(b[`hand_${side}`], sphere(0.052), mats.face, { p: [0, -0.04, 0], s: [0.62, 1, 0.95], outline: 0.004 });
    part(b[`fingers_${side}`], capsule(0.027, 0.05), mats.face, { p: [0, -0.04, 0], s: [0.75, 1, 1.45], outline: 0.004 });
    part(b[`thumb_${side}`], capsule(0.019, 0.03), mats.face, { p: [0, -0.02, 0.005], r: [0.5, 0, 0], outline: 0.003 });
  }

  // ── legs and big peach feet ─────────────────────────────
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    part(b[`thigh_${side}`], capsule(0.076, 0.1), mats.fur, { p: [0, -0.1, 0], outline: O });
    part(b[`thigh_${side}`], new CylinderGeometry(0.084, 0.082, 0.07, 16), mats.overalls, { p: [0, -0.035, 0], outline: 0.004 });
    tuft(b[`thigh_${side}`], [sx * 0.07, -0.12, 0], [0, 0, sx * -1.6]);
    part(b[`shin_${side}`], capsule(0.062, 0.08), mats.fur, { p: [0, -0.08, 0], outline: O });
    const foot = b[`foot_${side}`];
    part(foot, sphere(0.056), mats.face, { p: [0, -0.03, 0.05], s: [1.05, 0.62, 1.75], outline: 0.004 });
    for (let i = 0; i < 4; i++) part(foot, sphere(0.018, 10, 8), mats.face, { p: [sx * (0.03 - i * 0.02) * -1, -0.04, 0.138 - Math.abs(i - 1.5) * 0.008], outline: 0.003 });
    part(foot, sphere(0.022, 10, 8), mats.face, { p: [sx * -0.055, -0.03, 0.085], outline: 0.003 });
  }

  const clips = buildProceduralClips(bones);
  root.name = 'root';
  const wrapper = new Group();
  wrapper.name = 'guide';
  wrapper.add(root);

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
