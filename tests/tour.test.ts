import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createStopHold, holdStop, isHome, restSpot, stopFor, TOUR, tourOn, type Anchor } from '../src/guide/tour';
import { spotBox, type Rect } from '../src/guide/space';

const view: Rect = { left: 0, top: 64, right: 1280, bottom: 800 };
/** The home page's three hooks, as they sit in the window when the page is scrolled to `sy` (page px). */
function anchorsAt(sy: number): Anchor[] {
  const at = (top: number, h: number, left = 540, right = 740): Rect => ({ left, right, top: top - sy, bottom: top - sy + h });
  return [
    { name: 'realms', rect: at(900, 48) },
    { name: 'works', rect: at(1500, 48, 470, 810) },
    { name: 'bottom', rect: at(1700, 2400, 48, 1232) },     // the works grid, 1700 .. 4100
  ];
}
/** The hero's Coco place in view: all of it at the top, less as the page scrolls. */
const heroShareAt = (sy: number) => Math.max(0, Math.min(1, (650 - sy) / 520));

/** The stop for each scroll position on the way, as the page is scrolled from `from` to `to` in `steps`. */
function journey(from: number, to: number, steps: number, prev: ReturnType<typeof stopFor> = 'hero') {
  const out: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const sy = from + ((to - from) * i) / steps;
    prev = stopFor(prev, heroShareAt(sy), anchorsAt(sy), view);
    if (out.at(-1) !== prev) out.push(prev);
  }
  return out;
}

describe('the home journey: which stop', () => {
  it('runs on home at laptop and desktop widths only', () => {
    expect(tourOn('#/', 1280)).toBe(true);
    expect(tourOn('#/', 1024)).toBe(true);
    expect(tourOn('#/', 1023)).toBe(false);
    expect(tourOn('#/realm/music', 1920)).toBe(false);
    expect(tourOn('#/about', 1920)).toBe(false);
  });

  it('goes hero → The realms → Works in this world → the corner → the space below the cards, in order', () => {
    expect(journey(0, 4100 - 736 + 300, 400)).toEqual(['hero', 'realms', 'works', 'corner', 'bottom']);
  });

  it('comes back the same way, and back to the hero at the top', () => {
    expect(journey(3664, 0, 400, 'bottom')).toEqual(['bottom', 'corner', 'works', 'realms', 'hero']);
  });

  it('leaves the hero as the visitor starts to scroll away, and takes it back only once it is (nearly) whole', () => {
    expect(stopFor('hero', 0.95, anchorsAt(30), view)).toBe('hero');
    expect(stopFor('hero', TOUR.heroLeave - 0.01, anchorsAt(200), view)).toBe('realms');   // its heading is in view
    expect(stopFor('realms', 0.95, anchorsAt(200), view)).toBe('realms');                   // not yet back: its heading is in view
    expect(stopFor('corner', 0.92, anchorsAt(40), view)).toBe('hero');                      // nearly back, nothing else in view
    expect(stopFor('realms', TOUR.heroBack, anchorsAt(0), view)).toBe('hero');
  });

  it('skips the stops a fast scroll has already passed: straight to the stop in view', () => {
    // a fling from the top to the end of the page: the next stop seen is the last one
    expect(stopFor('hero', 0, anchorsAt(3664), view)).toBe('bottom');
    const h = createStopHold();
    expect(holdStop(h, 'hero', 0)).toBe('hero');
    // stops flicker past for less than the hold: he does not go for them
    expect(holdStop(h, 'realms', 0.05)).toBe('hero');
    expect(holdStop(h, 'works', 0.1)).toBe('hero');
    expect(holdStop(h, 'corner', 0.15)).toBe('hero');
    expect(holdStop(h, 'bottom', 0.2)).toBe('hero');
    expect(holdStop(h, 'bottom', 0.2 + TOUR.holdS)).toBe('bottom');
  });

  it('has hysteresis at every edge (no flicker at a section boundary)', () => {
    // a heading just inside its band keeps its stop when it wobbles a little past the line it entered at
    const enterLine = view.top + (view.bottom - view.top) * TOUR.enter;
    const at = (top: number): Anchor[] => [{ name: 'realms', rect: { left: 540, right: 740, top, bottom: top + 48 } }];
    expect(stopFor('corner', 0, at(enterLine + 10), view)).toBe('realms');                 // in view: it is next
    expect(stopFor('realms', 0, at(enterLine + 40), view)).toBe('realms');
  });
});

describe('the home journey: where he rests', () => {
  const opts = { aspect: 0.8, minH: 110, maxH: 250, pad: 16, edge: 8, step: 16 };
  const heading: Rect = { left: 520, right: 760, top: 300, bottom: 350 };
  const blurb: Rect = { left: 400, right: 880, top: 360, bottom: 390 };
  const cloud: Rect = { left: 900, right: 1100, top: 240, bottom: 380 };     // a section swirl cloud beside the heading
  const cards: Rect[] = [{ left: 48, right: 420, top: 420, bottom: 800 }, { left: 446, right: 818, top: 420, bottom: 800 }];

  const clear = (s: ReturnType<typeof restSpot>, obstacles: Rect[]) => {
    expect(s).not.toBeNull();
    const b = spotBox(s!, opts.aspect);
    for (const o of obstacles) expect(b.right <= o.left || b.left >= o.right || b.bottom <= o.top || b.top >= o.bottom).toBe(true);
    return s!;
  };

  it('beside a heading: stage right of it, level with it, clear of the words, the cards and the swirl cloud', () => {
    const obstacles = [heading, blurb, cloud, ...cards];
    const s = clear(restSpot('realms', heading, view, obstacles, opts), obstacles);
    expect(s.cx).toBeGreaterThan(heading.right);
    expect(Math.abs(s.cy - (heading.top + heading.bottom) / 2)).toBeLessThan(TOUR.sideBand / 2);
  });

  it('below the cards: in the middle of the open stage, as near its middle as fits him', () => {
    const lastRow: Rect = { left: 48, right: 420, top: 64, bottom: 400 };
    const footer: Rect = { left: 480, right: 800, top: 640, bottom: 760 };
    const obstacles = [lastRow, footer];
    const s = clear(restSpot('bottom', { left: 48, right: 1232, top: -2000, bottom: 400 }, view, obstacles, opts), obstacles);
    expect(Math.abs(s.cx - 640)).toBeLessThan(260);
  });

  it('no room: none (he keeps the place he had, or rests in the corner)', () => {
    const wall: Rect = { left: 0, right: 1280, top: 0, bottom: 800 };
    expect(restSpot('works', heading, view, [wall], opts)).toBeNull();
  });
});

describe('the home journey: one Coco, and reduced motion', () => {
  it('flies the hero\'s own Coco (no hand-off), gives him his cloud in flight, and has hooks on the page', () => {
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/const tourHere = tourOn\(page, vw0\) && !P\.away;/);
    expect(home).toMatch(/if \(stop === 'hero' && hero\) target = doc\(toRiding\(hero\)\);/);
    // his cloud is under him at every stop, the hero's included (Cassidy, 10 Nov 2026)
    expect(home).toContain('P.cushion += (1 - P.cushion)');
    const pages = readFileSync(new URL('../src/portfolio/pages.tsx', import.meta.url), 'utf8');
    for (const n of ['realms', 'works', 'bottom']) expect(pages).toMatch(new RegExp(`data-coco-stop="${n}"`));
  });

  it('under reduced motion his still appears at each stop with a fade (the hero keeps its painting)', () => {
    const poster = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    expect(poster).toMatch(/tourStop = stopFor\(tourStop, heroShare, stopAnchors\(\), m\.view\);/);
    expect(poster).toMatch(/hero = tourStop === 'hero';/);
    expect(poster).toMatch(/if \(!dwelled\(dwell, now \/ 1000, STILL_S\)\) return;/);
    expect(poster).toMatch(/if \(!was \|\| still \|\|/);
  });
});

describe('home (Cassidy, 10 Nov 2026: he flies across home; on every other page he rests in the corner)', () => {
  it('knows home from every other page', () => {
    for (const h of ['', '#', '#/', '/']) expect(isHome(h)).toBe(true);
    for (const h of ['#/realm/music', '#/work/you', '#/about', '#/invitation']) expect(isHome(h)).toBe(false);
  });
});
