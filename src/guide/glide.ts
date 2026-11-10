// How Coco moves between places: a critically damped spring (it starts and stops with zero speed,
// with no overshoot), soft enough that he floats rather than travels. Pure (tested in node);
// HomeStage reads it every frame. Where he goes is space.ts's business.

/** One step of a critically damped spring towards `target` (exact for any dt). Returns [x, v]. */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const e = Math.exp(-omega * dt);
  const d = x - target;
  const k = (v + omega * d) * dt;
  return [target + (d + k) * e, (v - omega * k) * e];
}

/** How stiff his float from one space to another is: a slow, long settle (some 3 s), never a dash. */
export const FLOAT_OMEGA = 1.6;

/** Within this distance (CSS px) of his place he starts to move with it exactly (see followWeight). */
export const FOLLOW_NEAR = 120;

/**
 * How much of his place's own movement (the page scrolling under his fixed layer) he takes on in one
 * frame: all of it once he is there, so he stays with his space and never swims over the content
 * beside it; none while he is still far off, so the spring alone brings him and he never moves away
 * from where he is going. Eased in between.
 */
export function followWeight(distance: number): number {
  const u = Math.min(1, Math.max(0, distance / FOLLOW_NEAR));
  return 1 - u * u * (3 - 2 * u);
}

/** His glide, in his layer's CSS px: position, size, their speeds, and where his place was last frame. */
export interface Glide {
  x: number; vx: number; y: number; vy: number; h: number; vh: number;
  tx: number; ty: number;
}

/** One frame of his glide towards `spot` (see followWeight). */
export function glideStep(g: Glide, spot: { cx: number; cy: number; h: number }, dt: number, omega = FLOAT_OMEGA) {
  const f = followWeight(Math.hypot(g.x - g.tx, g.y - g.ty));
  g.x += (spot.cx - g.tx) * f;
  g.y += (spot.cy - g.ty) * f;
  g.tx = spot.cx;
  g.ty = spot.cy;
  [g.x, g.vx] = springStep(g.x, g.vx, spot.cx, omega, dt);
  [g.y, g.vy] = springStep(g.y, g.vy, spot.cy, omega, dt);
  [g.h, g.vh] = springStep(g.h, g.vh, spot.h, omega, dt);
}

/** He has a new place: from here the spring alone takes him there (the old place's movement no longer carries him). */
export function retarget(g: Glide, spot: { cx: number; cy: number }) {
  g.tx = spot.cx;
  g.ty = spot.cy;
}
