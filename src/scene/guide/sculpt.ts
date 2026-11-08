// Tiny "sculpting" toolkit for the stand-in: ellipsoids pushed and pulled by
// smooth functions, with front-projected UVs so painted textures (the face)
// land where they should.

import { BufferAttribute, SphereGeometry, Vector3 } from 'three';

export type V3 = [number, number, number];
/** Offset in unit-sphere space for a point u on the unit sphere. */
export type Deform = (u: Vector3) => V3;

/** Gaussian bump centred on (cx, cy) with spreads sx, sy (variances). */
export const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
  Math.exp(-((x - cx) ** 2) / sx - ((y - cy) ** 2) / sy);

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface SculptOpts {
  radii: V3;
  segments?: [number, number];
  /** Portion of the sphere from the top (radians, default full sphere). */
  thetaLength?: number;
  deform?: Deform;
}

export function sculptEllipsoid({ radii, segments = [40, 28], thetaLength = Math.PI, deform }: SculptOpts) {
  const g = new SphereGeometry(1, segments[0], segments[1], 0, Math.PI * 2, 0, thetaLength);
  const pos = g.getAttribute('position') as BufferAttribute;
  const uv = g.getAttribute('uv') as BufferAttribute;
  const u = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    u.fromBufferAttribute(pos, i);
    const d = deform ? deform(u) : [0, 0, 0];
    // front projection: (x, y) of the unit sphere -> (u, v)
    uv.setXY(i, u.x * 0.5 + 0.5, u.y * 0.5 + 0.5);
    pos.setXYZ(i, (u.x + d[0]) * radii[0], (u.y + d[1]) * radii[1], (u.z + d[2]) * radii[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** Point on the front of a sculpted ellipsoid at unit coords (x, y), in its local space. */
export function frontPoint(radii: V3, deform: Deform | undefined, x: number, y: number): Vector3 {
  const u = new Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)));
  const d = deform ? deform(u) : [0, 0, 0];
  return new Vector3((u.x + d[0]) * radii[0], (u.y + d[1]) * radii[1], (u.z + d[2]) * radii[2]);
}
