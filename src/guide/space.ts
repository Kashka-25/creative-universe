// Where Coco floats: in the page's negative space. Pure (tested in node); negativeSpace.ts measures
// the page and HomeStage / PosterCompanion read the result.
//
// The finder: the page's content blocks (text, images, cards, buttons, headings, the header) are
// obstacles, each grown by a little air; over a grid of centres in the window, the largest box of his
// shape that touches none of them (and stays in the window) is the space he may take, at a calm size
// between a floor and a ceiling (smaller on phones). Below the floor there is no room: he fades out.
//
// Hysteresis (roamStep): he keeps his space while it stays clear of content and in view. Content
// overrunning him moves him at once; a space leaving the window, or a clearly larger one, moves him
// only once the new space has held for a while and the page is still. So he never wanders restlessly.

export interface Rect { left: number; top: number; right: number; bottom: number }
/** His box: centre and height (CSS px); his width is `h * aspect`. */
export interface Spot { cx: number; cy: number; h: number }

export interface SpaceOptions {
  /** His width as a share of his height (the framed emblem). */
  aspect: number;
  /** The smallest he may float; below it there is no room. */
  minH: number;
  /** The largest he floats, however much room there is. */
  maxH: number;
  /** Air kept between him and any content (px). */
  pad: number;
  /** Air kept between him and the window's edges (px). */
  edge: number;
  /** Spacing of the centres tried (px). */
  step: number;
}

/** His breath, drifts and float move him a little: the space he takes is this much larger than his box. */
export const SWAY = 1.1;

/** His calm size in a `W` x `H` window: smaller on a phone. */
export function spaceSizes(W: number, H: number): Pick<SpaceOptions, 'minH' | 'maxH' | 'pad' | 'edge' | 'step'> {
  const phone = W < 700;
  return {
    minH: phone ? 96 : 130,
    maxH: phone ? Math.min(180, H * 0.26) : Math.min(320, H * 0.4),
    pad: phone ? 10 : 16,
    edge: 8,
    step: Math.max(16, Math.round(Math.min(W, H) / 30)),
  };
}

export const grow = (r: Rect, by: number): Rect => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });

/**
 * The tallest box of his shape (width = height * aspect) centred on (cx, cy) that overlaps none of
 * the `obstacles` (already grown by the air to keep) and, given a `view`, stays inside it `edge` px
 * from its sides. 0 when the centre itself is on content.
 */
export function freeHeight(cx: number, cy: number, obstacles: readonly Rect[], aspect: number, view: Rect | null = null, edge = 0): number {
  let h = Infinity;
  if (view) {
    h = Math.min(2 * (cy - view.top - edge), 2 * (view.bottom - edge - cy), (2 * (cx - view.left - edge)) / aspect, (2 * (view.right - edge - cx)) / aspect);
    if (!(h > 0)) return 0;
  }
  for (const o of obstacles) {
    // the gap from the centre to the obstacle's span on each axis (negative inside it): the box is
    // clear of it when its half-width fits in the one or its half-height in the other
    const dx = Math.max(o.left - cx, cx - o.right);
    const dy = Math.max(o.top - cy, cy - o.bottom);
    const lim = Math.max((2 * dx) / aspect, 2 * dy);
    if (lim < h) h = lim;
    if (!(h > 0)) return 0;
  }
  return h;
}

const inside = (x: number, y: number, r: Rect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export interface Prefer {
  /** Where he is now (window px): among spaces as good, the nearest. */
  near?: { cx: number; cy: number } | null;
  /** Spaces the page keeps for him (the home hero): preferred. */
  hints?: readonly Rect[];
}

/**
 * The best empty space in `view` (window px) for him, or null if none fits him at `minH`. Larger is
 * better up to `maxH`; then a little deeper inside its space, inside a hint, nearer to where he is,
 * and nearer the middle of the window.
 */
export function findSpace(view: Rect, obstacles: readonly Rect[], o: SpaceOptions, prefer: Prefer = {}): Spot | null {
  const grown = obstacles.map((r) => grow(r, o.pad));
  const midY = (view.top + view.bottom) / 2, viewH = Math.max(1, view.bottom - view.top);
  let best: Spot | null = null;
  let bestScore = -Infinity;
  const step = Math.max(4, o.step);
  for (let y = view.top + step / 2; y < view.bottom; y += step) {
    for (let x = view.left + step / 2; x < view.right; x += step) {
      const free = freeHeight(x, y, grown, o.aspect, view, o.edge) / SWAY;
      if (free < o.minH) continue;
      const h = Math.min(free, o.maxH);
      let score = h + 0.15 * Math.min(Math.max(0, free - o.maxH), o.maxH * 0.5);
      if (prefer.hints?.some((r) => inside(x, y, r))) score += o.maxH * 0.35;
      if (prefer.near) score -= 0.05 * Math.hypot(x - prefer.near.cx, y - prefer.near.cy);
      score -= (0.1 * h * Math.abs(y - midY)) / viewH;
      if (score > bestScore) { bestScore = score; best = { cx: x, cy: y, h }; }
    }
  }
  return best;
}

/** His box (window px). */
export const spotBox = (s: Spot, aspect: number): Rect => {
  const hw = (s.h * aspect) / 2, hh = s.h / 2;
  return { left: s.cx - hw, top: s.cy - hh, right: s.cx + hw, bottom: s.cy + hh };
};

/** The share of his box inside `view` (0 ... 1). */
export function visibleShare(s: Spot, aspect: number, view: Rect): number {
  const b = spotBox(s, aspect);
  const w = Math.max(0, Math.min(b.right, view.right) - Math.max(b.left, view.left));
  const h = Math.max(0, Math.min(b.bottom, view.bottom) - Math.max(b.top, view.top));
  const area = (b.right - b.left) * (b.bottom - b.top);
  return area > 0 ? (w * h) / area : 0;
}

/** His space is still clear of the content (obstacles not yet grown), with a little give. */
export function stillClear(s: Spot, obstacles: readonly Rect[], aspect: number, pad: number): boolean {
  const grown = obstacles.map((r) => grow(r, pad * 0.5));
  return freeHeight(s.cx, s.cy, grown, aspect) / SWAY >= s.h * ROAM.crowded;
}

/**
 * He can glide from `from` to `to` (window px) without his box passing over any content: his box,
 * its size eased between the two, is checked at points along the straight line between them (the
 * line his spring follows). False when any point of the way touches content; then he fades out
 * where he is and fades in at `to` instead.
 */
export function pathClear(from: Spot, to: Spot, obstacles: readonly Rect[], aspect: number, step = 12): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(to.cx - from.cx, to.cy - from.cy) / Math.max(1, step)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const b = spotBox({ cx: from.cx + (to.cx - from.cx) * t, cy: from.cy + (to.cy - from.cy) * t, h: from.h + (to.h - from.h) * t }, aspect);
    if (obstacles.some((o) => o.left < b.right && o.right > b.left && o.top < b.bottom && o.bottom > b.top)) return false;
  }
  return true;
}

// ── keeping his space (hysteresis) ─────────────────────────

export const ROAM = {
  /** His space is crowded once it holds less than this share of him. */
  crowded: 0.9,
  /** His space is leaving the window once less than this share of him is in view. */
  lost: 0.6,
  /** Less than this share of him in view (cut by the header or the window's edge) once the page is still: he finds a whole space. */
  whole: 0.97,
  /** A space is clearly better when at least this much larger ... */
  better: 1.3,
  /** ... and by at least this many px ... */
  betterPx: 32,
  /** ... and it has stayed so for this long (s). */
  betterS: 3,
  /** A new space (faded out for want of room, or his own leaving the window) must hold this long (s) before he goes. */
  openS: 0.8,
};

export interface Roam {
  /** His space, in DOCUMENT px (it scrolls with the page); null: no room, faded out. */
  spot: Spot | null;
  betterSince: number;
  openSince: number;
}

export const createRoam = (): Roam => ({ spot: null, betterSince: NaN, openSince: NaN });

export interface RoamInput {
  /** Seconds. */
  now: number;
  /** The page is not scrolling. */
  scrollIdle: boolean;
  /** The best space in view now (document px), or null. */
  best: Spot | null;
  /** His space is still clear of the content. */
  clear: boolean;
  /** Share of him (at his space) inside the window. */
  visible: number;
}

export type RoamMove = 'stay' | 'move' | 'none';

/** One look at the page. Changes `r.spot` only when he should move. */
export function roamStep(r: Roam, i: RoamInput): RoamMove {
  const take = (s: Spot | null): RoamMove => {
    r.spot = s;
    r.betterSince = NaN;
    r.openSince = NaN;
    return s ? 'move' : 'none';
  };
  // content overrunning his space (a layout change, a menu): he moves at once, or fades out
  if (r.spot && !i.clear) return take(i.best);
  // partly out of the window (under the header, past an edge) is fine while the page moves with him;
  // once it is still he does not stay cut off, but finds a space wholly in view (below)
  if (r.spot && i.visible >= ROAM.lost && !(i.scrollIdle && i.visible < ROAM.whole)) {
    r.openSince = NaN;
    const better = !!i.best && i.best.h >= r.spot.h * ROAM.better && i.best.h - r.spot.h >= ROAM.betterPx;
    if (!better) { r.betterSince = NaN; return 'stay'; }
    if (Number.isNaN(r.betterSince)) r.betterSince = i.now;
    return i.now - r.betterSince >= ROAM.betterS && i.scrollIdle ? take(i.best) : 'stay';
  }
  // faded out for want of room, his space scrolling out of the window (he goes with it), or left
  // partly out of it: a new space must hold for a moment, with the page still, before he floats to it
  r.betterSince = NaN;
  if (!i.best) { r.openSince = NaN; return 'stay'; }
  if (Number.isNaN(r.openSince)) r.openSince = i.now;
  return i.now - r.openSince >= ROAM.openS && i.scrollIdle ? take(i.best) : 'stay';
}

// ── pages ──────────────────────────────────────────────────

/** He keeps the visitor company on every page but About (Cassidy's own page). */
export const companionOn = (pathname: string) => !/^\/about\/?$/i.test(pathname);
