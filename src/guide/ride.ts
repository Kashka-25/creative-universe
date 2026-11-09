// Coco riding his cloud with the visitor (Cassidy, 9 Nov 2026: "make coco move on a animated cloud
// (like it is his magic carpet) so he is flying on the cloud with the visitor as they scroll, doing
// his best to follow the negative space"). Pure (tested in node); HomeStage applies it every frame.
//
// - He is held in the WINDOW (he travels with the visitor), drifting towards his aim: the best empty
//   space on the screen now (space.ts findSpace), recomputed a few times a second from the cached
//   layout (negativeSpace.ts createLayoutCache).
// - The drift is a critically damped spring (no overshoot), its pull limited so his speed never passes
//   RIDE.vmax: the spring follows a point at most `reach` px from him (chasing it, his speed eases up
//   to vmax and never past it), so the limit is reached and left smoothly (no kink in his speed). Sub-stepped, so it is the same at any frame rate.
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
  /** The drift's stiffness (rad/s): a soft, floating settle of about 1.5 s. */
  omega: 3.2,
  /** His fastest drift (px/s). */
  vmax: 520,
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
  /** His lean (degrees, + towards the right) and its speed. */
  bank: number; vbank: number;
}

export const createRider = (s: Spot): Rider => ({ x: s.cx, y: s.cy, h: s.h, vx: 0, vy: 0, vh: 0, bank: 0, vbank: 0 });

/** Puts him at `s` at rest (a fade-in, the end of his entrance). */
export function placeRider(r: Rider, s: Spot) {
  r.x = s.cx; r.y = s.cy; r.h = s.h; r.vx = 0; r.vy = 0; r.vh = 0;
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
    // the point the spring follows: his aim, or at most `reach` px towards it
    const dx = aim.cx - r.x, dy = aim.cy - r.y;
    const d = Math.hypot(dx, dy);
    const k = d > reach ? reach / d : 1;
    [r.x, r.vx] = springStep(r.x, r.vx, r.x + dx * k, o.omega, h);
    [r.y, r.vy] = springStep(r.y, r.vy, r.y + dy * k, o.omega, h);
    [r.h, r.vh] = springStep(r.h, r.vh, aim.h, o.omega, h);
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
