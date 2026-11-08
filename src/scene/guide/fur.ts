// Layered, shaggy fur in the painting's manner: hundreds of small tapered
// strands, toon-shaded in three tones, laid over each body part. One
// InstancedMesh per part (one draw call), parented to its bone so it moves
// with the animation.

import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3,
  type Object3D,
} from 'three';
import { furToonGradient, seeded, toon, PALETTE } from './toon';
import type { V3 } from './sculpt';

let strandGeo: BufferGeometry | null = null;
/** A tapered, slightly curved blade from (0,0,0) to (0,1,0), facing +Z. */
function strand() {
  if (strandGeo) return strandGeo;
  const rows = [
    [0, 0.5, 0], [0.3, 0.45, 0.03], [0.6, 0.32, 0.08], [0.85, 0.16, 0.13], [1, 0, 0.17],
  ];
  const p: number[] = [];
  for (const [y, w, z] of rows) { p.push(-w, y, z, w, y, z); }
  const idx: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  strandGeo = new BufferGeometry();
  strandGeo.setAttribute('position', new Float32BufferAttribute(p, 3));
  strandGeo.setIndex(idx);
  strandGeo.computeVertexNormals();
  return strandGeo;
}

let furMat: ReturnType<typeof toon> | null = null;
const material = () => (furMat ??= toon('#ffffff', { side: DoubleSide, gradientMap: furToonGradient() }));

const TONES: [string, number][] = [
  [PALETTE.fur, 0.5],
  [PALETTE.furDark, 0.26],
  [PALETTE.furLight, 0.17],
  [PALETTE.furStreak, 0.07],
];

export interface FurPatch {
  /** Ellipsoid the strands grow from (bone-local). */
  center: V3;
  radii: V3;
  count: number;
  /** Strand length range (metres) and width. */
  length: [number, number];
  width?: number;
  /** How far strands lift off the surface (radians). */
  lift?: number;
  /** Which part of the unit sphere grows fur. */
  keep?: (u: Vector3) => boolean;
  /** Direction strands flow (bone-local), given the surface point and normal. Default: downhill. */
  flow?: (p: Vector3, n: Vector3) => Vector3;
  seed?: number;
}

const DOWN = new Vector3(0, -1, 0);

export function furPatch(parent: Object3D, patch: FurPatch) {
  const rnd = seeded(patch.seed ?? 7);
  const { center, radii, width = 0.017, lift = 0.24 } = patch;
  const count = Math.round(patch.count * 1.35);
  const length: [number, number] = [patch.length[0] * 1.15, patch.length[1] * 1.2];
  const mesh = new InstancedMesh(strand(), material(), count);
  mesh.name = `${parent.name}_fur`;
  const m = new Matrix4();
  const c = new Color();
  const u = new Vector3(), n = new Vector3(), p = new Vector3(), t = new Vector3(), d = new Vector3();
  const x = new Vector3(), z = new Vector3();
  const q = new Quaternion();
  let placed = 0;
  let tries = 0;
  // Fibonacci-ish sampling with jitter, filtered by `keep`.
  while (placed < count && tries < count * 12) {
    tries++;
    const k = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - k * k);
    u.set(Math.cos(phi) * r, k, Math.sin(phi) * r);
    if (patch.keep && !patch.keep(u)) continue;
    p.set(center[0] + u.x * radii[0], center[1] + u.y * radii[1], center[2] + u.z * radii[2]);
    n.set(u.x / radii[0], u.y / radii[1], u.z / radii[2]).normalize();
    // flow direction projected onto the surface, jittered around the normal
    const f = patch.flow ? patch.flow(p, n) : DOWN;
    t.copy(f).addScaledVector(n, -n.dot(f));
    if (t.lengthSq() < 1e-6) t.set(1, 0, 0).addScaledVector(n, -n.x);
    t.normalize().applyQuaternion(q.setFromAxisAngle(n, (rnd() - 0.5) * 0.9));
    const a = lift * (0.6 + rnd() * 0.8);
    d.copy(t).multiplyScalar(Math.cos(a)).addScaledVector(n, Math.sin(a)).normalize();
    // basis: Y along the strand, Z out of the surface, X across
    z.copy(n).addScaledVector(d, -n.dot(d)).normalize();
    x.crossVectors(d, z).normalize();
    const len = length[0] + rnd() * (length[1] - length[0]);
    const w = width * (0.7 + rnd() * 0.6);
    m.makeBasis(x.multiplyScalar(w), d.clone().multiplyScalar(len), z.multiplyScalar(len * 0.45));
    m.setPosition(p.addScaledVector(n, -0.004));
    mesh.setMatrixAt(placed, m);
    let pick = rnd();
    let tone = TONES[0][0];
    for (const [col, wgt] of TONES) { if ((pick -= wgt) <= 0) { tone = col; break; } }
    mesh.setColorAt(placed, c.set(tone));
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}
