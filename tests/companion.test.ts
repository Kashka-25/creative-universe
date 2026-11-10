import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  controlInCorner, CORNER_REST, cornerBox, cornerSpot, createDwell, dwelled, DWELL_S, EDGE_MARGIN, PEEK, flightAt, flightBank, flightTimeout, HERO, heroMode, heroSpot, planMove, touch,
  type PlanInput,
} from '../src/guide/companion';
import { companionOn, type Rect, type Spot } from '../src/guide/space';

const view: Rect = { left: 0, top: 64, right: 1280, bottom: 800 };
const ASPECT = 0.8;
const allClear = () => true;
const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  away: false, reduced: false, current: null, currentOk: false, best: { cx: 900, cy: 400, h: 240 },
  view, aspect: ASPECT, clear: allClear, ...o,
});

describe('the dwell timer (his still companion: it moves once scrolling has stopped)', () => {
  it('is 1.2 s', () => {
    expect(DWELL_S).toBe(1.2);
    const d = createDwell(10);
    expect(dwelled(d, 10.5)).toBe(false);
    expect(dwelled(d, 11.19)).toBe(false);
    expect(dwelled(d, 11.2)).toBe(true);
  });

  it('starts again on every scroll or resize', () => {
    const d = createDwell(0);
    touch(d, 1.0);                       // a scroll just before the dwell would have ended
    expect(dwelled(d, 1.2)).toBe(false);
    expect(dwelled(d, 2.19)).toBe(false);
    expect(dwelled(d, 2.2)).toBe(true);
  });
});

describe('where he goes once the page is still', () => {
  it('stays put when his place is still good (no flight)', () => {
    const current: Spot = { cx: 300, cy: 400, h: 240 };
    expect(planMove(input({ current, currentOk: true }))).toEqual({ kind: 'stay' });
  });

  it('never appears on About', () => {
    expect(planMove(input({ away: true }))).toEqual({ kind: 'hide' });
    expect(companionOn('/about')).toBe(false);
  });

  it('under reduced motion he simply appears (no flight)', () => {
    expect(planMove(input({ reduced: true }))).toEqual({ kind: 'appear', to: { cx: 900, cy: 400, h: 240 }, corner: false });
  });

  it('flies from where he is when he is in view and the way is clear', () => {
    const current: Spot = { cx: 300, cy: 700, h: 240 };
    const plan = planMove(input({ current }));
    expect(plan).toMatchObject({ kind: 'fly', from: current, edge: false });
  });

  it('otherwise comes in from the nearer side of the window, at his new space\'s height, out of sight', () => {
    const plan = planMove(input());
    expect(plan.kind).toBe('fly');
    if (plan.kind !== 'fly') return;
    expect(plan.edge).toBe(true);
    expect(plan.from.cy).toBe(400);
    expect(plan.from.cx).toBe(view.right + (240 * ASPECT) / 2 + EDGE_MARGIN);   // the right side is nearer to 900
    const left = planMove(input({ best: { cx: 200, cy: 400, h: 240 } }));
    expect(left.kind === 'fly' && left.from.cx).toBe(view.left - (240 * ASPECT) / 2 - EDGE_MARGIN);
  });

  it('takes the other side if the nearer way crosses content, and fades in when no way is clear', () => {
    const plan = planMove(input({ clear: (from) => from.cx < 0 }));
    expect(plan.kind === 'fly' && plan.from.cx < 0).toBe(true);
    expect(planMove(input({ clear: () => false }))).toEqual({ kind: 'appear', to: { cx: 900, cy: 400, h: 240 }, corner: false });
  });

  it('waits out of sight only when neither a space nor a bottom corner is free', () => {
    expect(planMove(input({ best: null, corner: null, current: { cx: 300, cy: 400, h: 240 } }))).toEqual({ kind: 'hide' });
  });

});

describe('the flight', () => {
  it('follows Blender\'s progress and lift along the line, and leans towards its heading', () => {
    const from: Spot = { cx: -200, cy: 400, h: 200 }, to: Spot = { cx: 800, cy: 400, h: 200 };
    expect(flightAt(from, to, 0, 0)).toEqual(from);
    expect(flightAt(from, to, 1, 0)).toEqual(to);
    expect(flightAt(from, to, 0.5, 0.03)).toEqual({ cx: 300, cy: 400 - 6, h: 200 });
    expect(flightAt(from, to, 1.4, 0)).toEqual(to);          // never past his space
    expect(flightBank(from, to, 3)).toBe(3);
    expect(flightBank(to, from, 3)).toBe(-3);
    expect(flightTimeout(2)).toBeGreaterThan(2);
  });
});

describe('the hero at the top of home', () => {
  const stage: Rect = { left: 666, top: 118, right: 1217, bottom: 713 };

  it('is about 30% larger than his calm size, and stays inside the hero\'s own space', () => {
    const s = heroSpot(stage, 0.73, 320);
    expect(s.h).toBeCloseTo(320 * HERO.grow);
    expect(HERO.grow).toBeGreaterThanOrEqual(1.25);
    expect(HERO.grow).toBeLessThanOrEqual(1.35);
    expect(s.cy - s.h / 2).toBeGreaterThanOrEqual(stage.top);
    expect(s.cy + s.h / 2).toBeLessThanOrEqual(stage.bottom);
    expect((s.h * 0.73) / 2).toBeLessThanOrEqual((stage.right - stage.left) / 2);
    // a small hero space limits him (a phone)
    expect(heroSpot({ left: 16, top: 70, right: 374, bottom: 428 }, 0.73, 180).h).toBeLessThanOrEqual(358 * HERO.heightShare);
  });

  it('hands over to the companion with hysteresis, so only one Coco is ever shown', () => {
    expect(heroMode(false, 1)).toBe(true);
    expect(heroMode(true, 0.5)).toBe(true);
    expect(heroMode(true, 0.4)).toBe(false);
    expect(heroMode(false, 0.5)).toBe(false);
    expect(heroMode(false, 0.7)).toBe(true);
    // the poster companion is hidden while the hero is on screen too
    const poster = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    expect(poster).toMatch(/hero = !!spot && heroMode\(hero,/);
    expect(poster).toMatch(/if \(!dwelled\(dwell, now \/ 1000, STILL_S\)\) return;/);
  });
});

describe('keep him with me: the corner peek when no space fits him', () => {
  const phone: Rect = { left: 0, top: 56, right: 390, bottom: 844 };

  it('falls back to the small companion peeking from the bottom corner, flying in along the bottom edge', () => {
    const corner = cornerSpot(390, 844, 0.75);
    const plan = planMove(input({ view: phone, aspect: 0.75, best: null, corner, clear: () => false }));
    expect(plan.kind).toBe('fly');
    if (plan.kind !== 'fly') return;
    expect(plan.corner).toBe(true);
    expect(plan.to).toEqual(corner);
    expect(plan.from.cy).toBe(corner.cy);                       // level with the corner, from beside the window
    expect(plan.from.cx).toBeGreaterThan(390);                  // the nearer (right) side, out of sight
    // reduced motion: he simply appears there
    expect(planMove(input({ view: phone, aspect: 0.75, best: null, corner, reduced: true }))).toEqual({ kind: 'appear', to: corner, corner: true });
    // already there and still free: nothing happens
    expect(planMove(input({ view: phone, aspect: 0.75, best: null, corner, current: corner, currentOk: true }))).toEqual({ kind: 'stay' });
    // a real empty space always wins over the corner
    const best = { cx: 200, cy: 400, h: 120 };
    expect(planMove(input({ view: phone, aspect: 0.75, best, corner })).kind === 'fly' && (planMove(input({ view: phone, aspect: 0.75, best, corner })) as { corner: boolean }).corner).toBe(false);
    // About: still nothing
    expect(planMove(input({ away: true, best: null, corner }))).toEqual({ kind: 'hide' });
  });

  it("is small and only peeks: the top of him above the bottom edge, inside the window's side", () => {
    const c = cornerSpot(390, 844, 0.75);
    expect(c.h).toBe(118);                                       // as before on a phone
    expect(c.cy - c.h / 2).toBeCloseTo(844 - c.h * PEEK.show);  // 62% of him shows
    expect(c.cx + (c.h * 0.75) / 2).toBeLessThanOrEqual(390);
    expect(cornerSpot(768, 1024, 0.75).h).toBe(150);             // a little larger on a tablet
    const left = cornerSpot(768, 1024, 0.75, 'left');
    expect(left.cx - (left.h * 0.75) / 2).toBeGreaterThanOrEqual(0);
    expect(cornerSpot(390, 844, 0.75, 'right', 1.2).h).toBeCloseTo(118 * 1.2);   // room for his ride cloud
    // his corner rest away from home: the same size, but he and his cloud sit (almost) wholly in view
    const rest = cornerSpot(390, 844, 0.75, 'right', 1.3, CORNER_REST.show);
    const peek = cornerSpot(390, 844, 0.75, 'right', 1.3);
    expect(rest.h).toBe(peek.h);
    expect(rest.cy).toBeLessThan(peek.cy);
    expect(rest.cy + rest.h / 2).toBeLessThanOrEqual(844 + rest.h * 0.05);
  });

  it("keeps clear of a control under the corner (a keyboard-focused or fixed one), never of the page's own focus targets", () => {
    const c = cornerSpot(390, 844, 0.75);
    const area = cornerBox(c, 0.75, 844);
    const button = { left: 300, right: 380, top: 800, bottom: 836, height: 36 };
    expect(controlInCorner(button, 0, 844, area)).toBe(true);
    expect(controlInCorner({ ...button, left: 10, right: 90 }, 0, 844, area)).toBe(false);
    expect(controlInCorner(button, -1, 844, area)).toBe(false);                               // <main> after a change of page
    expect(controlInCorner({ left: 0, right: 390, top: 0, bottom: 844, height: 844 }, 0, 844, area)).toBe(false);
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/if \(cornerFree\(c, a\)\) return \{ spot: c, side \};/);
    expect(home).toMatch(/if \(!cornerFree\(cornerAt\(P\.corner\), P\.riding \? companionAspect : aspect\)\) hideQuietly\(true\);/);
    const poster = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    expect(poster).toMatch(/if \(cornerFree\(at, aspect\)\) \{ nextSide = c; peek = at; break; \}/);
    expect(readFileSync(new URL('../src/styles/intro.css', import.meta.url), 'utf8')).toMatch(/\.guide-poster\.is-corner \{ position: fixed; \}/);
  });
});
