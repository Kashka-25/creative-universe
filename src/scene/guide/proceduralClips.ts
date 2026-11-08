// Blocking-pass animation for the stand-in guide, authored as key poses.
//
// Poses use the contract's bone names. Limbs can be posed by direction
// ("aim", in the character's own space: +X his left, +Y up, +Z towards the
// camera) which is far easier to read than chains of Euler angles. Clips are
// baked to ordinary three.js AnimationClips, the same thing a Blender export
// produces, so everything downstream is shared.

import {
  Matrix4, AnimationClip, Euler, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Vector3,
  VectorKeyframeTrack, type Object3D,
} from 'three';
import { BONES } from './contract';

type V3 = [number, number, number];
/** r: Euler degrees. aim: limb direction. toes/top: orient a foot by where its toes and its top face. */
export interface BonePose { r?: V3; aim?: V3; twist?: number; p?: V3; toes?: V3; top?: V3 }
export type Pose = Record<string, BonePose>;
type Morphs = Partial<Record<'eyesClosed' | 'smile', number>>;
interface Key { t: number; pose: Pose; morph?: Morphs; ease?: 'inOut' | 'in' | 'out' | 'linear' }

const D = Math.PI / 180;
const DOWN = new Vector3(0, -1, 0);
const Y = new Vector3(0, 1, 0);

/** Contract bones, parents before children. */
const ORDER: string[] = (() => {
  const all = [...BONES.required, ...BONES.optional];
  const out: string[] = [];
  const visit = (b: string) => {
    if (out.includes(b)) return;
    const p = BONES.parents[b];
    if (p) visit(p);
    out.push(b);
  };
  all.forEach(visit);
  return out;
})();

const merge = (...poses: Pose[]): Pose => {
  const out: Pose = {};
  for (const p of poses) for (const [k, v] of Object.entries(p)) out[k] = { ...out[k], ...v };
  return out;
};
const both = (l: BonePose, mirrorX = true): Pose => {
  const m = (v?: V3): V3 | undefined => (v ? [mirrorX ? -v[0] : v[0], v[1], v[2]] : undefined);
  return { L: l, R: { ...l, aim: m(l.aim), r: l.r ? [l.r[0], -l.r[1], -l.r[2]] : undefined, twist: l.twist !== undefined ? -l.twist : undefined } };
};
/** Pose both sides from the left side's values (mirrored). */
const sym = (bone: string, l: BonePose): Pose => {
  const s = both(l);
  return { [`${bone}_L`]: s.L, [`${bone}_R`]: s.R };
};
const curl = (deg: number, side: 'L' | 'R' | 'both' = 'both'): Pose => {
  const p: Pose = {};
  if (side !== 'R') p.fingers_L = { r: [0, 0, -deg] };
  if (side !== 'L') p.fingers_R = { r: [0, 0, deg] };
  return p;
};

// ── key poses ──────────────────────────────────────────────
const SEATED: Pose = merge(
  { hips: { p: [0, 0.27, 0] }, spine: { r: [4, 0, 0] }, chest: { r: [2, 0, 0] }, neck: { r: [2, 0, 0] }, head: { r: [8, 0, 0] } },
  sym('thigh', { aim: [0.9, -0.1, 0.42] }),
  { shin_L: { aim: [-0.9, -0.1, 0.42] }, shin_R: { aim: [0.88, -0.24, 0.41] } },
  { foot_L: { toes: [-0.45, -0.7, 0.55], top: [0, 0.35, -0.9] }, foot_R: { toes: [0.45, -0.7, 0.55], top: [0, 0.35, -0.9] } },
  sym('upperarm', { aim: [0.2, -0.95, 0.24] }),
  sym('forearm', { aim: [-0.6, -0.25, 0.76], twist: 70 }),
  curl(30),
);
const AWAKE: Pose = merge(SEATED, { spine: { r: [3, 0, 0] }, chest: { r: [-2, 0, 0] }, neck: { r: [0, 0, 0] }, head: { r: [-2, 0, 0] } });
const BECKON: Pose = merge(AWAKE, {
  chest: { r: [-3, -6, 0] },
  head: { r: [-2, 4, -5] },
  upperarm_R: { aim: [-0.6, -0.12, 0.79] },
  forearm_R: { aim: [-0.12, 0.74, 0.66], twist: -150 },
  hand_R: { r: [-15, 0, 0] },
});
const CROUCH: Pose = merge(AWAKE, {
  hips: { p: [0, 0.285, 0.03] }, spine: { r: [22, 0, 0] }, chest: { r: [12, 0, 0] }, neck: { r: [-6, 0, 0] }, head: { r: [-14, 0, 0] },
}, sym('upperarm', { aim: [0.32, -0.92, -0.05] }), sym('forearm', { aim: [0.12, -0.96, 0.18], twist: 0 }), curl(5));
const LIFT: Pose = merge(AWAKE, {
  hips: { p: [0, 0.42, 0.06], r: [25, 0, 0] }, spine: { r: [8, 0, 0] }, chest: { r: [0, 0, 0] }, neck: { r: [-8, 0, 0] }, head: { r: [-18, 0, 0] },
}, sym('thigh', { aim: [0.2, -0.85, 0.45] }), sym('shin', { aim: [0.1, -0.95, -0.25] }), sym('foot', { r: [20, 0, 0] }),
  sym('upperarm', { aim: [0.75, 0.25, 0.3] }), sym('forearm', { aim: [0.6, 0.5, 0.4], twist: 0 }), curl(10));
const FLY: Pose = merge({
  hips: { p: [0, 0.5, 0], r: [70, 0, 0] }, spine: { r: [-4, 0, 0] }, chest: { r: [-6, 0, 0] }, neck: { r: [-22, 0, 0] }, head: { r: [-36, 0, 0] },
  thigh_L: { aim: [0.12, -0.32, -0.94] }, thigh_R: { aim: [-0.12, -0.25, -0.96] },
  shin_L: { aim: [0.08, 0.05, -1] }, shin_R: { aim: [-0.08, 0.12, -0.99] },
  upperarm_R: { aim: [-0.2, 0.35, 0.92] }, forearm_R: { aim: [-0.1, 0.3, 0.95], twist: -90 },
  upperarm_L: { aim: [0.4, -0.35, -0.85] }, forearm_L: { aim: [0.3, -0.15, -0.94], twist: 0 },
}, sym('foot', { r: [35, 0, 0] }), curl(70, 'R'), curl(20, 'L'));

// ── clips ──────────────────────────────────────────────────
const CLIPS: { name: string; duration: number; loop: boolean; keys: Key[]; lag?: Record<string, number> }[] = [
  {
    name: 'seated_idle', duration: 4, loop: true,
    keys: [
      { t: 0, pose: SEATED, morph: { eyesClosed: 1, smile: 0.1 } },
      { t: 2, pose: merge(SEATED, { hips: { p: [0, 0.277, 0] }, spine: { r: [2, 0, 0] }, chest: { r: [0, 0, 0] }, head: { r: [6, 0, 0] } }, sym('upperarm', { aim: [0.33, -0.87, 0.36] })), morph: { eyesClosed: 1, smile: 0.12 } },
      { t: 4, pose: SEATED, morph: { eyesClosed: 1, smile: 0.1 } },
    ],
  },
  {
    name: 'wake', duration: 2.6, loop: false,
    lag: { head: 0.12, neck: 0.06 },
    keys: [
      { t: 0, pose: SEATED, morph: { eyesClosed: 1, smile: 0.1 } },
      { t: 0.5, pose: SEATED, morph: { eyesClosed: 1, smile: 0.1 } },
      { t: 1.1, pose: merge(SEATED, { head: { r: [8, 0, 0] } }), morph: { eyesClosed: 0.45, smile: 0.1 } },
      { t: 1.35, pose: merge(SEATED, { head: { r: [7, 0, 0] } }), morph: { eyesClosed: 0.75 } },
      { t: 1.9, pose: AWAKE, morph: { eyesClosed: 0, smile: 0.2 } },
      { t: 2.6, pose: merge(AWAKE, { head: { r: [-4, 0, 0] }, chest: { r: [-3, 0, 0] } }), morph: { eyesClosed: 0, smile: 0.25 } },
    ],
  },
  {
    name: 'acknowledge', duration: 1.8, loop: false,
    lag: { head: 0.08 },
    keys: [
      { t: 0, pose: AWAKE, morph: { smile: 0.25 } },
      { t: 0.45, pose: merge(AWAKE, { head: { r: [-4, 0, 7] } }), morph: { smile: 0.5 } },
      { t: 0.9, pose: merge(AWAKE, { head: { r: [10, 0, 5] }, neck: { r: [3, 0, 0] } }), morph: { smile: 0.8, eyesClosed: 0.3 } },
      { t: 1.3, pose: merge(AWAKE, { head: { r: [-2, 0, 3] } }), morph: { smile: 0.85, eyesClosed: 0 } },
      { t: 1.8, pose: merge(AWAKE, { head: { r: [0, 0, 2] } }), morph: { smile: 0.8 } },
    ],
  },
  {
    name: 'beckon', duration: 2, loop: true,
    lag: { fingers_R: 0.05 },
    keys: [
      { t: 0, pose: merge(BECKON, curl(12, 'R')), morph: { smile: 0.8 } },
      { t: 0.35, pose: merge(BECKON, curl(85, 'R'), { hand_R: { r: [-30, 0, 0] } }), morph: { smile: 0.8 } },
      { t: 0.7, pose: merge(BECKON, curl(12, 'R')), morph: { smile: 0.8 } },
      { t: 1.05, pose: merge(BECKON, curl(85, 'R'), { hand_R: { r: [-30, 0, 0] } }), morph: { smile: 0.85 } },
      { t: 1.45, pose: merge(BECKON, curl(12, 'R'), { head: { r: [-6, 10, -8] }, chest: { r: [-4, -9, 0] } }), morph: { smile: 0.9 } },
      { t: 2, pose: merge(BECKON, curl(12, 'R')), morph: { smile: 0.8 } },
    ],
  },
  {
    name: 'rise', duration: 1.7, loop: false,
    lag: { head: 0.08, shin_L: 0.1, shin_R: 0.12, forearm_L: 0.05, forearm_R: 0.05 },
    keys: [
      { t: 0, pose: AWAKE, morph: { smile: 0.6 } },
      { t: 0.45, pose: CROUCH, morph: { smile: 0.5 }, ease: 'inOut' },
      { t: 0.95, pose: LIFT, morph: { smile: 0.9 }, ease: 'out' },
      { t: 1.7, pose: FLY, morph: { smile: 0.9 } },
    ],
  },
  {
    name: 'fly', duration: 1.2, loop: true,
    keys: [
      { t: 0, pose: merge(FLY, { thigh_L: { aim: [0.12, -0.36, -0.92] }, thigh_R: { aim: [-0.12, -0.2, -0.97] }, chest: { r: [-6, 0, 4] } }), morph: { smile: 0.9 } },
      { t: 0.6, pose: merge(FLY, { hips: { p: [0, 0.53, 0], r: [70, 0, 0] }, thigh_L: { aim: [0.12, -0.2, -0.97] }, thigh_R: { aim: [-0.12, -0.36, -0.92] }, chest: { r: [-6, 0, -4] } }), morph: { smile: 0.9 } },
      { t: 1.2, pose: merge(FLY, { thigh_L: { aim: [0.12, -0.36, -0.92] }, thigh_R: { aim: [-0.12, -0.2, -0.97] }, chest: { r: [-6, 0, 4] } }), morph: { smile: 0.9 } },
    ],
  },
  {
    // Optional clip in the contract: awake, settled, in the portfolio hero.
    name: 'perch_idle', duration: 5, loop: true,
    keys: [
      { t: 0, pose: AWAKE, morph: { smile: 0.55 } },
      { t: 1.6, pose: merge(AWAKE, { chest: { r: [-1, 4, 0] }, head: { r: [-2, 6, 4] }, hips: { p: [0, 0.277, 0] } }), morph: { smile: 0.6 } },
      { t: 3.2, pose: merge(AWAKE, { chest: { r: [1, -4, 0] }, head: { r: [0, -6, -3] } }), morph: { smile: 0.5 } },
      { t: 5, pose: AWAKE, morph: { smile: 0.55 } },
    ],
  },
];

// ── baking ────────────────────────────────────────────────
interface Resolved { q: Map<string, Quaternion>; p: Map<string, Vector3> }

function resolve(pose: Pose, bones: Record<string, Object3D>): Resolved {
  const q = new Map<string, Quaternion>();
  const p = new Map<string, Vector3>();
  const inRoot = new Map<string, Quaternion>();
  for (const name of ORDER) {
    const node = bones[name];
    if (!node) continue;
    const bp = pose[name] ?? {};
    const parentQ = inRoot.get(BONES.parents[name]) ?? new Quaternion();
    const local = new Quaternion();
    if (bp.aim) {
      const dir = new Vector3(...bp.aim).normalize().applyQuaternion(parentQ.clone().invert());
      local.setFromUnitVectors(DOWN, dir);
      if (bp.twist) local.multiply(new Quaternion().setFromAxisAngle(Y, bp.twist * D));
    } else if (bp.toes && bp.top) {
      const z = new Vector3(...bp.toes).normalize();
      const y = new Vector3(...bp.top);
      y.addScaledVector(z, -y.dot(z)).normalize();
      const x = new Vector3().crossVectors(y, z);
      const want = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
      local.copy(parentQ.clone().invert().multiply(want));
    } else if (bp.r) {
      local.setFromEuler(new Euler(bp.r[0] * D, bp.r[1] * D, bp.r[2] * D));
    }
    q.set(name, local);
    inRoot.set(name, parentQ.clone().multiply(local));
    p.set(name, bp.p ? new Vector3(...bp.p) : (node.userData.rest as Vector3).clone());
  }
  return { q, p };
}

const EASE = {
  inOut: (x: number) => 0.5 - Math.cos(Math.PI * x) / 2,
  in: (x: number) => 1 - Math.cos((Math.PI * x) / 2),
  out: (x: number) => Math.sin((Math.PI * x) / 2),
  linear: (x: number) => x,
};

const MORPH_MESHES: Record<string, string[]> = {
  eyesClosed: ['lid_L', 'lid_R', 'lid_L_lash', 'lid_R_lash'],
  smile: ['mouth'],
};

export function buildProceduralClips(bones: Record<string, Object3D>): AnimationClip[] {
  const FPS = 24;
  return CLIPS.map((c) => {
    const resolved = c.keys.map((k) => resolve(k.pose, bones));
    const segment = (t: number) => {
      let i = 0;
      while (i < c.keys.length - 2 && t > c.keys[i + 1].t) i++;
      const a = c.keys[i], b = c.keys[i + 1];
      const x = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-6, b.t - a.t)));
      return { i, e: EASE[b.ease ?? 'inOut'](x) };
    };
    const frames = Math.round(c.duration * FPS);
    const times: number[] = [];
    for (let f = 0; f <= frames; f++) times.push((f / frames) * c.duration);
    const tracks = [];
    const wrap = (t: number) => (c.loop ? ((t % c.duration) + c.duration) % c.duration : Math.max(0, t));

    for (const name of ORDER) {
      if (!bones[name]) continue;
      const lag = c.lag?.[name] ?? 0;
      const qv: number[] = [];
      const pv: number[] = [];
      let prev: Quaternion | null = null;
      let moves = false;
      for (const t of times) {
        const { i, e } = segment(wrap(t - lag));
        const q = resolved[i].q.get(name)!.clone().slerp(resolved[i + 1].q.get(name)!, e);
        if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        prev = q;
        qv.push(q.x, q.y, q.z, q.w);
        const p = resolved[i].p.get(name)!.clone().lerp(resolved[i + 1].p.get(name)!, e);
        pv.push(p.x, p.y, p.z);
        if (!p.equals(bones[name].userData.rest as Vector3)) moves = true;
      }
      tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, times, qv));
      if (moves) tracks.push(new VectorKeyframeTrack(`${name}.position`, times, pv));
    }

    for (const morph of ['eyesClosed', 'smile'] as const) {
      const values = times.map((t) => {
        const { i, e } = segment(wrap(t));
        const a = c.keys[i].morph?.[morph] ?? 0, b = c.keys[i + 1].morph?.[morph] ?? 0;
        return a + (b - a) * e;
      });
      for (const mesh of MORPH_MESHES[morph]) tracks.push(new NumberKeyframeTrack(`${mesh}.morphTargetInfluences[${morph}]`, times, values));
    }
    return new AnimationClip(c.name, c.duration, tracks);
  });
}
