// Where Coco goes, and how he gets there, once the page has been still for a moment. Pure (tested in
// node); HomeStage (3D) and PosterCompanion (his still) read it. space.ts finds the empty space.
//
// - At the top of home he is the hero's Coco: big, in the hero's own space, scrolling with it. While
//   the hero is on screen there is no other Coco anywhere (heroMode, with hysteresis).
// - Everywhere else (every page but About, and home once the hero has scrolled away) he is the
//   companion. He moves only once the page has been still (no scroll, no resize) for DWELL_S, and
//   only if his place has to change (planMove: 'stay' when where he is is still good).
// - A move is a flight on his ride cloud (Blender's 'flyin' clip, applied to the straight line from
//   where he starts to his new space): from where he is, if he is in view and the way is clear of
//   content; else from the nearer side of the window at his new space's height (the other side if
//   that way is blocked); else, or under reduced motion, he simply fades in there.
// - Where no empty space fits him (a phone, a tablet, a page full of cards) he is not left behind
//   ("Keep him with me", 9 Nov 2026): he is the small companion peeking up from the window's bottom
//   corner (cornerSpot), fixed to the window, the one place he may sit over content (approved; taps
//   pass through him). He flies in there from the nearer side too. A control the visitor can use
//   under that corner (controlInCorner: one focused by keyboard, or a fixed button) keeps him out of
//   it: the other bottom corner, else he waits out of sight.

import { pathClear, visibleShare, type Rect, type Spot } from './space';

/** The page must be still this long (s) before he moves (the still companion: the 3D one rides, ride.ts). */
export const DWELL_S = 1.2;
/** The still companion (reduced motion, lite) moves once scrolling has stopped for this long (s). */
export const STILL_S = 0.4;

export interface Dwell { last: number }

/** A dwell timer: `last` is the last scroll, resize or change of page (s). */
export const createDwell = (now = -Infinity): Dwell => ({ last: now });
/** The page moved (scroll, resize, a new page): the dwell starts again; a flight in progress is cancelled. */
export const touch = (d: Dwell, now: number) => { d.last = now; };
/** The page has been still for the dwell. */
export const dwelled = (d: Dwell, now: number, seconds = DWELL_S) => now - d.last >= seconds - 1e-9;

// ── the hero at the top of home ────────────────────────────

export const HERO = {
  /** His share of the hero space's height, and of its width (by his shape). */
  heightShare: 0.84,
  widthShare: 0.92,
  /** How much larger than his calm companion size he is in the hero (Cassidy: about 25-35%). */
  grow: 1.3,
  /** The hero's Coco hands over to the companion once less than this share of him is in view ... */
  leave: 0.45,
  /** ... and takes over again once more than this share is (hysteresis: no flicker at the edge). */
  back: 0.6,
};

/** His place in the hero (`stage`: the hero's space; px), at most `grow` times his calm size `maxH`. */
export function heroSpot(stage: Rect, aspect: number, maxH: number): Spot {
  const w = stage.right - stage.left, h = stage.bottom - stage.top;
  const size = Math.max(0, Math.min(h * HERO.heightShare, (w * HERO.widthShare) / Math.max(aspect, 1e-3), maxH * HERO.grow));
  return { cx: (stage.left + stage.right) / 2, cy: (stage.top + stage.bottom) / 2, h: size };
}

/** Whether the hero's Coco is the one on screen now (`share`: how much of his hero place is in view). */
export function heroMode(wasHero: boolean, share: number): boolean {
  return wasHero ? share >= HERO.leave : share > HERO.back;
}

// ── moving to a new space ──────────────────────────────────

export type Plan =
  | { kind: 'stay' }
  | { kind: 'hide' }
  | { kind: 'fly'; from: Spot; to: Spot; edge: boolean; corner: boolean }
  | { kind: 'appear'; to: Spot; corner: boolean };

export interface PlanInput {
  /** On About: no Coco. */
  away: boolean;
  /** Reduced motion: he never flies, he appears. */
  reduced: boolean;
  /** Where he is shown now (window px), or null when he is not shown. */
  current: Spot | null;
  /** Where he is is still good: clear of content and wholly in view. */
  currentOk: boolean;
  /** The best empty space now (window px), or null if none fits him. */
  best: Spot | null;
  /** The window below the header (px). */
  view: Rect;
  /** His width as a share of his height. */
  aspect: number;
  /** His box can travel from `from` to `to` without passing over content (negativeSpace.ts wayClear). */
  clear: (from: Spot, to: Spot) => boolean;
  /** Where he peeks from the bottom corner if no space fits him (window px), or null (no corner is free). */
  corner?: Spot | null;
}

/** From where he is, he flies only if at least this share of him is in view; otherwise he comes in from a side. */
export const FROM_HERE_SHARE = 0.3;
/** He starts this far (px) past the window's side, so the first frame of a flight shows nothing of him. */
export const EDGE_MARGIN = 24;

/** What he does once the page has been still for the dwell (see the top). */
export function planMove(i: PlanInput): Plan {
  if (i.away) return { kind: 'hide' };
  if (i.current && i.currentOk) return { kind: 'stay' };
  const to = i.best ?? i.corner ?? null;
  if (!to) return { kind: 'hide' };
  const corner = !i.best;
  if (i.reduced) return { kind: 'appear', to, corner };
  const half = (to.h * i.aspect) / 2;
  const left: Spot = { cx: i.view.left - half - EDGE_MARGIN, cy: to.cy, h: to.h };
  const right: Spot = { cx: i.view.right + half + EDGE_MARGIN, cy: to.cy, h: to.h };
  const sides = to.cx - i.view.left <= i.view.right - to.cx ? [left, right] : [right, left];
  // the corner peek may sit over content (approved): he glides in along the bottom edge from the nearer side
  if (corner) return { kind: 'fly', from: sides[0], to, edge: true, corner };
  if (i.current && visibleShare(i.current, i.aspect, i.view) >= FROM_HERE_SHARE && i.clear(i.current, to)) {
    return { kind: 'fly', from: i.current, to, edge: false, corner };
  }
  for (const from of sides) if (i.clear(from, to)) return { kind: 'fly', from, to, edge: true, corner };
  return { kind: 'appear', to, corner };
}

// ── the corner peek (no empty space fits him) ──────────────

/** The share of his framed box shown above the window's bottom edge as he peeks from the corner. */
export const PEEK = { show: 0.62, edge: 6 };
/** His corner rest on every page, home included (Cassidy, 10 Nov 2026): he and his cloud almost wholly in view. */
export const CORNER_REST = { show: 0.96 };

/**
 * His place peeking from a bottom corner of a `W` x `H` window (px): smaller on a phone, a little
 * larger on a tablet or laptop, as before ("Keep him with me"); `grow` makes room for his ride cloud
 * (his framed box is that much taller, the cloud mostly below the edge).
 */
export function cornerSpot(W: number, H: number, aspect: number, side: 'right' | 'left' = 'right', grow = 1, show = PEEK.show): Spot {
  const h = (W < 700 ? Math.min(118, H * 0.16) : Math.min(150, H * 0.19)) * grow;
  const hw = (h * aspect) / 2;
  return { cx: side === 'right' ? W - hw - PEEK.edge : hw + PEEK.edge, cy: H - h * show + h / 2, h };
}

/** The part of the window his corner peek covers (px). */
export function cornerBox(s: Spot, aspect: number, H: number): Rect {
  const hw = (s.h * aspect) / 2;
  return { left: s.cx - hw, right: s.cx + hw, top: s.cy - s.h / 2, bottom: H };
}

/**
 * A control (its box in the window, its tabIndex) lies under his corner `area` in a window `H` tall:
 * he stays out of its way. Never a focus target the page moves focus to (tabIndex -1: <main> after a
 * change of page, the skip link) nor anything as tall as the window: those only run through it.
 */
export function controlInCorner(b: { top: number; bottom: number; left: number; right: number; height: number }, tabIndex: number, H: number, area: Rect): boolean {
  if (tabIndex < 0 || b.height >= H) return false;
  return b.top < area.bottom && b.bottom > area.top && b.left < area.right && b.right > area.left;
}

/** A way is clear when his box, along the line, never touches the given content (window px). */
export const clearOf = (obstacles: readonly Rect[], aspect: number) => (from: Spot, to: Spot) => pathClear(from, to, obstacles, aspect);

/**
 * Where he is during a flight: `progress` (0..1) along the line from `from` to `to`, `lift` (share of
 * his height) above it. Both come from Blender's 'flyin' clip (ctl_progress, ctl_lift).
 */
export function flightAt(from: Spot, to: Spot, progress: number, lift: number): Spot {
  const p = Math.min(1, Math.max(0, progress));
  const h = from.h + (to.h - from.h) * p;
  return { cx: from.cx + (to.cx - from.cx) * p, cy: from.cy + (to.cy - from.cy) * p - lift * h, h };
}

/** His lean into the flight: Blender's lean (degrees, for a flight towards the right) turned towards his heading. */
export const flightBank = (from: Spot, to: Spot, bankDeg: number) => (to.cx < from.cx ? -bankDeg : bankDeg);

/** The longest a flight may take (s) before it simply ends at his space (a slow device, a stalled clock). */
export const flightTimeout = (clipSeconds: number) => clipSeconds * 1.25 + 1.5;
