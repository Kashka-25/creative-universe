// Where Coco sits: in the home hero, or with the visitor in the corner everywhere else. Where the
// corner lies clear of the page's content column (a wide window: see cornerClear) he is docked
// beside it; elsewhere he is a small companion peeking up from the bottom-right corner, drawn above
// the content and below the header, who steps aside while the visitor reads (see stepAside). Pure
// (tested in node); HomeStage reads it every frame.
//
// Hysteresis: he leaves the hero only when it is clearly out of view, and comes back only when it
// is clearly in view, so scrolling around the edge never makes him hop back and forth. The
// decision uses the LARGE viewport height (the tallest seen at this width), so a phone's URL bar
// sliding in and out never moves him. The glide is a critically damped spring: it starts and
// stops with zero speed, with no overshoot.

export interface Box { top: number; bottom: number; left: number; width: number; height: number }

/** Share of the viewport: the hero must reach this far in to bring him back, or this far out to dock him. */
export const DOCK = { enter: { bottom: 0.35, top: 0.65 }, leave: { bottom: 0.2, top: 0.8 } };

/**
 * The hero's box in the window, or null when there is no hero to sit in: none on this page, one
 * that has already left the document (a page change: a detached element measures all zeros, which
 * would read as a hero at the top-left that has left the window), or one with no size.
 */
export function heroRect<R extends Box>(el: { isConnected: boolean; getBoundingClientRect(): R } | null): R | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

export function nextDocked(docked: boolean, rect: Box | null, viewportHeight: number): boolean {
  if (!rect || rect.height <= 0) return true;
  const H = viewportHeight;
  if (docked) return !(rect.bottom > H * DOCK.enter.bottom && rect.top < H * DOCK.enter.top);
  return !(rect.bottom > H * DOCK.leave.bottom && rect.top < H * DOCK.leave.top);
}

/**
 * The large viewport height: the tallest height seen at this width. A new width (rotation, a
 * resized window) or a big drop in height (a resized window, not a URL bar) starts again.
 */
export function createStableViewport() {
  let width = -1;
  let height = 0;
  return (w: number, h: number) => {
    if (w !== width || h < height * 0.8) { width = w; height = h; }
    else height = Math.max(height, h);
    return height;
  };
}

/**
 * The small viewport height: the shortest height seen at this width (a phone with its URL bar
 * showing). The corner is measured from it, so the docked companion is never under the bar and
 * never moves when the bar slides. A new width or a big rise in height (a resized window, not a
 * URL bar) starts again.
 */
export function createSmallViewport() {
  let width = -1;
  let height = Infinity;
  return (w: number, h: number) => {
    if (w !== width || h > height * 1.25) { width = w; height = h; }
    else height = Math.min(height, h);
    return height;
  };
}

/** His figure's height as a share of the space he is given (his framed box: see HomeStage). */
export const FIGURE = 0.95;

/**
 * The peeking companion: the share of his height shown above the window's bottom edge, and the
 * room kept below the edge when he has stepped aside (so a drift or breath never shows a sliver).
 */
export const PEEK = { show: 0.62, below: 0.12 };

/**
 * Centre and height (CSS px) of where he sits: the hero, or the corner (sized from `H`, the small
 * viewport, so a URL bar sliding away never resizes him), standing on `bottom`: the bottom edge of
 * his layer, which is held to the window's bottom edge (see intro.css). `peek`: the corner overlaps
 * the content column, so he is the small companion peeking up from that edge; otherwise docked
 * beside the column.
 */
export function placement(docked: boolean, rect: Box | null, W: number, H: number, peek = false, bottom = H): { cx: number; cy: number; h: number } {
  if (!docked && rect) {
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, h: Math.min(rect.height, rect.width * 1.1) * 0.92 };
  }
  if (!peek) {
    const h = Math.min(170, H * 0.22);
    return { cx: W - h * 0.62, cy: bottom - h * 0.6, h };
  }
  // smaller on a phone, a little larger on a tablet or laptop; his top PEEK.show of him above the edge
  const h = W < 700 ? Math.min(118, H * 0.16) : Math.min(150, H * 0.19);
  return { cx: W - h * 0.56, cy: bottom - h * PEEK.show + (h * FIGURE) / 2, h };
}

/** How far (CSS px) the peeking companion drops to be wholly below the bottom edge he peeks from. */
export function tuckDrop(h: number): number {
  return h * (PEEK.show + PEEK.below);
}

/** The room (CSS px) the end of every page keeps so its last line can scroll clear of the peeking companion. */
export function endRoom(h: number): number {
  return Math.ceil(h * PEEK.show + 8);
}

// ── stepping aside while the visitor reads ─────────────────
// Scrolling down through a page (reading) he slips below the bottom edge; he peeks back up when the
// scrolling stops for a moment, when they scroll up, or at the end of the page. Hysteresis: it takes
// a clear run of scrolling one way to move him, so small jitters never make him bob.

/** px of steady scrolling down that send him away, px of scrolling up that bring him back, seconds still that bring him back. */
export const ASIDE = { down: 40, up: 16, idle: 0.75 };

export interface Aside {
  /** He has stepped aside (below the edge). */
  away: boolean;
  /** Last scroll position seen. */
  y: number;
  /** Scrolling so far in the current direction (px; negative: up). */
  run: number;
  /** When the page last scrolled (s). */
  movedAt: number;
}

export const createAside = (y: number, now: number): Aside => ({ away: false, y, run: 0, movedAt: now });

/**
 * One step: the page is at `y` at time `now` (s). `atEnd`: the page is scrolled to its end. Returns
 * whether he should be out of the way: stepped aside, or `hold` (the mobile menu is open).
 */
export function stepAside(s: Aside, y: number, now: number, atEnd: boolean, hold = false): boolean {
  // the reference moves only on a counted step, so slow sub-pixel scrolling adds up
  const dy = y - s.y;
  if (Math.abs(dy) >= 1) {
    s.y = y;
    s.run = Math.sign(dy) === Math.sign(s.run) ? s.run + dy : dy;
    s.movedAt = now;
  } else if (now - s.movedAt >= ASIDE.idle) s.run = 0;
  if (atEnd || now - s.movedAt >= ASIDE.idle || s.run <= -ASIDE.up) s.away = false;
  else if (s.run >= ASIDE.down) s.away = true;
  return s.away || hold;
}

/**
 * A keyboard-focused control lies under his peek (`room` px tall, `width` px wide, bottom right):
 * he stays out of the way so focus is never hidden.
 */
export function focusInCorner(room: number, width: number): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  try { if (!el.matches(':focus-visible')) return false; } catch { /* older browsers: treat focus as visible */ }
  return controlInCorner(el.getBoundingClientRect(), el.tabIndex, window.innerWidth, window.innerHeight, room, width);
}

/**
 * Whether a focused element (its box in the window, its tabIndex) is a control under his corner
 * in a `W` x `H` window. Never a focus target the page moves focus to (tabIndex -1: <main> after a
 * change of page or the skip link) nor anything as tall as the window: those only run through his
 * corner, and he goes with the visitor on every page.
 */
export function controlInCorner(
  b: { top: number; bottom: number; left: number; right: number; height: number }, tabIndex: number,
  W: number, H: number, room: number, width: number,
): boolean {
  if (tabIndex < 0 || b.height >= H) return false;
  return b.top < H && b.bottom > H - room && b.left < W && b.right > W - width;
}

/** How quickly he steps aside and back (a critically damped spring: a gentle, eased glide). */
export const ASIDE_OMEGA = 6;

/**
 * How his layer is held on the page.
 *   attached  anchored in the page (position: absolute) while he sits in the hero: the browser
 *             moves it with the page as it scrolls, on the compositor, so he never swims about
 *             the hero (a fixed layer redrawn from the main thread lags a fling by a frame or more)
 *   fixed     fixed in the window: docked in the corner, where nothing on the page needs following
 * The switch never shows: his place on screen is carried across it exactly, and it only happens
 * while the page is not scrolling (the page and the compositor then agree on where the hero is) or
 * while he is out of view.
 */
export type LayerMode = 'fixed' | 'attached';

export interface LayerInputs {
  /** He belongs in the hero (by the docking hysteresis). */
  inHero: boolean;
  /** No scroll for a moment. */
  scrollIdle: boolean;
  /** The hero, and so he, is entirely out of view. */
  outOfView: boolean;
  /** His glide has arrived at the hero. */
  settled: boolean;
  /** The hero lies inside the layer once it is anchored in the page. */
  fits: boolean;
}

export function nextLayerMode(mode: LayerMode, i: LayerInputs): LayerMode {
  if (mode === 'attached') return (!i.inHero || !i.fits) && (i.scrollIdle || i.outOfView) ? 'fixed' : 'attached';
  return i.inHero && i.settled && i.scrollIdle && i.fits ? 'attached' : 'fixed';
}

/**
 * Where to anchor his layer in the page (document px from the top): centred on the hero, kept
 * inside the page so it never makes the page longer. `fits` says whether the hero then lies inside it.
 */
export function layerAnchor(heroTop: number, heroHeight: number, layerHeight: number, pageHeight: number): { top: number; fits: boolean } {
  const ideal = heroTop + heroHeight / 2 - layerHeight / 2;
  const top = Math.max(0, Math.min(ideal, Math.max(0, pageHeight - layerHeight)));
  return { top, fits: heroTop >= top - 0.5 && heroTop + heroHeight <= top + layerHeight + 0.5 };
}

/** One step of a critically damped spring towards `target` (exact for any dt). Returns [x, v]. */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const e = Math.exp(-omega * dt);
  const d = x - target;
  const k = (v + omega * d) * dt;
  return [target + (d + k) * e, (v - omega * k) * e];
}

/**
 * How stiff the glide is. Right after he changes place it is soft (a slow, eased glide); then it
 * firms up so he follows the hero smoothly as the page scrolls.
 */
export function glideStiffness(secondsSinceChange: number): number {
  const soft = 4.2, firm = 14;
  const u = Math.min(1, Math.max(0, (secondsSinceChange - 0.6) / 1.6));
  return soft + (firm - soft) * u * u * (3 - 2 * u);
}

/** Within this distance (CSS px) of his place he starts to move with it exactly (see followWeight). */
export const FOLLOW_NEAR = 120;

/**
 * How much of his place's own movement (the page scrolling under a fixed layer) he takes on in one
 * frame: all of it once he is there, so he stays locked to it and never swims; none while he is
 * still far off, so the spring alone brings him and he never moves away from where he is going
 * (scrolling up to the hero moves it down the window: carried along, he would dip below the
 * bottom edge before climbing to it). Eased in between.
 */
export function followWeight(distance: number): number {
  const u = Math.min(1, Math.max(0, distance / FOLLOW_NEAR));
  return 1 - u * u * (3 - 2 * u);
}

/** His glide, in his layer's CSS px: position, size, their speeds, and where his place was last frame. */
export interface Glide {
  x: number; vx: number; y: number; vy: number; h: number; vh: number;
  tx: number; ty: number;
  /** Seconds since he last changed place (0 on the frame he changes). */
  since: number;
}

/** One frame of his glide towards `spot` (see followWeight and glideStiffness). */
export function glideStep(g: Glide, spot: { cx: number; cy: number; h: number }, dt: number) {
  if (g.since > 0) {
    const f = followWeight(Math.hypot(g.x - g.tx, g.y - g.ty));
    g.x += (spot.cx - g.tx) * f;
    g.y += (spot.cy - g.ty) * f;
  }
  g.tx = spot.cx;
  g.ty = spot.cy;
  const w = glideStiffness(g.since);
  [g.x, g.vx] = springStep(g.x, g.vx, spot.cx, w, dt);
  [g.y, g.vy] = springStep(g.y, g.vy, spot.cy, w, dt);
  [g.h, g.vh] = springStep(g.h, g.vh, spot.h, w, dt);
}

/**
 * Where he starts when his layer lets go of a hero that has scrolled out of view: just below the
 * window's bottom edge (`viewBottom`, in the same px) under his corner, already corner-sized, at
 * rest. He then rises into the corner, peeking up, instead of flying back down across the page from
 * the hero above the window.
 */
export function belowCorner(corner: { cx: number; cy: number; h: number }, viewBottom: number) {
  return { x: corner.cx, y: viewBottom + corner.h * 0.6, h: corner.h };
}

/**
 * His layer changes how it is held (anchored in the page ⇄ fixed in the window): his place is
 * carried across so it stays the same on screen (`from` and `to` are the layer's box in the window
 * before and after). Returns whether he should instead come up into the corner from below: only
 * when the hero is still on the page and has left the window (a fling carried him off with it). A
 * hero that has gone with the page (a change of page: `hero` is null) is not that: he stays where
 * he is on screen and glides to his new place from there.
 */
export function carryAcross(
  g: Glide, from: { left: number; top: number }, to: { left: number; top: number },
  next: LayerMode, hero: Box | null, viewportHeight: number,
): boolean {
  const dx = from.left - to.left, dy = from.top - to.top;
  g.x += dx; g.tx += dx; g.y += dy; g.ty += dy;
  return next === 'fixed' && !!hero && hero.height > 0 && (hero.bottom <= 0 || hero.top >= viewportHeight);
}

/**
 * The layer's box to carry his place across from (carryAcross's `from`). Anchored in the page, the
 * layer moves on screen only as the page scrolls. Once the hero has gone with the page (`hero` is
 * null), that scroll is the new page's reset to the top, which can land before his next frame: he
 * was last seen where the layer was last drawn (`painted`), not where it measures now.
 */
export function carryFrom<B extends { left: number; top: number }>(painted: B | null, measured: B, hero: Box | null): B {
  return !hero && painted ? painted : measured;
}

// ── the corner and the page's content column ───────────────
// Docked beside the column only where the corner lies wholly outside it (a wide window); elsewhere
// he peeks up from the corner as the small companion.

/** The content column (styles: main > * at most --page wide, inside --gutter). */
export const PAGE_WIDTH = 1180;
const gutterFor = (W: number) => Math.min(48, Math.max(16, W * 0.04));

/** The right edge of the page's content column in a window `W` px wide. */
export function columnRight(W: number): number {
  return Math.min(W - gutterFor(W), (W + PAGE_WIDTH) / 2);
}

/** Room kept between the column and him (px), and the extra asked of a corner that was not in use (hysteresis on a resize). */
export const CORNER_MARGIN = 8;
const CORNER_HYSTERESIS = 16;

/**
 * Whether his docked corner lies wholly outside the content column. `widthShare` is his on-screen width
 * as a share of his corner height (his body alone, as framed in the corner); `H` is the height the
 * corner is measured from (see placement).
 */
export function cornerClear(W: number, H: number, widthShare: number, wasClear = false): boolean {
  const c = placement(true, null, W, H, false);
  const left = c.cx - (c.h * widthShare) / 2;
  return left >= columnRight(W) + CORNER_MARGIN + (wasClear ? 0 : CORNER_HYSTERESIS);
}
