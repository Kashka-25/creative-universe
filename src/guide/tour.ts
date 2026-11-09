// Coco's journey down the home page on a laptop or desktop (Cassidy, 9 Nov 2026): one Coco, the
// hero's own. As the visitor scrolls away from the hero he shrinks and flies gently on his ride cloud
// to rest stage right of "The realms", then stage right of "Works in this world"; while the project
// cards fill the screen he rests in the bottom-right corner; once space opens below the cards he
// rides into the middle of the stage, in that open space, back at his calm size. Scrolling back up takes him back the same way, to the hero, where he
// grows back. Pure (tested in node); HomeStage flies him (ride.ts followStep), PosterCompanion shows
// his still at each stop under reduced motion.
//
// The stops are found by the page's own hooks, never by heading text: [data-coco-stop="realms"],
// [data-coco-stop="works"] (each section's heading; measured by its text, see negativeSpace.ts
// stopAnchors) and [data-coco-stop="bottom"] (the works grid: the space opens below it). The stop is chosen by what is in view now (stopFor), with
// hysteresis at every edge, so a fast scroll goes straight to the stop of the section in view and
// never visits the ones already passed; a new stop must hold a moment (TOUR.holdS) before he goes.
// In flight he may pass over text and cards (Cassidy asked for it); where he rests never covers
// content (restSpot: space.ts findSpace in the room beside the anchor), except the corner peek.

import { findSpace, type Rect, type SpaceOptions, type Spot } from './space';

export type StopName = 'hero' | 'realms' | 'works' | 'corner' | 'bottom';
export type AnchorName = 'realms' | 'works' | 'bottom';
export interface Anchor { name: AnchorName; rect: Rect }

export const TOUR = {
  /** Laptop and desktop widths only (px): phones and tablets keep the ride and the corner peek. */
  minWidth: 1024,
  /** He leaves the hero as soon as less than this share of his hero place is in view (the visitor is
   * scrolling away), and comes back once more than the second share of it is. */
  heroLeave: 0.9,
  heroBack: 0.97,
  /** A heading's stop starts once its top is above this share of the view, and holds until it passes this one. */
  enter: 0.72,
  leave: 0.86,
  /** The space below the grid counts once this share of the view is below it (and holds down to the second). */
  openShare: 0.3,
  openHold: 0.18,
  /** A new stop must hold this long (s) before he goes for it (no zig-zags across a section's edge). */
  holdS: 0.2,
  /** Height of the room (px) beside a heading where he may rest, centred on it. */
  sideBand: 440,
  /** Air (px) between the heading and the room beside it. */
  sidePad: 24,
  /** In the open space below the cards he may be this much larger than at the other stops (his calm size). */
  bottomGrow: 1 / 0.65,
};

/** The tour runs on home at laptop and desktop widths. */
export const tourOn = (path: string, width: number) => (path === '' || path === '/' || path === '#/' || path === '#') && width >= TOUR.minWidth;

/**
 * The stop for what is in view now: the hero while its Coco's place is in view (the hero's own
 * hysteresis, heroShare: how much of that place is in view), else the furthest-down section whose
 * stop is in view, else the corner (the cards fill the screen). `prev` is the stop he is at or
 * heading for (each edge has hysteresis).
 */
export function stopFor(prev: StopName, heroShare: number, anchors: readonly Anchor[], view: Rect): StopName {
  if (prev === 'hero' ? heroShare >= TOUR.heroLeave : heroShare >= TOUR.heroBack) return 'hero';
  const H = Math.max(1, view.bottom - view.top);
  const at = (n: AnchorName) => anchors.find((a) => a.name === n)?.rect;
  const bottom = at('bottom');
  if (bottom) {
    const open = (view.bottom - Math.max(bottom.bottom, view.top)) / H;
    if (open >= (prev === 'bottom' ? TOUR.openHold : TOUR.openShare)) return 'bottom';
  }
  for (const n of ['works', 'realms'] as const) {
    const r = at(n);
    if (!r) continue;
    const reach = view.top + H * (prev === n ? TOUR.leave : TOUR.enter);
    if (r.top < reach && r.bottom > view.top + 8) return n;
  }
  // nothing in its band: a heading already in view lower down is where he goes next (he never waits
  // for it off screen); just out of the hero, or nearly back at it, with none in view: the hero
  for (const n of ['realms', 'works'] as const) {
    const r = at(n);
    if (r && r.top < view.bottom - 20 && r.bottom > view.top + 8) return n;
  }
  if (prev === 'hero' || heroShare >= TOUR.heroLeave) return 'hero';
  return 'corner';
}

/** A stop that must hold before he goes (see TOUR.holdS). */
export interface StopHold { stop: StopName | null; candidate: StopName | null; since: number }
export const createStopHold = (): StopHold => ({ stop: null, candidate: null, since: NaN });

/** Feeds the stop seen now; returns the stop he goes for (the first one at once). */
export function holdStop(h: StopHold, seen: StopName, now: number, holdS = TOUR.holdS): StopName {
  if (h.stop === null) { h.stop = seen; h.candidate = seen; h.since = now; return seen; }
  if (seen !== h.candidate) { h.candidate = seen; h.since = now; }
  if (seen !== h.stop && now - h.since >= holdS) h.stop = seen;
  return h.stop;
}

/**
 * Where he rests at a stop (window px): in the room stage right of a heading (realms, works), or in
 * the middle of the space below the cards (bottom). Clear of every obstacle (they include the swirl
 * clouds), or null when no room fits him there.
 */
export function restSpot(stop: 'realms' | 'works' | 'bottom', anchor: Rect, view: Rect, obstacles: readonly Rect[], o: SpaceOptions): Spot | null {
  if (stop === 'bottom') {
    // the stage's middle: the open space round the end of the cards (beside the last row, above the
    // footer), as near the middle of the window as it fits him, at his full calm size if it can
    return findSpace(view, obstacles, { ...o, maxH: o.maxH * TOUR.bottomGrow }, { near: { cx: (view.left + view.right) / 2, cy: (view.top + view.bottom) / 2 } });
  }
  const cy = (anchor.top + anchor.bottom) / 2;
  const room: Rect = {
    left: anchor.right + TOUR.sidePad, right: view.right,
    top: Math.max(view.top, cy - TOUR.sideBand / 2), bottom: Math.min(view.bottom, cy + TOUR.sideBand / 2),
  };
  if (room.right - room.left < o.minH * o.aspect) return null;
  // close beside the heading, level with it
  return findSpace(room, obstacles, o, { near: { cx: room.left + (room.right - room.left) * 0.35, cy } });
}
