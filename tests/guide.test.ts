import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnimationClip, Group, NumberKeyframeTrack, Object3D, VectorKeyframeTrack } from 'three';
import { createIdleScheduler, reactionFor, type IdleOptions } from '../src/guide/idle';
import { FLOAT_OMEGA, FOLLOW_NEAR, followWeight, glideStep, retarget, springStep, type Glide } from '../src/guide/glide';
import {
  companionOn, createRoam, findSpace, freeHeight, pathClear, ROAM, roamStep, spaceSizes, spotBox, stillClear, visibleShare,
  type Rect, type RoamInput, type SpaceOptions, type Spot,
} from '../src/guide/space';
import { ClipPlayer, envelope, loopWrapped, makeAdditive, smoothstep } from '../src/characters/ClipPlayer';
import { createSectionWatch } from '../src/guide/attention';
import { freshPace, stepPace } from '../src/invitation/pace';
import { rng } from '../src/guide/idle';

// ── the idle scheduler ─────────────────────────────────────

const LENGTHS: Record<string, number> = { drift_a: 5, drift_b: 5, drift_c: 5, flutter: 0.5, react_left: 1.4, react_right: 1.4, react_smile: 1.2 };
const options = (o: Partial<IdleOptions> = {}): IdleOptions => ({
  drifts: ['drift_a', 'drift_b', 'drift_c'],
  has: (c) => c in LENGTHS,
  length: (c) => LENGTHS[c] ?? 0,
  ...o,
});
const BREATH = 5;

describe('his meditation: rare, varied idles on the breath', () => {
  it('starts drifts only on loop boundaries, every 2 to 4 breaths, never the same twice running', () => {
    const idle = createIdleScheduler(42, 0, options());
    const starts: { loop: number; drift: string }[] = [];
    for (let loop = 1; loop <= 400; loop++) {
      const d = idle.onLoop(loop * BREATH);
      if (d) starts.push({ loop, drift: d });
    }
    expect(starts.length).toBeGreaterThan(80);
    const seen = new Set(starts.map((s) => s.drift));
    expect(seen).toEqual(new Set(['drift_a', 'drift_b', 'drift_c']));    // varied
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i].loop - starts[i - 1].loop;
      expect(gap).toBeGreaterThanOrEqual(2);                              // rare
      expect(gap).toBeLessThanOrEqual(4);
      expect(starts[i].drift).not.toBe(starts[i - 1].drift);
    }
  });

  it('keeps drifts 2 to 4 breaths apart under real frame timing (boundaries land part-way through frames)', () => {
    // driven exactly as HomeStage drives it: a 5 s breath, 5 s drifts, uneven frames between
    // 1/75 and 1/40 s, onLoop at each wrap with the loop's time as the offset
    const BREATHE = new AnimationClip('breathe', 5, [track('x', [0, 2.5, 5], [0, 0.2, 0])]);
    const drifts = ['drift_a', 'drift_b', 'drift_c'].map((n) => new AnimationClip(n, 5, [new NumberKeyframeTrack('bone.position[y]', [0, 2.5, 5], [0, 0.3, 0])]));
    for (const seed of [1, 2, 3]) {
      const { root } = rig();
      const p = new ClipPlayer(root, [BREATHE, ...drifts], { additive: (n) => n.startsWith('drift') });
      p.play('breathe');
      const idle = createIdleScheduler(seed * 7919, 0, options({ length: (c) => p.duration(c) }));
      const jitter = rng(seed);
      let now = 0;
      let loop = 0;
      const starts: number[] = [];
      while (loop < 275) {
        const dt = 1 / 75 + (1 / 40 - 1 / 75) * jitter();
        now += dt;
        const res = p.update(dt);
        if (!res.wrapped) continue;
        loop++;
        const d = idle.onLoop(now, res.mainTime);
        if (d) {
          expect(p.layerCount()).toBe(0);                                // never two at once
          expect(p.layer(d, { startTime: res.mainTime })).toBe(true);
          starts.push(loop);
        }
      }
      const gaps = starts.slice(1).map((s, i) => s - starts[i]);
      expect(gaps.length).toBeGreaterThan(50);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(4);
      p.dispose();
    }
  });

  it('never plays two drifts at once, even if a drift is longer than a breath', () => {
    const idle = createIdleScheduler(7, 0, options({ length: (c) => (c.startsWith('drift') ? 12 : LENGTHS[c] ?? 0) }));
    let busyUntil = -1;
    for (let loop = 1; loop <= 200; loop++) {
      const now = loop * BREATH;
      const d = idle.onLoop(now);
      if (d) {
        expect(now).toBeGreaterThanOrEqual(busyUntil);
        busyUntil = now + 12;
      }
    }
  });

  it('waits for a reaction to finish before drifting', () => {
    const idle = createIdleScheduler(3, 0, options({ driftEvery: [1, 1] }));
    idle.onStimulus(4.9, { kind: 'tap' }, { x: 0.5, y: 0.5 });
    expect(idle.onLoop(5)).toBeNull();
    expect(idle.onLoop(10)).not.toBeNull();
  });

  it('flutters every 6 to 14 seconds, and not during a reaction', () => {
    const idle = createIdleScheduler(11, 0, options());
    const times: number[] = [];
    for (let t = 0; t < 600; t += 1 / 30) if (idle.tick(t)) times.push(t);
    expect(times.length).toBeGreaterThan(40);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      expect(gap).toBeGreaterThanOrEqual(6 - 1 / 30);
      expect(gap).toBeLessThanOrEqual(14 + 1 / 30);
    }
    const busy = createIdleScheduler(11, 0, options({ flutterEvery: [1, 1] }));
    busy.onStimulus(0.9, { kind: 'tap' }, { x: 0.5, y: 0.5 });
    expect(busy.tick(1)).toBeNull();
    expect(busy.tick(busy.reactingUntil + 0.6)).toBe('flutter');
  });

  it('responds towards where things happen, one reaction at a time, with a cooldown at least as long as the clip', () => {
    const him = { x: 0.7, y: 0.5 };
    expect(reactionFor({ kind: 'hover', x: 0.2, y: 0.5 }, him)).toBe('react_right');   // screen-left is his right
    expect(reactionFor({ kind: 'focus', x: 0.95, y: 0.5 }, him)).toBe('react_left');
    expect(reactionFor({ kind: 'section', x: 0.72, y: 0.9 }, him)).toBe('react_smile'); // right in front of him
    expect(reactionFor({ kind: 'tap' }, him)).toBe('react_smile');

    const idle = createIdleScheduler(5, 0, options());
    expect(idle.onStimulus(10, { kind: 'hover', x: 0.1, y: 0.5 }, him)).toBe('react_right');
    expect(idle.onStimulus(10.5, { kind: 'tap' }, him)).toBeNull();                    // one is playing
    expect(idle.onStimulus(10 + LENGTHS.react_right, { kind: 'tap' }, him)).toBeNull(); // still cooling down
    expect(idle.onStimulus(10 + LENGTHS.react_right + 2.6, { kind: 'tap' }, him)).toBe('react_smile');
  });

  it('copes with a model that has fewer clips', () => {
    const idle = createIdleScheduler(1, 0, options({ drifts: [], has: (c) => c === 'react_smile' }));
    for (let loop = 1; loop < 20; loop++) expect(idle.onLoop(loop * BREATH)).toBeNull();
    expect(idle.tick(100)).toBeNull();                                                 // no flutter clip
    expect(idle.onStimulus(1, { kind: 'hover', x: 0, y: 0 }, { x: 0.5, y: 0.5 })).toBe('react_smile');
    const one = createIdleScheduler(1, 0, options({ drifts: ['drift_b'] }));
    const got = Array.from({ length: 40 }, (_, i) => one.onLoop((i + 1) * BREATH)).filter(Boolean);
    expect(new Set(got)).toEqual(new Set(['drift_b']));
  });
});

// ── the negative space he floats in ────────────────────────

const R = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const opts = (W: number, H: number, aspect = 0.9): SpaceOptions => ({ ...spaceSizes(W, H), aspect });

describe('finding empty space', () => {
  it('measures the largest box of his shape that touches no content and stays in the window', () => {
    const view = R(0, 0, 1000, 800);
    // nothing about: as large as the window allows (here, its width at aspect 1)
    expect(freeHeight(500, 400, [], 1, view)).toBe(800);
    expect(freeHeight(500, 400, [], 2, view)).toBe(500);
    // a block to the left, 100 px from the centre: his half-width may reach it, or his half-height clear it
    expect(freeHeight(500, 400, [R(0, 300, 400, 500)], 1)).toBe(200);
    // a block just above: clear in height up to it
    expect(freeHeight(500, 400, [R(0, 0, 1000, 350)], 1)).toBe(100);
    // on content: nothing
    expect(freeHeight(500, 400, [R(450, 350, 550, 450)], 1)).toBe(0);
    // off the window: nothing
    expect(freeHeight(-10, 400, [], 1, view)).toBe(0);
  });

  it('never places him on content, at every window size, and keeps him inside the window', () => {
    // a column of text and cards down the middle, a header across the top
    for (const [W, H] of [[390, 844], [768, 1024], [1280, 800], [1920, 1080]]) {
      const col = Math.min(1180, W - 32);
      const left = (W - col) / 2;
      const content = [R(0, 0, W, 64), R(left, 120, left + col * 0.55, 420), R(left, 470, left + col, 760)];
      const o = opts(W, H);
      const s = findSpace(R(0, 0, W, H), content, o);
      if (!s) continue;                                                    // no room: he fades out (below)
      const box = spotBox(s, o.aspect);
      for (const c of content) expect(overlaps(box, c), `${W} x ${H}`).toBe(false);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(W);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(H);
      expect(s.h).toBeGreaterThanOrEqual(o.minH);
      expect(s.h).toBeLessThanOrEqual(o.maxH);
    }
  });

  it('finds the empty side of the home hero at the top, and prefers the space the page keeps for him', () => {
    const W = 1280, H = 800;
    const header = R(0, 0, W, 72), words = R(64, 160, 600, 620);
    const hero = R(660, 120, 1200, 700);                                   // the hero stage: kept empty for him
    const o = opts(W, H);
    const s = findSpace(R(0, 0, W, H), [header, words], o, { hints: [hero] })!;
    expect(s.cx).toBeGreaterThan(hero.left);
    expect(s.cx).toBeLessThan(hero.right);
    expect(s.cy).toBeGreaterThan(hero.top);
    expect(s.cy).toBeLessThan(hero.bottom);
    expect(s.h).toBe(o.maxH);                                              // a calm size: never larger than the ceiling
  });

  it('has no room on a dense phone page (he fades out), and is smaller on a phone', () => {
    const W = 390, H = 844;
    const dense = [R(0, 0, W, 60), R(16, 70, 374, 300), R(16, 316, 374, 560), R(16, 576, 374, 844)];
    expect(findSpace(R(0, 0, W, H), dense, opts(W, H))).toBeNull();
    expect(spaceSizes(390, 844).maxH).toBeLessThan(spaceSizes(1280, 800).maxH);
    expect(spaceSizes(390, 844).minH).toBeLessThan(spaceSizes(1280, 800).minH);
  });

  it('stays near where he is among spaces as good', () => {
    const W = 1920, H = 1080;
    const column = R(370, 0, 1550, H);                                     // both margins empty and alike
    const o = opts(W, H);
    expect(findSpace(R(0, 0, W, H), [column], o, { near: { cx: 1700, cy: 500 } })!.cx).toBeGreaterThan(1550);
    expect(findSpace(R(0, 0, W, H), [column], o, { near: { cx: 200, cy: 500 } })!.cx).toBeLessThan(370);
  });

  it('measures how much of him is in view and whether his space is still clear', () => {
    const view = R(0, 0, 1000, 800);
    expect(visibleShare({ cx: 500, cy: 400, h: 200 }, 1, view)).toBe(1);
    expect(visibleShare({ cx: 500, cy: 800, h: 200 }, 1, view)).toBeCloseTo(0.5);
    expect(visibleShare({ cx: 500, cy: 1200, h: 200 }, 1, view)).toBe(0);
    const s = { cx: 500, cy: 400, h: 200 };
    expect(stillClear(s, [R(0, 0, 300, 800)], 1, 16)).toBe(true);
    expect(stillClear(s, [R(0, 0, 420, 800)], 1, 16)).toBe(false);       // content has moved in on him
  });
});

describe('keeping his space (no restless wandering)', () => {
  const at = (cy: number, h = 200): Spot => ({ cx: 500, cy, h });
  const input = (o: Partial<RoamInput> = {}): RoamInput => ({ now: 0, scrollIdle: true, best: at(400), clear: true, visible: 1, ...o });

  it('stays while his space is clear and in view, even when other spaces as good come and go', () => {
    const r = createRoam();
    r.spot = at(400);
    const mine = r.spot;
    for (let t = 0; t < 60; t += 0.25) {
      expect(roamStep(r, input({ now: t, best: { cx: 200 + (t * 37) % 600, cy: 300, h: 220 } }))).toBe('stay');
    }
    expect(r.spot).toBe(mine);
  });

  it('moves to a clearly better space only once it has held for a while, with the page still', () => {
    const r = createRoam();
    r.spot = at(400, 140);
    const big = at(600, 300);
    expect(roamStep(r, input({ now: 0, best: big }))).toBe('stay');
    expect(roamStep(r, input({ now: ROAM.betterS - 0.1, best: big }))).toBe('stay');
    expect(roamStep(r, input({ now: ROAM.betterS + 0.1, best: big, scrollIdle: false }))).toBe('stay');   // not while scrolling
    expect(roamStep(r, input({ now: ROAM.betterS + 0.2, best: big }))).toBe('move');
    expect(r.spot).toBe(big);
    // a better space that does not last starts the count again
    const q = createRoam();
    q.spot = at(400, 140);
    roamStep(q, input({ now: 0, best: big }));
    roamStep(q, input({ now: 2, best: at(400, 150) }));
    expect(roamStep(q, input({ now: 3.5, best: big }))).toBe('stay');
  });

  it('leaves at once when content crowds his space: to the best space, or fades out if there is none', () => {
    const r = createRoam();
    r.spot = at(400);
    const other = at(700);
    expect(roamStep(r, input({ clear: false, best: other, scrollIdle: false }))).toBe('move');
    expect(r.spot).toBe(other);
    expect(roamStep(r, input({ clear: false, best: null }))).toBe('none');
    expect(r.spot).toBeNull();
  });

  it('goes with his space as it scrolls away, and floats to a new one once it has held and the page is still', () => {
    const r = createRoam();
    r.spot = at(400);
    const mine = r.spot;
    const next = at(900);
    // scrolling: his space leaving the window, a new one in view, but the page is moving
    for (let t = 0; t < 3; t += 0.25) expect(roamStep(r, input({ now: t, visible: 0.3, best: next, scrollIdle: false }))).toBe('stay');
    expect(r.spot).toBe(mine);
    // the page still again, the new space having held for more than ROAM.openS: he floats to it
    expect(roamStep(r, input({ now: 3.1, visible: 0, best: next }))).toBe('move');
    expect(r.spot).toBe(next);
  });

  it('is never left cut off by the header or an edge: once the page is still he finds a space wholly in view', () => {
    const r = createRoam();
    r.spot = at(400);
    const mine = r.spot;
    const next = at(600);
    // scrolling, partly under the header: he goes with the page
    for (let t = 0; t < 2; t += 0.25) expect(roamStep(r, input({ now: t, visible: 0.8, best: next, scrollIdle: false }))).toBe('stay');
    expect(r.spot).toBe(mine);
    // the page still: a whole space must hold for a moment, then he floats to it
    expect(roamStep(r, input({ now: 2, visible: 0.8, best: next }))).toBe('stay');
    expect(roamStep(r, input({ now: 2 + ROAM.openS + 0.05, visible: 0.8, best: next }))).toBe('move');
    expect(r.spot).toBe(next);
    // wholly in view (within a hair): he stays
    const q = createRoam();
    q.spot = at(400);
    for (let t = 0; t < 5; t += 0.25) expect(roamStep(q, input({ now: t, visible: 0.98, best: next }))).toBe('stay');
  });

  it('comes back from fading out only when a space has held for a moment', () => {
    const r = createRoam();
    expect(roamStep(r, input({ now: 0 }))).toBe('stay');
    expect(roamStep(r, input({ now: 0.3, best: null }))).toBe('stay');        // the space closed again
    expect(roamStep(r, input({ now: 0.5 }))).toBe('stay');
    expect(roamStep(r, input({ now: 0.5 + ROAM.openS }))).toBe('move');
  });

  it('a page scrolled back and forth past a gap does not make him hop (fewer than one move per pass)', () => {
    // a phone page with gaps every 600 px; the visitor scrolls 3000 px down and back up, steadily
    const r = createRoam();
    let moves = 0;
    for (let i = 0; i <= 600; i++) {
      const t = i / 60;
      const y = 1500 - 1500 * Math.cos((Math.PI * 2 * i) / 600);
      const gapAt = Math.round(y / 600) * 600 + 300;                         // the nearest gap, in the document
      const best = Math.abs(gapAt - (y + 422)) < 300 ? { cx: 195, cy: gapAt, h: 110 } : null;
      const mine = r.spot;
      const visible = mine ? Math.max(0, 1 - Math.abs(mine.cy - (y + 422)) / 422) : 0;
      if (roamStep(r, { now: t, scrollIdle: false, best, clear: true, visible }) !== 'stay') moves++;
    }
    expect(moves).toBe(0);                                                    // never while the page is moving
  });
});

describe('his float between spaces', () => {
  it('glides with a soft, critically damped spring: from rest, no overshoot, never a dash, settled in a few seconds', () => {
    const g: Glide = { x: 100, vx: 0, y: 600, vy: 0, h: 200, vh: 0, tx: 100, ty: 600 };
    const to = { cx: 900, cy: 200, h: 260 };
    retarget(g, to);
    const d0 = Math.hypot(to.cx - g.x, to.cy - g.y);
    let prev = { x: g.x, y: g.y };
    let maxSpeed = 0, first = -1;
    for (let i = 0; i < 6 * 60; i++) {
      glideStep(g, to, 1 / 60);
      const step = Math.hypot(g.x - prev.x, g.y - prev.y);
      if (first < 0) first = step;
      maxSpeed = Math.max(maxSpeed, step * 60);
      expect(g.x).toBeLessThanOrEqual(to.cx + 1e-6);                        // no overshoot
      expect(g.y).toBeGreaterThanOrEqual(to.cy - 1e-6);
      prev = { x: g.x, y: g.y };
    }
    expect(first).toBeLessThan(1);                                         // starts from rest: no pop
    expect(maxSpeed).toBeLessThan(d0 * 0.65);                              // calm: under two thirds of the way per second at most
    expect(Math.hypot(to.cx - g.x, to.cy - g.y)).toBeLessThan(2);         // there within 6 s
    expect(Math.abs(g.h - 260)).toBeLessThan(1);
  });

  it('moves with his space exactly as the page scrolls, once he is there (no swimming over the content beside it)', () => {
    expect(followWeight(0)).toBe(1);
    expect(followWeight(FOLLOW_NEAR)).toBe(0);
    const g: Glide = { x: 600, vx: 0, y: 420, vy: 0, h: 300, vh: 0, tx: 600, ty: 420 };
    for (let i = 1; i <= 30; i++) {
      glideStep(g, { cx: 600, cy: 420 - i * 25, h: 300 }, 1 / 60);       // a quick scroll: 1500 px/s
      expect(g.y).toBeCloseTo(420 - i * 25, 4);
    }
  });

  it('springs exactly for any frame length', () => {
    let a: [number, number] = [0, 0];
    for (let i = 0; i < 4; i++) a = springStep(a[0], a[1], 1, FLOAT_OMEGA, 0.25);
    const b = springStep(0, 0, 1, FLOAT_OMEGA, 1);
    expect(a[0]).toBeCloseTo(b[0], 10);
    expect(a[1]).toBeCloseTo(b[1], 10);
  });

  it('never glides across content: a way blocked by a card is faded instead', () => {
    const card: Rect = { left: 400, top: 300, right: 700, bottom: 500 };
    const from = { cx: 200, cy: 400, h: 120 }, to = { cx: 900, cy: 400, h: 120 };
    expect(pathClear(from, to, [card], 0.9)).toBe(false);                  // straight through the card
    expect(pathClear({ ...from, cy: 150 }, { ...to, cy: 150 }, [card], 0.9)).toBe(true);   // above it
    expect(pathClear(to, to, [card], 0.9)).toBe(true);                     // standing still beside it
    expect(pathClear({ cx: 550, cy: 400, h: 120 }, { cx: 550, cy: 400, h: 120 }, [card], 0.9)).toBe(false);
    // a corner clipped part-way, though both ends are clear
    expect(pathClear({ cx: 300, cy: 200, h: 100 }, { cx: 800, cy: 600, h: 100 }, [card], 0.9)).toBe(false);
  });

  it('after a change of page waits for the dwell before he looks, and fades rather than crossing content', () => {
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    const poster = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/if \(!P\.init\) P\.page = page;\s*else if \(page !== P\.page\) \{\s*P\.page = page;\s*layout\.current\?\.invalidate\(\);/);
    expect(home).toMatch(/!pathClear\(here, here, sweep\(m\.obstacles, 0, GUARD\), P\.riding \? companionAspect : aspect\)\) hideQuietly\(true\);/);
    // content come under him: a quick fade out (never a pop), and always a slow fade back in
    expect(home).toMatch(/if \(quick\) layerEl\.dataset\.quick = ''; else delete layerEl\.dataset\.quick;/);
    expect(readFileSync(new URL('../src/styles/intro.css', import.meta.url), 'utf8')).toMatch(/\.guide-layer\[data-quick\] \{ transition-duration: 240ms; \}/);
    // the way is checked against the content (companion.ts planMove, clearOf = space.ts pathClear)
    expect(home).toMatch(/const kind = moveKind\(pathClear\(here, win\(P\.aim\.spot\), m\.obstacles, a\), hereClear && hereStays\);/);
    expect(poster).toMatch(/const SETTLE_MS = 400;/);
    expect(poster).toMatch(/!wayClear\(/);
    // no debugging hooks left on the window
    expect(home + poster).not.toMatch(/__coco|window as unknown as/);
  });
});

describe('where he appears', () => {
  it('keeps the visitor company on every page but About', () => {
    for (const p of ['/', '/realm/music', '/work/yourigin', '/realm/digital', '/nowhere']) expect(companionOn(p), p).toBe(true);
    for (const p of ['/about', '/about/', '/About']) expect(companionOn(p), p).toBe(false);
  });

  it('fades out on About and does not load there on a direct visit', () => {
    const guide = readFileSync(new URL('../src/guide/GuideProvider.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/styles/intro.css', import.meta.url), 'utf8');
    expect(guide).toMatch(/if \(placed \|\| !live3D \|\| !companionOn\(location\.pathname\)\) return;/);
    expect(guide).toMatch(/\$\{away \? ' is-away' : ''\}/);
    expect(css).toMatch(/\.guide-layer\.is-away \{ opacity: 0; \}/);
    expect(css).toMatch(/\.guide-layer \{[^}]*transition: opacity 700ms/);
    // with no room anywhere he fades out where he is, and appears in a new space faded in, never
    // gliding in across the content from an edge
    expect(css).toMatch(/\.guide-layer\.is-ready \{ opacity: var\(--coco-fade, 1\); \}/);
    expect(css).toMatch(/\.guide-layer\[data-appear\] \{ opacity: 0; transition: none; \}/);
    // the veil's instant reveal never turns the fade on About into a pop
    expect(guide).toMatch(/instant && !wasAway && !away \? ' is-instant'/);
  });

  it('rides with the visitor (no waiting); his still companion moves once scrolling stops', () => {
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/followStep\(P\.rider, P\.target, dt\);/);
    expect(home).not.toMatch(/dwelled\(|TEMP/);
    const poster = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    expect(poster).toMatch(/const onScroll = \(\) => touch\(dwell, performance\.now\(\) \/ 1000\);/);
  });

  it('treats the hero space as empty, and the header, cards, text and the drifting swirl clouds as content', () => {
    const ns = readFileSync(new URL('../src/guide/negativeSpace.ts', import.meta.url), 'utf8');
    expect(ns).toMatch(/el\.closest\('\[data-guide-space\], \[data-backdrop\], \.visually-hidden'\)/);
    expect(ns).toMatch(/querySelector\('\.site-header'\)/);              // the header is the view's top edge
    expect(ns).toMatch(/obstacles\.push\(\.\.\.cloudRects\(W, H, band\)\);/);  // the swirl clouds, over their whole drift
    const clouds = readFileSync(new URL('../src/portfolio/SkyClouds.tsx', import.meta.url), 'utf8');
    expect(clouds).toMatch(/className="sky-clouds" data-backdrop aria-hidden/);
    const components = readFileSync(new URL('../src/portfolio/components.tsx', import.meta.url), 'utf8');
    expect(components).toMatch(/className="hero-stage hero-stage--live" data-guide-space/);
  });

  it('draws him above the page\'s content and below the header, its menu, the grain and the veil; taps pass through', () => {
    const css = (f: string) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');
    const intro = css('intro.css'), portfolio = css('portfolio.css'), base = css('base.css'), invitation = css('invitation.css');
    const z = (src: string, sel: string) => Number(new RegExp(`${sel.replace(/[.[\]()]/g, '\\$&')}\\s*\\{[^}]*?z-index:\\s*(-?\\d+)`).exec(src)?.[1]);
    const coco = z(intro, '.guide-layer');
    expect(z(intro, '.guide-poster')).toBe(coco);
    expect(z(portfolio, '.site-header')).toBeGreaterThan(coco);
    expect(z(base, '.paper-grain')).toBeGreaterThan(coco);
    expect(z(invitation, '.cloud-veil')).toBeGreaterThan(coco);
    expect(intro + portfolio + base).not.toMatch(/(^|\n)\.site\s*\{[^}]*z-index/);
    const vt = (name: string) => Number(new RegExp(`::view-transition-group\\(${name}\\)\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(base)?.[1]);
    const content = Number(/::view-transition-group\(\*\)\s*\{[^}]*z-index:\s*(\d+)/.exec(base)?.[1]);
    expect(vt('guide')).toBeGreaterThan(content);
    expect(vt('site-header')).toBeGreaterThan(vt('guide'));
    expect(vt('veil')).toBeGreaterThan(vt('site-header'));
    expect(intro).toMatch(/\.guide-layer \* \{ pointer-events: none !important; \}/);
    expect(intro).toMatch(/\.guide-poster \{[^}]*pointer-events: none/);
    // nothing of the old corner companion is left
    expect(intro + portfolio + base).not.toMatch(/--guide-room|data-attached|hero-stage__greet/);
  });

  it('is mounted on every page (home at once, elsewhere once the page is idle) and stays for the visit; lite gets his still', () => {
    const guide = readFileSync(new URL('../src/guide/GuideProvider.tsx', import.meta.url), 'utf8');
    const poster = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    expect(guide).toMatch(/\{staged && \(\s*<div className=\{`guide-layer/);
    expect(guide).toMatch(/requestIdleCallback\(\(\) => setPlaced\(true\), \{ timeout: IDLE_LOAD_MS \}\)/);
    expect(guide).toMatch(/useState\(\(\) => location\.pathname === '\/'\)/);
    expect(guide).not.toMatch(/setPlaced\(false\)/);
    expect(guide).toMatch(/!live3D && mode !== 'off' && <PosterCompanion away=\{away\} \/>/);
    expect(poster).toMatch(/onError=\{\(\) => setMissing\(true\)\}/);
  });
});

// ── the clip player (three's AnimationMixer, no WebGL) ─────

function rig() {
  const root = new Group();
  const bone = new Object3D();
  bone.name = 'bone';
  root.add(bone);
  return { root, bone };
}
const track = (prop: string, times: number[], values: number[]) =>
  prop === 'x' ? new NumberKeyframeTrack('bone.position[x]', times, values)
    : new VectorKeyframeTrack('bone.position', times, values);

// settle: x falls from 1 to 0 (breathe's first frame) in 1 s; breathe: x 0 → 0.2 → 0 over 2 s
const settle = new AnimationClip('settle', 1, [track('x', [0, 1], [1, 0])]);
const breathe = new AnimationClip('breathe', 2, [track('x', [0, 1, 2], [0, 0.2, 0])]);
// a drift authored as an absolute pose that starts and ends at rest: y 0 → 0.5 → 0
const drift = new AnimationClip('drift_a', 2, [new NumberKeyframeTrack('bone.position[y]', [0, 1, 2], [0, 0.5, 0])]);

describe('the clip player', () => {
  it('hands settle over to breathe at its first frame with no seam', () => {
    const { root, bone } = rig();
    const p = new ClipPlayer(root, [settle, breathe]);
    p.introThenLoop('settle', 'breathe');
    let prev = 1;
    let maxStep = 0;
    for (let i = 0; i < 180; i++) {
      p.update(1 / 60);
      maxStep = Math.max(maxStep, Math.abs(bone.position.x - prev));
      prev = bone.position.x;
    }
    expect(p.current).toBe('breathe');
    expect(maxStep).toBeLessThan(0.02);               // no jump anywhere (one frame is ~0.017)
    // 3 s in: 1 s of settle, then breathe at 2 s → its first frame again
    expect(bone.position.x).toBeCloseTo(0, 5);
    p.dispose();
  });

  it('reports each breathe loop boundary once', () => {
    const { root } = rig();
    const p = new ClipPlayer(root, [breathe]);
    p.play('breathe');
    let wraps = 0;
    for (let i = 0; i < 60 * 10; i++) if (p.update(1 / 60).wrapped) wraps++;
    expect(wraps).toBe(4);                            // 10 s of a 2 s loop: boundaries at 2, 4, 6, 8 (10 lands on the last frame)
    expect(loopWrapped(1.99, 0.01)).toBe(true);
    expect(loopWrapped(0.5, 0.6)).toBe(false);
  });

  it('layers a drift additively on the breath and returns exactly to it', () => {
    const { root, bone } = rig();
    const p = new ClipPlayer(root, [breathe, drift], { additive: (n) => n.startsWith('drift') });
    p.play('breathe');
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    expect(p.layer('drift_a')).toBe(true);
    expect(p.layer('drift_a')).toBe(false);           // never twice at once
    let peak = 0;
    for (let i = 0; i < 60 * 3; i++) { p.update(1 / 60); peak = Math.max(peak, bone.position.y); }
    expect(peak).toBeGreaterThan(0.45);
    expect(p.layerCount()).toBe(0);
    expect(bone.position.y).toBeCloseTo(0, 5);        // back to rest
    expect(bone.position.x).toBeGreaterThanOrEqual(0); // the breath went on underneath
  });

  it('loops his float additively over the breath, eased in, alongside drifts (and does without it if the model has none)', () => {
    const { root, bone } = rig();
    // float: a slow hover, y 0 -> 0.1 -> 0 over 7 s
    const float = new AnimationClip('float', 7, [new NumberKeyframeTrack('bone.position[y]', [0, 3.5, 7], [0, 0.1, 0])]);
    const p = new ClipPlayer(root, [breathe, drift, float], { additive: (n) => n.startsWith('drift') || n === 'float' });
    p.play('breathe');
    expect(p.loopLayer('float', { fadeIn: 2 })).toBe(true);
    expect(p.loopLayer('float')).toBe(false);                     // once
    let prevW = 0, prevY = 0, maxStep = 0;
    for (let i = 0; i < 120; i++) {
      p.update(1 / 60);
      const w = p.loopWeight('float');
      expect(w).toBeGreaterThanOrEqual(prevW);                    // eased in, never a jump
      maxStep = Math.max(maxStep, Math.abs(bone.position.y - prevY));
      prevW = w; prevY = bone.position.y;
    }
    expect(p.loopWeight('float')).toBeCloseTo(1, 5);
    expect(maxStep).toBeLessThan(0.002);
    expect(p.layerCount()).toBe(0);                               // not a one-shot: drifts still come and go on their own
    expect(p.layer('drift_a')).toBe(true);
    // it keeps looping: 3 loops on, still hovering, still breathing underneath
    let peak = 0;
    for (let i = 0; i < 60 * 21; i++) { p.update(1 / 60); peak = Math.max(peak, bone.position.y); }
    expect(p.loopWeight('float')).toBeCloseTo(1, 5);
    expect(peak).toBeGreaterThan(0.09);
    expect(bone.position.x).toBeGreaterThanOrEqual(0);
    p.dispose();
    const none = new ClipPlayer(root, [breathe]);
    none.play('breathe');
    expect(none.loopLayer('float')).toBe(false);
    none.dispose();
  });

  it('makes layered clips additive one at a time (a warm-up spreads them over frames), or when first layered', () => {
    const { root, bone } = rig();
    const other = new AnimationClip('drift_b', 2, [new NumberKeyframeTrack('bone.position[y]', [0, 1, 2], [0, 0.4, 0])]);
    const p = new ClipPlayer(root, [breathe, drift, other], { additive: (n) => n.startsWith('drift') });
    expect(p.has('drift_a')).toBe(true);
    expect(p.duration('drift_b')).toBe(2);
    p.play('breathe');
    expect(p.prepareNext()).toBe(true);                // one made, one left
    expect(p.layer('drift_b')).toBe(true);             // the one left is made on first use
    expect(p.prepareNext()).toBe(false);
    let peak = 0;
    for (let i = 0; i < 60 * 3; i++) { p.update(1 / 60); peak = Math.max(peak, bone.position.y); }
    expect(peak).toBeGreaterThan(0.35);
    expect(bone.position.y).toBeCloseTo(0, 5);
    p.dispose();
  });

  it('plays the main clip at a given speed while crossfades run in real time', () => {
    const { root, bone } = rig();
    const take = new AnimationClip('invite', 10, [track('x', [0, 10], [0, 10])]);
    const p = new ClipPlayer(root, [take]);
    p.play('invite', { loop: false });
    p.setMainSpeed(0.25);
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    expect(bone.position.x).toBeCloseTo(0.25, 3);      // a quarter of a second of the clip in one second
    p.play('invite', { loop: false, time: 5, fade: 0.5 });
    p.setMainSpeed(0);                                 // the new moment holds still...
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    expect(bone.position.x).toBeCloseTo(5, 3);         // ...yet the crossfade to it has finished in its 0.5 s
    p.dispose();
  });

  it('makes clips additive against their own first frame', () => {
    const offset = new AnimationClip('drift_b', 1, [new NumberKeyframeTrack('bone.position[y]', [0, 1], [2, 3])]);
    const add = makeAdditive(offset);
    expect(Array.from((add.tracks[0] as NumberKeyframeTrack).values)).toEqual([0, 1]);
    expect(offset.tracks[0].values[0]).toBe(2);       // the original is untouched
  });

  it('jumps to another moment with an eased crossfade, not a snap', () => {
    const { root, bone } = rig();
    const take = new AnimationClip('invite', 10, [track('x', [0, 10], [0, 10])]);
    const p = new ClipPlayer(root, [take]);
    p.play('invite', { loop: false });
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    expect(bone.position.x).toBeCloseTo(1, 1);
    p.play('invite', { loop: false, time: 6, fade: 0.9 });
    let prev = bone.position.x;
    let maxStep = 0;
    for (let i = 0; i < 90; i++) {
      p.update(1 / 60);
      maxStep = Math.max(maxStep, Math.abs(bone.position.x - prev));
      prev = bone.position.x;
    }
    expect(maxStep).toBeLessThan(0.25);               // a 5-unit jump spread over the fade
    expect(bone.position.x).toBeCloseTo(6 + 1.5, 1);  // now playing on from the new moment
    p.dispose();
  });

  it('keeps the outgoing clip playing while it fades (its motion never stops dead), at the speed it is given', () => {
    const take = new AnimationClip('invite', 10, [track('x', [0, 10], [0, 10])]);
    const still = new AnimationClip('luminous_hold', 2, [track('x', [0, 2], [2, 2])]);
    for (const slowed of [false, true]) {
      const { root, bone } = rig();
      const p = new ClipPlayer(root, [take, still]);
      p.play('invite', { loop: false, time: 1 });
      for (let i = 0; i < 60; i++) p.update(1 / 60);                     // at x = 2, moving 1 unit/s
      expect(bone.position.x).toBeCloseTo(2, 6);
      p.play('luminous_hold', { fade: 0.8 });                              // a hold that starts where the take is
      if (slowed) p.setSpeed('invite', 0);                                 // the take, still fading out, comes to rest
      const xs = [bone.position.x];
      for (let i = 0; i < 60; i++) { p.update(1 / 60); xs.push(bone.position.x); }
      if (slowed) {
        for (const x of xs) expect(x).toBeCloseTo(2, 6);                   // held to its pace under the fade
      } else {
        expect((xs[1] - xs[0]) * 60).toBeGreaterThan(0.9);                 // not frozen on the first frame of the fade
        for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(0.03);   // and eased into the hold
        expect(xs[xs.length - 1]).toBeCloseTo(2, 6);
      }
      p.dispose();
    }
  });

  it('never lets the bind pose show through when a crossfade starts while another is still under way', () => {
    // rest pose (bind) x = 0; the take is around x = 4.7, far from it
    const take = new AnimationClip('invite', 10, [track('x', [0, 10], [4, 6])]);
    const hold = new AnimationClip('luminous_hold', 2, [track('x', [0, 1, 2], [4.9, 5.1, 4.9])]);
    const { root, bone } = rig();
    const p = new ClipPlayer(root, [take, hold]);
    p.play('invite', { loop: false, time: 3.5 });
    for (let i = 0; i < 10; i++) p.update(1 / 60);
    p.play('luminous_hold', { fade: 0.8 });                                 // the trip waits
    for (let i = 0; i < 24; i++) p.update(1 / 60);                         // 0.4 s into that crossfade...
    let prev = bone.position.x;
    p.play('invite', { loop: false, time: 3.8, fade: 0.8 });               // ...it carries on: back to the take
    let maxStep = 0;
    for (let i = 0; i < 90; i++) {
      p.update(1 / 60);
      const sum = p.mainWeights().reduce((a, b) => a + b, 0);
      expect(sum, `frame ${i}`).toBeCloseTo(1, 9);                          // the full-body weights always make 1
      expect(bone.position.x, `frame ${i}`).toBeGreaterThan(4.6);           // never pulled towards the rest pose (x = 0)
      maxStep = Math.max(maxStep, Math.abs(bone.position.x - prev));
      prev = bone.position.x;
    }
    expect(maxStep).toBeLessThan(0.02);
    expect(p.current).toBe('invite');
    p.dispose();
  });

  it('survives a frame with no time in it (a coarse timer reports dt = 0): every action time stays finite, no freeze', () => {
    // driven as the invitation's stage drives its take: the pace's step, then the speed it implies
    const { root, bone } = rig();
    const take = new AnimationClip('invite', 10, [track('x', [0, 10], [0, 10])]);
    const hold = new AnimationClip('luminous_hold', 2, [track('x', [0, 2], [2, 2])]);
    const p = new ClipPlayer(root, [take, hold]);
    p.play('invite', { loop: false, time: 1 });
    const st = freshPace();
    const xs: number[] = [];
    for (const dt of [1 / 60, 1 / 60, 0, 1 / 60, 0, 0, 1 / 60, 1 / 60]) {
      if (xs.length === 4) p.play('luminous_hold', { fade: 0.8 });                    // a copy of the take still fading out, too
      const step = stepPace(st, { waiting: false, roomSeconds: Infinity }, dt);
      p.setSpeed('invite', step / dt);                                                  // 0 / 0 on the empty frames
      p.update(dt);
      for (const a of (p as unknown as { mixer: { _actions: { time: number; timeScale: number }[] } }).mixer._actions) {
        expect(Number.isFinite(a.time)).toBe(true);
        expect(Number.isFinite(a.timeScale)).toBe(true);
      }
      xs.push(bone.position.x);
    }
    for (const x of xs) expect(Number.isFinite(x)).toBe(true);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(0.03);   // no snap to the clip's end
    expect(xs[xs.length - 1]).toBeGreaterThan(1);
    p.dispose();
    // and the stage itself skips such a frame before it ever divides by it
    const stage = readFileSync(new URL('../src/invitation/InvitationStage.tsx', import.meta.url), 'utf8');
    expect(stage).toMatch(/if \(!\(rawDt > 0\)\) return;[\s\S]*const speed = step \/ dt;/);
  });

  it('carries the jump to the glow on without a hitch on its first frame', () => {
    const { root, bone } = rig();
    const take = new AnimationClip('invite', 10, [track('x', [0, 10], [0, 10])]);
    const p = new ClipPlayer(root, [take]);
    p.play('invite', { loop: false });
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    const before = bone.position.x;
    p.play('invite', { loop: false, time: 6, fade: 0.9 });
    p.update(1 / 60);
    expect((bone.position.x - before) * 60).toBeGreaterThan(0.9);          // still moving at its own pace (was frozen: ~0.27)
    p.dispose();
  });

  it('eases one-shots in and out', () => {
    expect(envelope(0, 1, 0.2, 0.2)).toBe(0);
    expect(envelope(0.5, 1, 0.2, 0.2)).toBe(1);
    expect(envelope(1, 1, 0.2, 0.2)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
  });
});

// ── what he notices ────────────────────────────────────────

describe('attention: only what the visitor does', () => {
  it('ignores sections that are already in view when the page appears (no reaction on arrival)', () => {
    const watch = createSectionWatch();
    const hero = {}, realms = {}, works = {};
    expect(watch.entry(hero, true, 0)).toBe(false);          // the first notice only says where it is
    expect(watch.entry(realms, true, 0)).toBe(false);
    expect(watch.entry(works, false, 0)).toBe(false);
    // a later page change (no scroll) that brings a section into view is not the visitor's doing
    expect(watch.entry(works, true, 5000)).toBe(false);
  });

  it('counts a section that comes into view as the visitor scrolls, once', () => {
    const watch = createSectionWatch();
    const realms = {}, already = {};
    watch.entry(realms, false, 0);
    watch.entry(already, true, 0);
    watch.scrolled(2000);
    expect(watch.entry(realms, true, 2100)).toBe(true);
    expect(watch.entry(realms, false, 2500)).toBe(false);
    watch.scrolled(3000);
    expect(watch.entry(realms, true, 3100)).toBe(false);     // once per section
    expect(watch.entry(already, false, 3200)).toBe(false);
    watch.scrolled(4000);
    expect(watch.entry(already, true, 4100)).toBe(false);    // it was there from the start
  });
});
