import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnimationClip, Group, NumberKeyframeTrack, Object3D, VectorKeyframeTrack } from 'three';
import { createIdleScheduler, reactionFor, type IdleOptions } from '../src/guide/idle';
import {
  ASIDE, ASIDE_OMEGA, belowCorner, carryAcross, carryFrom, columnRight, controlInCorner, CORNER_MARGIN, cornerClear, createAside, createSmallViewport, createStableViewport, DOCK,
  endRoom, FIGURE, FOLLOW_NEAR, followWeight, glideStep, glideStiffness, heroRect, layerAnchor, nextDocked, nextLayerMode, PEEK, placement, springStep,
  stepAside, tuckDrop, type Box, type Glide, type LayerInputs,
} from '../src/guide/docking';
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

// ── docking ────────────────────────────────────────────────

const box = (top: number, height = 400): Box => ({ top, bottom: top + height, left: 600, width: 400, height });

describe('docking to the corner', () => {
  const H = 900;
  it('uses separate thresholds to leave and to come back, so he never hops at the edge', () => {
    // in the hero: he stays while the hero is still reasonably in view
    expect(nextDocked(false, box(-200), H)).toBe(false);            // bottom at 200 (> 20%)
    expect(nextDocked(false, box(-300), H)).toBe(true);             // bottom at 100 (< 20%): docks
    // docked: he only comes back once the hero is clearly in view
    expect(nextDocked(true, box(-200), H)).toBe(true);              // bottom 200 < 35%
    expect(nextDocked(true, box(-50), H)).toBe(false);              // bottom 350 > 35%
    // scrolling back and forth around one edge: one change, not a flicker
    let docked = false;
    const changes: number[] = [];
    for (const top of [-150, -200, -240, -200, -100, -150, -240, -40]) {
      const next = nextDocked(docked, box(top), H);
      if (next !== docked) changes.push(top);
      docked = next;
    }
    expect(changes).toEqual([-240, -40]);
    expect(DOCK.enter.bottom).toBeGreaterThan(DOCK.leave.bottom);
  });

  it('anchors his layer in the page while he sits in the hero, and changes only while the page is still or he is out of view', () => {
    const i = (o: Partial<LayerInputs> = {}): LayerInputs => ({ inHero: true, scrollIdle: true, outOfView: false, settled: true, fits: true, ...o });
    // in the hero, arrived, page still: anchored in the page (the browser scrolls him with it)
    expect(nextLayerMode('fixed', i())).toBe('attached');
    // not while the page is moving, not mid-glide, not if the hero would not fit
    expect(nextLayerMode('fixed', i({ scrollIdle: false }))).toBe('fixed');
    expect(nextLayerMode('fixed', i({ settled: false }))).toBe('fixed');
    expect(nextLayerMode('fixed', i({ fits: false }))).toBe('fixed');
    expect(nextLayerMode('fixed', i({ inHero: false }))).toBe('fixed');
    // anchored: he stays with the hero while it is in the hero (scrolling or not)
    expect(nextLayerMode('attached', i({ scrollIdle: false }))).toBe('attached');
    // time to dock: only once the page is still, or he has scrolled out of view with the hero
    expect(nextLayerMode('attached', i({ inHero: false, scrollIdle: false }))).toBe('attached');
    expect(nextLayerMode('attached', i({ inHero: false, scrollIdle: false, outOfView: true }))).toBe('fixed');
    expect(nextLayerMode('attached', i({ inHero: false }))).toBe('fixed');
    // a resized page that no longer holds the hero inside the layer: let go at the next still moment
    expect(nextLayerMode('attached', i({ fits: false, scrollIdle: false }))).toBe('attached');
    expect(nextLayerMode('attached', i({ fits: false }))).toBe('fixed');
  });

  it('anchors the layer on the hero, inside the page, so it never makes the page longer', () => {
    expect(layerAnchor(100, 600, 900, 4000)).toEqual({ top: 0, fits: true });        // near the top: from the page's top
    expect(layerAnchor(1500, 400, 900, 4000)).toEqual({ top: 1250, fits: true });    // centred on the hero
    expect(layerAnchor(3800, 150, 900, 4000)).toEqual({ top: 3100, fits: true });    // near the bottom: kept inside the page
    expect(layerAnchor(100, 1200, 900, 4000).fits).toBe(false);                     // taller than the layer: stays fixed
  });

  it('docks on pages without a hero', () => {
    expect(nextDocked(false, null, H)).toBe(true);
  });

  it('ignores a phone URL bar sliding in and out (the large viewport height)', () => {
    const stable = createStableViewport();
    expect(stable(390, 664)).toBe(664);
    expect(stable(390, 740)).toBe(740);        // bar hidden
    expect(stable(390, 664)).toBe(740);        // bar back: still the large height
    expect(stable(844, 340)).toBe(340);        // rotated: start again
    expect(stable(844, 200)).toBe(200);        // a window made much shorter is a real change
  });

  it('measures the corner from the small viewport, so the URL bar never moves him or hides him', () => {
    const small = createSmallViewport();
    expect(small(390, 740)).toBe(740);
    expect(small(390, 664)).toBe(664);       // bar showing
    expect(small(390, 740)).toBe(664);       // bar hidden: the corner stays where it was
    expect(small(844, 340)).toBe(340);       // rotated: start again
    expect(small(844, 600)).toBe(600);       // a window made much taller is a real change
    // he peeks up from the corner of what is always visible, not from behind the bar
    expect(placement(true, null, 390, 664, true).cy).toBeLessThan(664);
    expect(placement(true, null, 390, 664, true).cy).toBeLessThan(placement(true, null, 390, 740, true).cy);
  });

  it('places him in the hero, docked beside the column, or as the small companion peeking up from the corner', () => {
    expect(placement(false, box(100), 1440, 900)).toEqual({ cx: 800, cy: 300, h: 368 });
    const corner = placement(true, null, 1920, 1080);
    expect(corner.h).toBe(170);
    expect(corner.cx).toBeCloseTo(1920 - 170 * 0.62);
    // peeking: small (at most 118 px on a phone, a little larger on a tablet or laptop), against the
    // right edge, with only his top PEEK.show above the bottom edge
    for (const [W, H, most] of [[375, 667, 118], [390, 844, 118], [768, 1024, 150], [1280, 800, 150], [1440, 900, 150]]) {
      const p = placement(true, null, W, H, true);
      expect(p.h, `${W} x ${H}`).toBeLessThanOrEqual(most);
      expect(p.h, `${W} x ${H}`).toBeLessThanOrEqual(H * 0.19 + 1e-9);
      expect(p.h, `${W} x ${H}`).toBeGreaterThan(80);
      const top = p.cy - (p.h * FIGURE) / 2, bottom = p.cy + (p.h * FIGURE) / 2;
      expect(H - top, `${W} x ${H}`).toBeCloseTo(p.h * PEEK.show);                 // his head, shoulders, sun and bolt show
      expect(bottom, `${W} x ${H}`).toBeGreaterThan(H);                            // the rest below the edge
      expect(p.cx + (p.h * FIGURE) / 2, `${W} x ${H}`).toBeLessThanOrEqual(W);     // inside the window
    }
    expect(placement(true, null, 375, 812, true).h).toBeCloseTo(118);
    expect(placement(true, null, 1280, 800, true).h).toBeGreaterThan(placement(true, null, 390, 844, true).h);
  });

  it('glides with an eased, critically damped spring: no jump, no overshoot', () => {
    let x = 0, v = 0;
    const path: number[] = [];
    for (let i = 0; i < 240; i++) {
      [x, v] = springStep(x, v, 1, glideStiffness(i / 60), 1 / 60);
      path.push(x);
    }
    expect(path[0]).toBeLessThan(0.01);                 // starts gently (zero speed)
    expect(Math.max(...path)).toBeLessThanOrEqual(1 + 1e-9);
    expect(path[239]).toBeGreaterThan(0.999);
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeGreaterThanOrEqual(path[i - 1] - 1e-12);
    expect(glideStiffness(0)).toBeLessThan(glideStiffness(5));
  });

  // drives glideStep as HomeStage does (since resets when he changes place, then counts up)
  const glideTo = (g: Glide, spotAt: (t: number) => { cx: number; cy: number; h: number }, seconds: number, each: (prev: { x: number; y: number }, spot: { cx: number; cy: number }) => void) => {
    const dt = 1 / 60;
    for (let i = 0; i < seconds * 60; i++) {
      const spot = spotAt(i * dt);
      const prev = { x: g.x, y: g.y };
      glideStep(g, spot, dt);
      each(prev, spot);
      g.since += dt;
    }
  };

  it('glides back to a hero that is moving (scrolling up to it) without ever moving away from it or dipping off the window', () => {
    // docked in the corner of a 1200 x 800 window; a smooth scroll back to the top brings the hero
    // down from above the window, and he heads back once docking says it is clearly in view
    const W = 1200, H = 800;
    const corner = placement(true, null, W, H);
    const easeOut = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
    for (const seconds of [0.5, 0.9, 1.4]) {
      const g: Glide = { x: corner.cx, vx: 0, y: corner.cy, vy: 0, h: corner.h, vh: 0, tx: corner.cx, ty: corner.cy, since: 0 };
      let docked: boolean = true;
      let lowest = g.y;
      let returned = false;
      const dt = 1 / 60;
      for (let i = 0; i < 4 * 60; i++) {
        const top = 170 - 1400 * (1 - easeOut((i * dt) / seconds));          // the hero box ends at 170..670
        const rect: Box = { top, bottom: top + 500, left: 350, width: 500, height: 500 };
        const was: boolean = docked;
        docked = nextDocked(docked, rect, H);
        if (docked !== was) { g.since = 0; returned = true; }
        const spot = docked ? corner : placement(false, rect, W, H);
        const prev = { x: g.x, y: g.y };
        glideStep(g, spot, dt);
        const step = { x: g.x - prev.x, y: g.y - prev.y };
        const toward = { x: spot.cx - prev.x, y: spot.cy - prev.y };
        expect(step.x * toward.x + step.y * toward.y, `${seconds} s scroll, frame ${i}`).toBeGreaterThanOrEqual(-1e-6);   // never away from it
        lowest = Math.max(lowest, g.y);
        g.since += dt;
      }
      expect(returned).toBe(true);
      expect(lowest, `${seconds} s scroll`).toBeLessThanOrEqual(corner.cy + 1e-6);   // no dip towards the bottom edge
      expect(Math.abs(g.y - 420)).toBeLessThan(1);                                    // and there: the hero's centre
    }
    // once there he moves with it exactly (no swimming behind it as the page scrolls)
    expect(followWeight(0)).toBe(1);
    expect(followWeight(FOLLOW_NEAR)).toBe(0);
    const g: Glide = { x: 600, vx: 0, y: 420, vy: 0, h: 380, vh: 0, tx: 600, ty: 420, since: 5 };
    glideStep(g, { cx: 600, cy: 470, h: 380 }, 1 / 60);
    expect(g.y).toBeCloseTo(470, 6);
  });

  it('stays on the bottom edge when a phone URL bar slides, even while he is stepping aside', () => {
    // his layer is held to the window's bottom edge (100lvh tall), and he stands on the layer's own
    // bottom: as the bar hides and comes back (innerHeight 664 -> 740 -> 664, the layer's top
    // -76 -> 0 -> -76) his place in the layer never changes, so nothing jumps, tucked or not
    const W = 390, lvh = 740, small = 664;
    const css = readFileSync(new URL('../src/styles/intro.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.guide-layer \{[^}]*top: auto;[^}]*bottom: 0;/);
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/placement\(true, null, W, cornerH, peek, L\.height\)/);
    expect(home).toMatch(/const y = P\.y \+ P\.tuck \* tuckDrop\(P\.h\);/);
    const spot = placement(true, null, W, small, true, lvh);                       // in the layer's px
    const g: Glide = { x: spot.cx, vx: 0, y: spot.cy, vy: 0, h: spot.h, vh: 0, tx: spot.cx, ty: spot.cy, since: 5 };
    let tuck = 0, vtuck = 0, prevScreen = NaN, maxStep = 0, minTuck = 1, maxTuck = 0;
    for (let i = 0; i < 180; i++) {
      // stepping aside from frame 0; the bar hides at frame 12 (tuck about 0.3) and returns at frame 20
      const vh = i >= 12 && i < 20 ? lvh : small;
      const layerTop = vh - lvh;
      glideStep(g, placement(true, null, W, small, true, lvh), 1 / 60);
      g.since += 1 / 60;
      [tuck, vtuck] = springStep(tuck, vtuck, 1, ASIDE_OMEGA, 1 / 60);
      if (i >= 12 && i < 20) { minTuck = Math.min(minTuck, tuck); maxTuck = Math.max(maxTuck, tuck); }
      const y = g.y + tuck * tuckDrop(g.h);
      // on the screen (the bar's 76 px above the window when it shows): the layer's bottom is the screen's
      const screen = (lvh - vh) + layerTop + y;
      if (i > 0) maxStep = Math.max(maxStep, Math.abs(screen - prevScreen));
      prevScreen = screen;
    }
    expect(minTuck).toBeGreaterThan(0.2);                // the bar moved while he was partly tucked
    expect(maxTuck).toBeLessThan(0.6);
    expect(maxStep).toBeLessThan(6);                     // never a jump: only the eased step aside
  });

  it('comes up into the corner from just below the window when a fling carried the hero (and him) out of view', () => {
    const corner = placement(true, null, 1200, 800);
    const b = belowCorner(corner, 800);
    expect(b.x).toBe(corner.cx);
    expect(b.h).toBe(corner.h);                                                             // already corner-sized
    expect(b.y - b.h * 0.5).toBeGreaterThan(800);                                           // starts just out of sight below
    const g: Glide = { x: b.x, vx: 0, y: b.y, vy: 0, h: b.h, vh: 0, tx: corner.cx, ty: corner.cy, since: 0 };
    let prevY = g.y;
    glideTo(g, () => corner, 3, () => {
      expect(g.y).toBeLessThanOrEqual(prevY + 1e-9);                                        // only ever upwards: never across the page
      expect(g.y).toBeGreaterThanOrEqual(corner.cy - 1e-6);                                 // no overshoot
      prevY = g.y;
    });
    expect(Math.abs(g.y - corner.cy)).toBeLessThan(1);
  });

  it('stays where he is on screen when the hero leaves with the page (a change of page), and glides on from there', () => {
    // 1280 x 800 window, scrolled 0; his layer anchored in the page with the hero at 120..620
    const W = 1280, H = 800;
    const hero: Box = { top: 120, bottom: 620, left: 640, width: 520, height: 500 };
    const spot = placement(false, hero, W, H);
    const g: Glide = { x: spot.cx, vx: 0, y: spot.cy, vy: 0, h: spot.h, vh: 0, tx: spot.cx, ty: spot.cy, since: 5 };
    const attachedLayer = { left: 0, top: 0 };
    // the route changes: the hero is gone (stage.el null), so the layer lets go: fixed in the window
    const next = nextLayerMode('attached', { inHero: false, scrollIdle: true, outOfView: true, settled: true, fits: false });
    expect(next).toBe('fixed');
    const before = { x: g.x + attachedLayer.left, y: g.y + attachedLayer.top };          // on screen
    const fixedLayer = { left: 0, top: 0 };
    const fromBelow = carryAcross(g, attachedLayer, fixedLayer, next, null, H);
    expect(fromBelow).toBe(false);                                                          // not a fling: no jump below the window
    expect(g.x + fixedLayer.left).toBe(before.x);
    expect(g.y + fixedLayer.top).toBe(before.y);
    // and from there he glides: no frame moves him more than a gentle step
    const corner = placement(true, null, W, H);
    g.since = 0;
    let prev = { x: g.x, y: g.y };
    let maxStep = 0;
    for (let i = 0; i < 180; i++) {
      glideStep(g, corner, 1 / 60);
      maxStep = Math.max(maxStep, Math.hypot(g.x - prev.x, g.y - prev.y));
      prev = { x: g.x, y: g.y };
      g.since += 1 / 60;
    }
    expect(maxStep).toBeLessThan(15);

    // the page scrolled, so the anchored layer sat 300 px up the window: its place is carried exactly
    const g2: Glide = { x: 500, vx: 0, y: 670, vy: 0, h: 400, vh: 0, tx: 500, ty: 670, since: 5 };
    expect(carryAcross(g2, { left: 0, top: -300 }, { left: 0, top: 0 }, 'fixed', null, H)).toBe(false);
    expect(g2.y).toBe(370);
    expect(g2.ty).toBe(370);
    // a fling: the hero is still on the page but out of view above: he comes up from below instead
    const flung: Box = { top: -900, bottom: -400, left: 640, width: 520, height: 500 };
    expect(carryAcross({ ...g2 }, { left: 0, top: -1200 }, { left: 0, top: 0 }, 'fixed', flung, H)).toBe(true);
    expect(carryAcross({ ...g2 }, { left: 0, top: 0 }, { left: 0, top: -100 }, 'attached', flung, H)).toBe(false);
  });

  it('stays where he was last seen when the page changes after a little scroll (the new page scrolls to the top first)', () => {
    // 1280 x 800, home scrolled 250 px with the hero still in view: his layer is anchored at 15 in
    // the page, so it was last drawn at -235 in the window
    const H = 800;
    const g: Glide = { x: 921, vx: 0, y: 439, vy: 0, h: 460, vh: 0, tx: 921, ty: 439, since: 5 };
    const painted = { left: 0, top: -235 };
    const seen = { x: g.x + painted.left, y: g.y + painted.top };
    // the route changes: the hero has gone, and the new page's scrollTo(0) lands before his next
    // frame, so the anchored layer now measures at +15; it lets go, fixed in the window at 0
    const measured = { left: 0, top: 15 };
    const fixed = { left: 0, top: 0 };
    expect(carryAcross(g, carryFrom(painted, measured, null), fixed, 'fixed', null, H)).toBe(false);
    expect(g.x + fixed.left).toBe(seen.x);
    expect(g.y + fixed.top).toBe(seen.y);                                                    // not 250 px lower
    expect(g.ty + fixed.top).toBe(seen.y);
    // with the hero still on the page, the browser scrolled him with it: the layer is where it measures
    const hero: Box = { top: 120, bottom: 620, left: 640, width: 520, height: 500 };
    expect(carryFrom(painted, measured, hero)).toBe(measured);
    expect(carryFrom(null, measured, null)).toBe(measured);                                  // nothing drawn yet
    // and HomeStage carries his place from there, remembering where the layer was each frame
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/carryAcross\(P, carryFrom\(painted\.current, L, r\), moved, next, r, vh\)/);
    expect(home).toMatch(/painted\.current = \{ top: L\.top, left: L\.left \}/);
  });

  it('reads a hero that has left the page (a detached box measures all zeros) as no hero, so a change of page never snaps him', () => {
    const zeros = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    const box: Box = { top: 120, bottom: 620, left: 640, width: 520, height: 500 };
    const detached = { isConnected: false, getBoundingClientRect: () => zeros };
    expect(heroRect(detached)).toBeNull();
    expect(heroRect({ isConnected: true, getBoundingClientRect: () => zeros })).toBeNull();   // no size: no hero either
    expect(heroRect({ isConnected: true, getBoundingClientRect: () => box })).toBe(box);
    expect(heroRect(null)).toBeNull();
    // and the zero box itself never reads as a hero that a fling carried out of the window
    const g0: Glide = { x: 900, vx: 0, y: 370, vy: 0, h: 460, vh: 0, tx: 900, ty: 370, since: 5 };
    expect(carryAcross(g0, { left: 0, top: 0 }, { left: 0, top: 0 }, 'fixed', zeros, 800)).toBe(false);

    // the frame after the click, as HomeStage runs it: he sat in the hero, his layer anchored in the page
    for (const [W, H] of [[1280, 800], [1920, 1080]]) {
      const spot = placement(false, box, W, H);
      const g: Glide = { x: spot.cx, vx: 0, y: spot.cy, vy: 0, h: spot.h, vh: 0, tx: spot.cx, ty: spot.cy, since: 5 };
      const r = heroRect(detached);
      const docked = nextDocked(false, r, H);
      const clear = cornerClear(W, H, 0.9);
      const withHero = !!r && !docked;
      const next = nextLayerMode('attached', { inHero: withHero, scrollIdle: true, outOfView: !r, settled: true, fits: !!r });
      expect(next).toBe('fixed');
      expect(carryAcross(g, { left: 0, top: 0 }, { left: 0, top: 0 }, next, r, H), `${W}`).toBe(false);   // never from below
      const atHero = !!r && (withHero || next === 'attached');
      expect(atHero, `${W}`).toBe(false);                                                      // never to a zero-size hero at the top-left
      // to the corner: docked beside the column where it is clear, else peeking up (a glide either way)
      const to = placement(true, null, W, H, !clear);
      const distance = Math.hypot(to.cx - g.x, to.cy - g.y);
      g.since = 0;
      let prev = { x: g.x, y: g.y };
      const steps: number[] = [];
      for (let i = 0; i < 240; i++) {
        glideStep(g, to, 1 / 60);
        steps.push(Math.hypot(g.x - prev.x, g.y - prev.y));
        expect(g.y, `${W}, frame ${i}`).toBeGreaterThan(spot.cy - 1);                        // never up towards the top-left
        prev = { x: g.x, y: g.y };
        g.since += 1 / 60;
      }
      expect(steps[0], `${W}`).toBeLessThan(Math.max(1, distance * 0.005));                   // starts from rest: no snap
      expect(Math.max(...steps), `${W}`).toBeLessThan(Math.max(1, distance * 0.03));           // the move spread over the glide
      expect(Math.hypot(to.cx - g.x, to.cy - g.y), `${W}`).toBeLessThan(2);                    // and there
    }
  });

  it('docks beside the content column only where the corner lies clear of it (elsewhere he peeks)', () => {
    const share = 0.9;
    for (const [w, h] of [[375, 667], [390, 844], [812, 375], [1024, 768], [1280, 800], [1440, 900]]) {
      expect(cornerClear(w, h, share), `${w} x ${h}`).toBe(false);
    }
    for (const [w, h] of [[1920, 1080], [2560, 1440]]) {
      expect(cornerClear(w, h, share), `${w} x ${h}`).toBe(true);
      const c = placement(true, null, w, h);
      expect(c.cx - (c.h * share) / 2, `${w} x ${h}`).toBeGreaterThanOrEqual(columnRight(w) + CORNER_MARGIN);   // wholly outside the column
    }
    // the column: the page width centred, inside the gutters
    expect(columnRight(375)).toBe(359);
    expect(columnRight(1920)).toBe((1920 + 1180) / 2);
    // a window resized across the edge does not flicker between the two (hysteresis)
    let at = 0;
    for (let w = 1500; w <= 1700; w++) if (cornerClear(w, 900, share)) { at = w; break; }
    expect(at).toBeGreaterThan(0);
    expect(cornerClear(at - 4, 900, share, true)).toBe(true);
    expect(cornerClear(at - 4, 900, share, false)).toBe(false);
  });

  it('is with the visitor on every page at every window size: loaded everywhere, never faded away', () => {
    const provider = readFileSync(new URL('../src/guide/PosterCompanion.tsx', import.meta.url), 'utf8');
    const guide = readFileSync(new URL('../src/guide/GuideProvider.tsx', import.meta.url), 'utf8');
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    // mounted on every page (home at once, elsewhere once the page is idle), and stays for the visit
    expect(guide).toMatch(/\{staged && \(\s*<div className=\{`guide-layer/);
    expect(guide).toMatch(/requestIdleCallback\(\(\) => setPlaced\(true\), \{ timeout: IDLE_LOAD_MS \}\)/);
    expect(guide).toMatch(/useState\(\(\) => location\.pathname === '\/'\)/);
    expect(guide).not.toMatch(/setPlaced\(false\)/);
    expect(guide).toMatch(/if \(!staged \|\| ready\) return;/);
    // no fading away where the corner overlaps the column: nothing of the old rule is left
    expect(guide + home).not.toMatch(/guideCanShow|presence/);
    // lite: his still, only if there is one
    expect(guide).toMatch(/!live3D && mode !== 'off' && <PosterCompanion/);
    expect(provider).toMatch(/onError=\{\(\) => setMissing\(true\)\}/);
  });

  it('draws him above the page\'s content and below the header, its menu, the grain and the veil; taps pass through', () => {
    const css = (f: string) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');
    const intro = css('intro.css'), portfolio = css('portfolio.css'), base = css('base.css'), invitation = css('invitation.css');
    const z = (src: string, sel: string) => Number(new RegExp(`${sel.replace(/[.[\]()]/g, '\\$&')}\\s*\\{[^}]*?z-index:\\s*(-?\\d+)`).exec(src)?.[1]);
    const coco = z(intro, '.guide-layer');
    expect(z(intro, '.guide-poster')).toBe(coco);
    expect(coco).toBeGreaterThan(2);                                       // over the hero's words and anything positioned in the page
    expect(z(portfolio, '.site-header')).toBeGreaterThan(coco);            // the header and its open menu (inside it) over him
    expect(z(base, '.paper-grain')).toBeGreaterThan(coco);
    expect(z(invitation, '.cloud-veil')).toBeGreaterThan(coco);
    // .site is no stacking context of its own (it would put the whole page, header included, on one side of him)
    expect(intro + portfolio + base).not.toMatch(/(^|\n)\.site\s*\{[^}]*z-index/);
    // the same order during a view transition
    const vt = (name: string) => Number(new RegExp(`::view-transition-group\\(${name}\\)\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(base)?.[1]);
    const content = Number(/::view-transition-group\(\*\)\s*\{[^}]*z-index:\s*(\d+)/.exec(base)?.[1]);
    expect(vt('guide')).toBeGreaterThan(content);
    expect(vt('site-header')).toBeGreaterThan(vt('guide'));
    expect(vt('veil')).toBeGreaterThan(vt('site-header'));
    // never takes a tap
    expect(intro).toMatch(/\.guide-layer \* \{ pointer-events: none !important; \}/);
    expect(intro).toMatch(/\.guide-poster \{[^}]*pointer-events: none/);
    // the end of every page keeps room for him
    expect(portfolio).toMatch(/\.site-footer \{[^}]*var\(--guide-room, 0px\)/);
    // focus and anchor scrolling stop above his peek
    expect(base).toMatch(/html \{[^}]*scroll-padding-bottom: var\(--guide-room, 0px\)/);
  });

  it('keeps room at the end of every page for the last line to scroll clear of him', () => {
    for (const [W, H] of [[390, 844], [768, 1024], [1280, 800]]) {
      const p = placement(true, null, W, H, true);
      const top = p.cy - (p.h * FIGURE) / 2;
      expect(endRoom(p.h), `${W} x ${H}`).toBeGreaterThanOrEqual(H - top);
    }
    // a touch phone with its URL bar hidden: sized from the small viewport, he peeks from the window's
    // current bottom, so the room still clears him and he never floats above the edge
    const p = placement(true, null, 390, 664, true, 740);
    const top = p.cy - (p.h * FIGURE) / 2;
    expect(endRoom(p.h)).toBeGreaterThanOrEqual(740 - top);
    expect(p.h).toBe(placement(true, null, 390, 664, true).h);
    expect(top + p.h * FIGURE).toBeGreaterThan(740);
  });

  it('keeps out of the way of a focused control in his corner, never of <main> focused after a change of page', () => {
    const W = 375, H = 812, room = 82, width = 141;
    // a small link at the bottom right, under his peek
    expect(controlInCorner({ top: 770, bottom: 794, left: 300, right: 360, height: 24 }, 0, W, H, room, width)).toBe(true);
    // the same link elsewhere: not in his corner
    expect(controlInCorner({ top: 400, bottom: 424, left: 300, right: 360, height: 24 }, 0, W, H, room, width)).toBe(false);
    expect(controlInCorner({ top: 770, bottom: 794, left: 20, right: 80, height: 24 }, 0, W, H, room, width)).toBe(false);
    // below the window (scrolled past): not hidden by him
    expect(controlInCorner({ top: 830, bottom: 854, left: 300, right: 360, height: 24 }, 0, W, H, room, width)).toBe(false);
    // <main id="main" tabIndex={-1}> focused after a page change or by the skip link: runs through his corner
    const main = { top: 64, bottom: 3183, left: 0, right: 375.2, height: 3119 };
    expect(controlInCorner(main, -1, W, H, room, width)).toBe(false);
    expect(controlInCorner(main, 0, W, H, room, width)).toBe(false);                         // as tall as the window
    expect(controlInCorner({ top: 700, bottom: 800, left: 0, right: 375, height: 100 }, -1, W, H, room, width)).toBe(false);
    // and the companions ask it through focusInCorner
    const docking = readFileSync(new URL('../src/guide/docking.ts', import.meta.url), 'utf8');
    expect(docking).toMatch(/return controlInCorner\(el\.getBoundingClientRect\(\), el\.tabIndex, window\.innerWidth, window\.innerHeight, room, width\);/);
  });

  it('adds up slow, sub-pixel reading scrolls into a step aside', () => {
    const s = createAside(0, 0);
    let y = 0;
    for (let i = 1; i <= 79; i++) { y += 0.5; stepAside(s, y, i / 120, false); }
    expect(s.away).toBe(false);
    y += 0.5;
    expect(stepAside(s, y, 80 / 120, false)).toBe(true);
  });

  it('steps aside while the visitor scrolls down to read, and peeks back up when they stop, scroll up or reach the end', () => {
    const s = createAside(0, 0);
    let t = 0, y = 0;
    const scroll = (dy: number, dt = 1 / 60, atEnd = false) => { t += dt; y += dy; return stepAside(s, y, t, atEnd); };
    // a few px down is not reading: he stays
    for (let i = 0; i < 5; i++) expect(scroll(5)).toBe(false);
    // a clear run down: he steps aside, and stays aside while they keep reading
    expect(scroll(20)).toBe(true);
    for (let i = 0; i < 30; i++) expect(scroll(i % 3 === 0 ? 0 : 8)).toBe(true);
    // a jitter back up of a few px does not bring him back (hysteresis)
    expect(scroll(-6)).toBe(true);
    expect(scroll(4)).toBe(true);
    // a clear run up brings him back
    expect(scroll(-10)).toBe(true);
    expect(scroll(-10)).toBe(false);
    // down again, then still for a moment: he peeks back up after ASIDE.idle, not before
    for (let i = 0; i < 10; i++) scroll(10);
    expect(s.away).toBe(true);
    expect(scroll(0, ASIDE.idle * 0.5)).toBe(true);
    expect(scroll(0, ASIDE.idle * 0.6)).toBe(false);
    // after the pause it takes another clear run down to send him away again (no bob on one px)
    expect(scroll(1)).toBe(false);
    expect(scroll(1)).toBe(false);
    // the end of the page: he is back, however they got there
    for (let i = 0; i < 10; i++) scroll(10);
    expect(scroll(10, 1 / 60, true)).toBe(false);
    // the mobile menu open: out of the way, whatever the scroll
    expect(stepAside(s, y, t + 5, false, true)).toBe(true);
    expect(stepAside(s, y, t + 5.1, false, false)).toBe(false);
    // tiny back-and-forth jitter never moves him
    const j = createAside(0, 0);
    for (let i = 0; i < 300; i++) expect(stepAside(j, i % 2 ? 3 : 0, i / 60, false)).toBe(false);
  });

  it('slips below the edge and back with a gentle, eased spring: no pop, no overshoot, wholly out of sight', () => {
    for (const [W, H, lvh] of [[390, 664, 740], [768, 1024, 1024], [1280, 800, 800]]) {
      const p = placement(true, null, W, H, true);
      const drop = tuckDrop(p.h);
      // stepped aside, no part of him is in the window: below the bottom edge he peeks from (his
      // layer's, held to the window's), even with the URL bar hidden
      const q = placement(true, null, W, H, true, lvh);
      expect(p.cy + drop - (p.h * FIGURE) / 2, `${W}`).toBeGreaterThanOrEqual(H + p.h * 0.1);
      expect(q.cy + drop - (q.h * FIGURE) / 2, `${W}`).toBeGreaterThanOrEqual(lvh + q.h * 0.1);
      let x = 0, v = 0, maxSpeed = 0, first = 0;
      for (let i = 0; i < 120; i++) {
        const prev = x;
        [x, v] = springStep(x, v, 1, ASIDE_OMEGA, 1 / 60);
        if (i === 0) first = (x - prev) * drop;
        maxSpeed = Math.max(maxSpeed, ((x - prev) * drop) * 60);
        expect(x).toBeLessThanOrEqual(1 + 1e-9);
      }
      expect(first, `${W}`).toBeLessThan(1);                    // starts from rest
      expect(maxSpeed, `${W}`).toBeLessThan(400);               // a glide, never a dash (px/s)
      expect(x).toBeGreaterThan(0.99);                          // and there within 2 s
    }
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
