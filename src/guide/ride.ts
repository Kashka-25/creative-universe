// Coco riding his cloud with the visitor (Cassidy, 9 Nov 2026: "make coco move on a animated cloud
// (like it is his magic carpet) so he is flying on the cloud with the visitor as they scroll, doing
// his best to follow the negative space"). Pure (tested in node); HomeStage applies it every frame.
//
// - He is held in the WINDOW (he travels with the visitor), drifting towards his aim: the best empty
//   space on the screen now (space.ts findSpace), recomputed a few times a second from the cached
//   layout (negativeSpace.ts createLayoutCache).
// - The drift is two critically damped springs in a row (Cassidy, 10 Nov 2026: "smoother and
//   responsive"). An unseen guide chases his aim, its pull limited so its speed never passes RIDE.vmax
//   (it follows a point at most `reach` px from it, so the limit is reached and left smoothly); he
//   follows the guide closely with a stiffer spring. Neither overshoots, so he never does, and his speed
//   never passes the guide's; but his acceleration is now continuous too: he eases off from rest with
//   no jolt and settles with none (one spring alone jumps to full pull the moment his aim changes).
//   Sub-stepped, so it is the same at any frame rate.
// - He banks gently into his way of travel (a spring towards a lean proportional to his speed).
// - Hysteresis (aimStep): he keeps his aim while it stays clear and in view; a clearly larger space
//   must hold a while before he goes for it, so he never dithers between two spots.
// - A new aim whose way crosses content (moveKind): he waits where he is if that is still clear;
//   otherwise he fades out quickly and fades in at the new space.
// - Content moving towards him as the page scrolls is seen a moment early (sweep), so he moves off
//   before it reaches him.

import { springStep } from './glide';
import type { Rect, Spot } from './space';

export const RIDE = {
  /** The guide's stiffness (rad/s): a soft, floating settle of about 1.3 s ... */
  omega: 4,
  /** ... and how closely he follows the guide (rad/s; his lag behind it is about 2 / followOmega s). */
  followOmega: 9,
  /** His fastest drift (px/s). */
  vmax: 600,
  /** His lean at full speed (degrees), and how quickly the lean follows (rad/s). */
  bankDeg: 4,
  bankOmega: 5,
  /** How often (s) he looks for his space while riding. */
  lookS: 0.12,
  /** A space is clearly better when it is this much larger, by this many px, held this long (s). */
  better: 1.3,
  betterPx: 24,
  betterS: 1.2,
  /** How far ahead (s) content moving with the scroll is seen, and at most how far (px). */
  sweepS: 0.3,
  sweepMax: 160,
  /** The longest step of the drift's sub-steps (s): the same motion at any frame rate. */
  maxStep: 1 / 120,
};


export interface Rider {
  x: number; y: number; h: number;
  vx: number; vy: number; vh: number;
  /** The unseen guide he follows (where it is, and its speed). */
  gx: number; gy: number; gh: number;
  gvx: number; gvy: number; gvh: number;
  /** His lean (degrees, + towards the right) and its speed. */
  bank: number; vbank: number;
}

export const createRider = (s: Spot): Rider => ({
  x: s.cx, y: s.cy, h: s.h, vx: 0, vy: 0, vh: 0, gx: s.cx, gy: s.cy, gh: s.h, gvx: 0, gvy: 0, gvh: 0, bank: 0, vbank: 0,
});

/** Puts him at `s` at rest (a fade-in, the end of his entrance). */
export function placeRider(r: Rider, s: Spot) {
  r.x = r.gx = s.cx; r.y = r.gy = s.cy; r.h = r.gh = s.h;
  r.vx = r.vy = r.vh = r.gvx = r.gvy = r.gvh = 0;
}

/** Moves him and his guide together by `dy` px, their speeds by `dvy` (a change of frame: page and window). */
export function shiftRider(r: Rider, dy: number, dvy = 0) {
  r.y += dy; r.gy += dy;
  r.vy += dvy; r.gvy += dvy;
}

/** One frame of his drift towards `aim` (window px), `dt` seconds long. */
export function followStep(r: Rider, aim: Spot, dt: number, o = RIDE) {
  if (!(dt > 0)) return;
  // chasing a point always `reach` ahead, the spring's speed rises smoothly towards omega x reach / 2 = vmax
  const reach = (2 * o.vmax) / o.omega;
  let left = Math.min(dt, 0.25);
  while (left > 1e-9) {
    const h = Math.min(left, o.maxStep);
    left -= h;
    // the guide: towards his aim, following a point at most `reach` px towards it
    const dx = aim.cx - r.gx, dy = aim.cy - r.gy;
    const d = Math.hypot(dx, dy);
    const k = d > reach ? reach / d : 1;
    [r.gx, r.gvx] = springStep(r.gx, r.gvx, r.gx + dx * k, o.omega, h);
    [r.gy, r.gvy] = springStep(r.gy, r.gvy, r.gy + dy * k, o.omega, h);
    [r.gh, r.gvh] = springStep(r.gh, r.gvh, aim.h, o.omega, h);
    // he follows the guide
    [r.x, r.vx] = springStep(r.x, r.vx, r.gx, o.followOmega, h);
    [r.y, r.vy] = springStep(r.y, r.vy, r.gy, o.followOmega, h);
    [r.h, r.vh] = springStep(r.h, r.vh, r.gh, o.followOmega, h);
    const lean = Math.max(-1, Math.min(1, r.vx / o.vmax)) * o.bankDeg;
    [r.bank, r.vbank] = springStep(r.bank, r.vbank, lean, o.bankOmega, h);
  }
}

/** Content seen a moment early: each box stretched the way the page is carrying it (`vs`: scroll speed, px/s). */
export function sweep(obstacles: readonly Rect[], vs: number, o = RIDE): Rect[] {
  const ahead = Math.min(Math.abs(vs) * o.sweepS, o.sweepMax);
  if (ahead < 1) return obstacles as Rect[];
  // scrolling down (vs > 0) carries the content up the window
  return obstacles.map((b) => (vs > 0 ? { ...b, top: b.top - ahead } : { ...b, bottom: b.bottom + ahead }));
}

// ── his aim, with hysteresis ───────────────────────────────

export interface Aim { spot: Spot | null; betterSince: number }
export const createAim = (): Aim => ({ spot: null, betterSince: NaN });

/**
 * One look: `best` is the best space now (window px, or null), `ok` whether his aim is still clear and
 * in view. Returns 'keep' or 'move' (a.spot is then the new aim), or 'none' (no space anywhere).
 */
export function aimStep(a: Aim, i: { now: number; best: Spot | null; ok: boolean }, o = RIDE): 'keep' | 'move' | 'none' {
  if (a.spot && i.ok) {
    const b = i.best;
    const better = !!b && b.h >= a.spot.h * o.better && b.h - a.spot.h >= o.betterPx;
    if (!better) { a.betterSince = NaN; return 'keep'; }
    if (Number.isNaN(a.betterSince)) a.betterSince = i.now;
    if (i.now - a.betterSince < o.betterS) return 'keep';
  }
  a.betterSince = NaN;
  a.spot = i.best;
  return i.best ? 'move' : 'none';
}

/**
 * How he goes to a new aim: 'ride' when the way is clear of content; 'wait' where he is when it is
 * not but where he is is still clear; 'hop' (fade out quickly, fade in there) otherwise.
 */
export function moveKind(wayClear: boolean, hereClear: boolean): 'ride' | 'wait' | 'hop' {
  return wayClear ? 'ride' : hereClear ? 'wait' : 'hop';
}

/** The area (px^2) where his box overlaps any of the boxes. */
export function overlapArea(box: Rect, boxes: readonly Rect[]): number {
  let a = 0;
  for (const b of boxes) {
    const w = Math.min(box.right, b.right) - Math.max(box.left, b.left);
    const h = Math.min(box.bottom, b.bottom) - Math.max(box.top, b.top);
    if (w > 0 && h > 0) a += w * h;
  }
  return a;
}
