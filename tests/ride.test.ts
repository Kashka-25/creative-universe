import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aimStep, createAim, createRider, followStep, moveKind, overlapArea, RIDE, sweep } from '../src/guide/ride';
import { cloudRect } from '../src/guide/negativeSpace';
import { STILL_S } from '../src/guide/companion';
import type { Spot } from '../src/guide/space';

/** Runs his drift for `seconds` at `fps`, returning his x and his speed on every frame. */
function run(from: Spot, aim: Spot, fps: number, seconds: number) {
  const r = createRider(from);
  const xs: number[] = [r.x];
  const vs: number[] = [0];
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const x0 = r.x;
    followStep(r, aim, 1 / fps);
    xs.push(r.x);
    vs.push((r.x - x0) * fps);
  }
  return { r, xs, vs };
}

describe('riding his cloud: the drift', () => {
  const from: Spot = { cx: 100, cy: 400, h: 180 }, far: Spot = { cx: 1100, cy: 400, h: 180 };

  it('never overshoots, and comes to rest at his aim', () => {
    const { r, xs } = run(from, far, 60, 8);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(far.cx + 1e-6);
    expect(r.x).toBeCloseTo(far.cx, 1);
  });

  it('never passes his top speed, and gathers and loses speed smoothly (no jump from one frame to the next)', () => {
    const { vs } = run(from, far, 60, 8);
    expect(Math.max(...vs)).toBeLessThanOrEqual(RIDE.vmax * 1.001);
    expect(Math.max(...vs)).toBeGreaterThan(RIDE.vmax * 0.8);         // a long way: he does ride at speed
    for (let i = 2; i < vs.length; i++) expect(Math.abs(vs[i] - vs[i - 1])).toBeLessThan(RIDE.vmax * 0.11);
  });

  it('is the same at any frame rate', () => {
    const a = run(from, far, 60, 2).r, b = run(from, far, 30, 2).r, c = run(from, far, 144, 2).r;
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
    expect(Math.abs(a.x - c.x)).toBeLessThan(0.5);
  });

  it('leans gently into his way of travel, and straightens as he arrives', () => {
    const r = createRider(from);
    let most = 0;
    for (let i = 0; i < 60 * 6; i++) { followStep(r, far, 1 / 60); most = Math.max(most, r.bank); }
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(RIDE.bankDeg + 1e-6);
    expect(Math.abs(r.bank)).toBeLessThan(0.05);
  });
});

describe('riding his cloud: his aim (hysteresis)', () => {
  const a: Spot = { cx: 200, cy: 300, h: 150 }, slightly: Spot = { cx: 900, cy: 300, h: 170 }, much: Spot = { cx: 900, cy: 300, h: 220 };

  it('keeps his aim while it is clear and in view, whatever slightly better space comes and goes', () => {
    const aim = createAim();
    expect(aimStep(aim, { now: 0, best: a, ok: false })).toBe('move');
    for (let t = 0.1; t < 10; t += 0.12) {
      expect(aimStep(aim, { now: t, best: Math.floor(t * 3) % 2 ? slightly : a, ok: true })).toBe('keep');
    }
    expect(aim.spot).toBe(a);
  });

  it('takes a clearly larger space only once it has held a while', () => {
    const aim = createAim();
    aimStep(aim, { now: 0, best: a, ok: false });
    expect(aimStep(aim, { now: 1, best: much, ok: true })).toBe('keep');
    expect(aimStep(aim, { now: 1 + RIDE.betterS * 0.5, best: much, ok: true })).toBe('keep');
    expect(aimStep(aim, { now: 1 + RIDE.betterS, best: much, ok: true })).toBe('move');
    expect(aim.spot).toBe(much);
  });

  it('moves at once when his aim is no longer clear, and has none when nowhere fits', () => {
    const aim = createAim();
    aimStep(aim, { now: 0, best: a, ok: false });
    expect(aimStep(aim, { now: 0.1, best: slightly, ok: false })).toBe('move');
    expect(aimStep(aim, { now: 0.2, best: null, ok: false })).toBe('none');
  });

  it('never rides across content: he waits where he is while that is clear, else fades out and in', () => {
    expect(moveKind(true, true)).toBe('ride');
    expect(moveKind(true, false)).toBe('ride');
    expect(moveKind(false, true)).toBe('wait');
    expect(moveKind(false, false)).toBe('hop');
  });

  it('can see content the scroll is carrying towards him a moment early', () => {
    const box = { left: 0, top: 500, right: 100, bottom: 600 };
    expect(sweep([box], 0)[0]).toEqual(box);
    expect(sweep([box], 300)[0].top).toBeCloseTo(500 - 300 * RIDE.sweepS);         // scrolling down: content rises
    expect(sweep([box], -300)[0].bottom).toBeCloseTo(600 + 300 * RIDE.sweepS);
    expect(sweep([box], 5000)[0].top).toBe(500 - RIDE.sweepMax);                    // a fling: at most sweepMax
  });
});

describe('the section swirl clouds are content to him', () => {
  it('a cloud covers the whole of its drift', () => {
    const r = cloudRect({ left: 100, top: 100, right: 300, bottom: 200 }, 12, -6, 6);
    expect(r).toEqual({ left: 82, top: 88, right: 318, bottom: 212 });
    expect(overlapArea({ left: 310, top: 150, right: 400, bottom: 250 }, [r])).toBeGreaterThan(0);   // close to it is on it
    expect(overlapArea({ left: 320, top: 150, right: 400, bottom: 250 }, [r])).toBe(0);
  });

  it('every look (the finder, his way, his own box) counts the clouds, from a cached layout', () => {
    const ns = readFileSync(new URL('../src/guide/negativeSpace.ts', import.meta.url), 'utf8');
    expect(ns).toMatch(/const CLOUD = '\.sky-cloud\.is-loaded';/);
    expect(ns).toMatch(/obstacles\.push\(\.\.\.cloudRects\(W, H, band\)\);/);
    expect(ns).toMatch(/new MutationObserver/);
    expect(ns).toMatch(/new ResizeObserver\(invalidate\)/);
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/const m = layout\.current\?\.get\(vw0, vh0\);/);
    expect(home).not.toMatch(/measurePage\(/);
  });
});

describe('under reduced motion he never rides', () => {
  it('the still companion moves only once scrolling has stopped, and only with a fade', () => {
    expect(STILL_S).toBeGreaterThan(0);
    expect(STILL_S).toBeLessThanOrEqual(0.6);
    const poster = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    expect(poster).toMatch(/const still = prefersReducedMotion\(\);/);
    expect(poster).toMatch(/if \(!dwelled\(dwell, now \/ 1000, STILL_S\)\) return;/);
    expect(poster).toMatch(/if \(!was \|\| still \|\|/);                     // reduced motion: out, moved unseen, faded in
    // the 3D companion (never shown under reduced motion: GuideProvider stills him) would hop, not ride
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/if \(kind === 'ride' && !reduced\) P\.target = P\.aim\.spot;/);
  });
});
