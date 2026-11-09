import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COVER_SECONDS, DEFAULT_REVEAL_SECONDS, easeInOut, parseVeilCurve, sampleCurve } from '../src/veil/curve';
import {
  COVER_FADE_IN_MS, coverageAt, createVeil, HOLD_CAP_MS, MAX_COVER_SECONDS, MAX_EXTRA_HOLD_MS, tabClock, veilAlphaAt,
} from '../src/veil/veil';
import { fakeClock } from './helpers/fakeClock';

const setup = (reduced = false) => {
  const clock = fakeClock();
  const veil = createVeil({ schedule: clock.schedule, now: clock.now, reducedMotion: () => reduced });
  const phases: string[] = [];
  veil.subscribe((p) => phases.push(p));
  return { clock, veil, phases };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the cloud veil', () => {
  it('covers, waits for home to be ready, then clears: idle → covering → covered → revealing → idle', async () => {
    const { clock, veil, phases } = setup();
    let covered: boolean | null = null;
    veil.cover({ origin: { x: 0.4, y: 0.6 } }).then((c) => { covered = c; });
    expect(veil.phase).toBe('covering');
    expect(veil.blocking).toBe(true);
    clock.advance(DEFAULT_COVER_SECONDS * 1000 - 1);
    await flush();
    expect(covered).toBeNull();
    clock.advance(1);
    await flush();
    expect(covered).toBe(true);                        // the page changes underneath now
    expect(veil.phase).toBe('covered');
    veil.ready();                                      // home's guide is drawing
    expect(veil.phase).toBe('revealing');
    expect(veil.blocking).toBe(false);                 // clicks pass as soon as it starts clearing
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);
    expect(veil.phase).toBe('idle');
    expect(phases).toEqual(['covering', 'covered', 'revealing', 'idle']);
  });

  it('never stays up: covered clears after 2.5 s even if home never says it is ready', () => {
    const { clock, veil } = setup();
    veil.cover();
    clock.advance(DEFAULT_COVER_SECONDS * 1000);
    expect(veil.phase).toBe('covered');
    clock.advance(HOLD_CAP_MS - 1);
    expect(veil.phase).toBe('covered');
    clock.advance(1);
    expect(veil.phase).toBe('revealing');
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);
    expect(veil.phase).toBe('idle');
    expect(clock.pending()).toBe(0);
  });

  it('keeps the covered time as short as possible when home is already ready', () => {
    const { clock, veil } = setup();
    veil.cover();
    clock.advance(DEFAULT_COVER_SECONDS * 500);
    veil.ready();                                      // ready before it has fully covered: wait for the cover
    expect(veil.phase).toBe('covering');
    clock.advance(DEFAULT_COVER_SECONDS * 500);
    expect(veil.phase).toBe('revealing');
  });

  it('clears at once from part-way (Escape), and shorter in proportion', async () => {
    const { clock, veil } = setup();
    let covered: boolean | null = null;
    veil.cover().then((c) => { covered = c; });
    clock.advance(DEFAULT_COVER_SECONDS * 500);
    const part = veil.coverage();
    expect(part).toBeGreaterThan(0.2);
    expect(part).toBeLessThan(0.8);
    veil.reveal();
    expect(veil.phase).toBe('revealing');
    expect(veil.coverage()).toBeCloseTo(part, 5);      // no jump
    await flush();
    expect(covered).toBe(false);                       // it never covered: the page goes home as for Escape
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000 * part);
    expect(veil.phase).toBe('idle');
  });

  it('turns round mid-cover smoothly: it carries on a touch at the speed of the cover, then eases out', () => {
    const { clock, veil } = setup();
    veil.cover();
    clock.advance(DEFAULT_COVER_SECONDS * 400);
    const before = veil.coverage(clock.now() - 16);
    const at = veil.coverage();
    const speed = (at - before) / 16;
    expect(speed).toBeGreaterThan(0);
    veil.reveal();
    expect(veil.coverage()).toBeCloseTo(at, 6);                     // no jump
    clock.advance(16);
    const next = veil.coverage();
    expect(next - at).toBeGreaterThan(speed * 16 * 0.6);             // still moving on through the turn: no dead stop
    let peak = next;
    let last = next;
    let falling = false;
    for (let i = 0; i < 200 && veil.phase === 'revealing'; i++) {
      clock.advance(10);
      const c = veil.coverage();
      expect(c).toBeLessThanOrEqual(1);
      if (c < last) falling = true;
      else if (falling) expect(c).toBeLessThanOrEqual(last + 1e-9); // once it recedes it only recedes
      peak = Math.max(peak, c);
      last = c;
    }
    expect(peak).toBeLessThan(at + 0.25);                           // only a touch further
    expect(veil.phase).toBe('idle');
  });

  it('never blocks the page for long, whatever a file asks for, and never plays faster than authored', () => {
    const { clock, veil } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    veil.setMatte(true);
    // 60 samples at 6 fps would be ~10 s of a blocking cover: a broken file, not used at all
    veil.setCurve(parseVeilCurve({ fps: 6, cover: Array.from({ length: 60 }, (_, i) => i / 59), reveal: Array.from({ length: 60 }, (_, i) => 1 - i / 59) }));
    expect(veil.plannedCoverSeconds()).toBe(DEFAULT_COVER_SECONDS);
    veil.cover();
    clock.advance(DEFAULT_COVER_SECONDS * 1000);
    expect(veil.phase).toBe('covered');
    veil.ready();
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);
    expect(veil.phase).toBe('idle');
    // a timeline asking for a long cover: the default instead
    expect(veil.plannedCoverSeconds(9)).toBe(DEFAULT_COVER_SECONDS);
    expect(warn).toHaveBeenCalled();
    // anything within reason plays at exactly its authored length
    expect(veil.plannedCoverSeconds(0.7)).toBe(0.7);
    expect(veil.plannedCoverSeconds(MAX_COVER_SECONDS)).toBe(MAX_COVER_SECONDS);
    veil.setMatte(true);
    veil.setCurve(parseVeilCurve({ fps: 60, cover: Array.from({ length: 121 }, (_, i) => i / 120) }));   // 2 s
    expect(veil.plannedCoverSeconds()).toBeCloseTo(2);
    veil.cover();
    clock.advance(1000);
    expect(veil.coverage()).toBeCloseTo(0.5, 5);                       // half-way at half the authored time
    clock.advance(1000);
    expect(veil.phase).toBe('covered');
    warn.mockRestore();
  });

  it('has no veil under reduced motion: the page simply changes', async () => {
    const { veil, phases } = setup(true);
    const covered = await veil.cover();
    expect(covered).toBe(true);
    expect(veil.phase).toBe('idle');
    expect(phases).toEqual([]);
  });

  it('follows the authored curve when veil.json is there, with the matte it was made for', () => {
    const { clock, veil } = setup();
    const curve = parseVeilCurve({ fps: 60, cover: [0, 0.1, 0.5, 1], reveal: [1, 0.4, 0] })!;
    veil.setCurve(curve);
    veil.setMatte(true);
    expect(veil.plannedCoverSeconds(2)).toBeCloseTo(3 / 60);
    veil.cover({ coverSeconds: 2 });                   // the curve file wins over the timeline's number
    expect(veil.snapshot().curve).toBe(curve);
    clock.advance(1000 / 60);
    expect(veil.coverage()).toBeCloseTo(0.1, 5);
    clock.advance(2000 / 60);
    expect(veil.phase).toBe('covered');
  });

  it('uses the eased bloom, not the curve, when the matte is not in use', () => {
    const { clock, veil } = setup();
    veil.setCurve(parseVeilCurve({ fps: 60, cover: [0.3, 0.6, 1] })!);   // starts part-covered: made for the matte
    expect(veil.plannedCoverSeconds(0.8)).toBe(0.8);                     // the timeline's length instead
    veil.cover({ coverSeconds: 0.8 });
    expect(veil.snapshot().curve).toBeNull();
    expect(veil.coverage()).toBe(0);                                     // no pop to 0.3
    clock.advance(400);
    expect(veil.coverage()).toBeCloseTo(easeInOut(0.5), 5);
  });

  it('gets ready ahead of time, closes the window when the take starts, and frees it all if no trip comes', async () => {
    const { clock, veil } = setup();
    const prepared: string[] = [];
    veil.onPrepare(() => prepared.push('prepare'));
    veil.onRelease(() => prepared.push('release'));
    // nobody asked: nothing to wait for
    let waited = false;
    await veil.whenPrepared(1000).then(() => { waited = true; });
    expect(waited).toBe(true);

    veil.prepare();
    expect(veil.preparing).toBe(true);
    let ready = false;
    veil.whenPrepared(1000).then(() => { ready = true; });
    clock.advance(999);
    await flush();
    expect(ready).toBe(false);
    veil.prepared();                                                     // the view: shader and matte ready
    await flush();
    expect(ready).toBe(true);
    expect(veil.preparing).toBe(false);

    // the view is slow: the take does not wait for long, and the window closes
    veil.release();
    veil.prepare();
    let capped = false;
    veil.whenPrepared(1000).then(() => { capped = true; });
    clock.advance(1000);
    await flush();
    expect(capped).toBe(true);
    expect(veil.preparing).toBe(false);

    // no trip came: released (only while idle)
    veil.release();
    expect(prepared).toEqual(['prepare', 'release', 'prepare', 'release']);
    veil.cover();
    veil.release();                                                      // a trip under way frees itself when it ends
    expect(prepared).toEqual(['prepare', 'release', 'prepare', 'release']);
    expect(clock.pending()).toBeGreaterThan(0);
  });

  it('keeps a request to get ready that arrives while a trip is still clearing, and carries it out once it has', async () => {
    const { clock, veil } = setup();
    const calls: string[] = [];
    veil.onPrepare(() => calls.push(`prepare:${veil.phase}`));
    veil.prepare();
    veil.prepared();
    veil.cover();
    clock.advance(DEFAULT_COVER_SECONDS * 1000);
    veil.ready();                                                        // home is ready: the cloud clears
    expect(veil.phase).toBe('revealing');
    calls.length = 0;
    veil.prepare();                                                      // Replay the welcome, at once
    expect(calls).toEqual([]);                                           // nothing heavy mid-trip
    let ready = false;
    veil.whenPrepared(5000).then(() => { ready = true; });               // the take still waits for it
    await flush();
    expect(ready).toBe(false);
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);
    expect(veil.phase).toBe('idle');
    expect(calls).toEqual(['prepare:idle']);                             // carried out once it has cleared
    expect(veil.preparing).toBe(true);
    veil.prepared();
    await flush();
    expect(ready).toBe(true);
  });

  it('forgets a pending request if the visitor leaves before the trip has cleared', () => {
    const { clock, veil } = setup();
    const calls: string[] = [];
    veil.onPrepare(() => calls.push('prepare'));
    veil.cover();
    clock.advance(DEFAULT_COVER_SECONDS * 1000);
    veil.ready();
    veil.prepare();
    veil.release();                                                      // they left: no trip is coming
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);
    expect(calls).toEqual([]);
    expect(veil.preparing).toBe(false);
  });

  it('reads the clock it is given', () => {
    const { clock, veil } = setup();
    clock.advance(1234);
    expect(veil.now()).toBe(clock.now());
  });

  it("runs the site's veil on a clock that holds while the tab is hidden, and carries on from the same moment", () => {
    const clock = fakeClock();
    let hidden = false;
    let changed = () => {};
    const tc = tabClock({ isHidden: () => hidden, onVisibility: (fn) => { changed = fn; }, now: clock.now, base: clock.schedule });
    let fired = 0;
    tc.schedule(() => fired++, 1000);
    clock.advance(400);
    expect(tc.now()).toBe(400);
    hidden = true;
    changed();
    clock.advance(5000);
    expect(tc.now()).toBe(400);                        // held while hidden
    expect(fired).toBe(0);                             // and so are its timers
    hidden = false;
    changed();
    expect(tc.now()).toBe(400);                        // carries on from the same value: the cloud never jumps
    clock.advance(599);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
    expect(tc.now()).toBe(1000);
    // starting hidden (a tab opened in the background) holds from the start
    const bg = fakeClock();
    bg.advance(9000);
    let bgHidden = true;
    let bgChanged = () => {};
    const late = tabClock({ isHidden: () => bgHidden, onVisibility: (fn) => { bgChanged = fn; }, now: bg.now, base: bg.schedule });
    const startedAt = late.now();
    bg.advance(5000);
    expect(late.now()).toBe(startedAt);                // never moved while it was hidden
    bgHidden = false;
    bgChanged();
    expect(late.now()).toBe(startedAt);                // shown: carries on from where it started
    bg.advance(100);
    expect(late.now()).toBe(startedAt + 100);          // and then runs with the tab
  });

  it("waits a little longer for home's guide while it is visibly warming up underneath, but never for ever", () => {
    const { clock, veil } = setup();
    veil.cover();
    clock.advance(DEFAULT_COVER_SECONDS * 1000);
    expect(veil.phase).toBe('covered');
    clock.advance(1000);
    veil.extendHold(1500);                             // he has started warming up
    clock.advance(HOLD_CAP_MS - 1000);
    expect(veil.phase).toBe('covered');                // past the usual cap, still waiting for him
    veil.ready();                                      // drawing: it clears on him
    expect(veil.phase).toBe('revealing');
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);

    veil.cover();
    veil.extendHold(60_000);                           // asked during the cover, and for far too long
    clock.advance(DEFAULT_COVER_SECONDS * 1000);
    clock.advance(HOLD_CAP_MS + MAX_EXTRA_HOLD_MS - 1);
    expect(veil.phase).toBe('covered');
    clock.advance(1);
    expect(veil.phase).toBe('revealing');              // bounded: it clears anyway
    veil.extendHold();                                 // already clearing: no effect
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);
    expect(veil.phase).toBe('idle');
    veil.extendHold();                                 // no trip: no effect
    expect(clock.pending()).toBe(0);

    veil.cover();                                      // the next trip has the usual cap again
    clock.advance(DEFAULT_COVER_SECONDS * 1000 + HOLD_CAP_MS);
    expect(veil.phase).toBe('revealing');
  });

  it('fades in an authored cover that starts part-way, instead of stepping onto the screen', () => {
    const curve = { fps: 60, cover: [0.3, 0.6, 1], reveal: [1, 0] };
    const snap = { phase: 'covering' as const, since: 0, length: 900, from: 0, origin: { x: 0.5, y: 0.5 }, curve };
    expect(veilAlphaAt(snap, 0)).toBe(0);
    expect(veilAlphaAt(snap, COVER_FADE_IN_MS / 2)).toBeCloseTo(0.5, 5);
    expect(veilAlphaAt(snap, COVER_FADE_IN_MS)).toBe(1);
    let last = -1;
    for (let t = 0; t <= COVER_FADE_IN_MS; t += 4) { const a = veilAlphaAt(snap, t); expect(a).toBeGreaterThanOrEqual(last); last = a; }
    expect(veilAlphaAt({ ...snap, curve: { ...curve, cover: [0, 0.5, 1] } }, 0)).toBe(1);   // starts from nothing: no fade needed
    expect(veilAlphaAt({ ...snap, curve: null }, 0)).toBe(1);                               // the eased default starts at 0
    expect(veilAlphaAt({ ...snap, from: 0.4 }, 0)).toBe(1);                                 // a cover resumed part-way: already on screen
    expect(veilAlphaAt({ ...snap, phase: 'revealing' }, 0)).toBe(1);
  });

  it('announces the trip for screen readers, and forgets it when the cloud has cleared', () => {
    const { clock, veil } = setup();
    veil.cover({ announce: 'The glowing cloud fills the screen and carries you home.' });
    expect(veil.snapshot().announce).toBe('The glowing cloud fills the screen and carries you home.');
    clock.advance(DEFAULT_COVER_SECONDS * 1000);
    veil.ready();
    clock.advance(DEFAULT_REVEAL_SECONDS * 1000);
    expect(veil.phase).toBe('idle');
    expect(veil.snapshot().announce).toBeUndefined();
  });

  it('eases in and out with no hard start or stop, and only rises while covering', () => {
    const { clock, veil } = setup();
    veil.cover();
    let last = -1;
    for (let i = 0; i <= 18; i++) {
      const c = veil.coverage();
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
      clock.advance(DEFAULT_COVER_SECONDS * 1000 / 18);
    }
    expect(easeInOut(0.02)).toBeLessThan(0.002);
    expect(1 - easeInOut(0.98)).toBeLessThan(0.002);
    const snap = { phase: 'covered' as const, since: 0, length: 10, from: 1, origin: { x: 0.5, y: 0.5 }, curve: null };
    expect(coverageAt(snap, 5)).toBe(1);
  });
});

describe('the veil curve file', () => {
  it('reads cover and reveal either way round', () => {
    const c = parseVeilCurve({ fps: 30, cover: [1, 0.5, 0], reveal: [0, 0.6, 1] })!;   // written as "clear" and "revealed"
    expect(c.cover).toEqual([0, 0.5, 1]);
    expect(c.reveal[0]).toBeCloseTo(1);
    expect(c.reveal[2]).toBeCloseTo(0);
    const noReveal = parseVeilCurve({ fps: 30, cover: [0, 1] })!;
    expect(noReveal.reveal).toEqual([1, 0]);
  });

  it('pins the ends: the cover arrives at exactly 1, the reveal runs from exactly 1 to exactly 0', () => {
    const short = parseVeilCurve({ fps: 30, cover: [0, 0.45, 0.9], reveal: [0.95, 0.5, 0.1] })!;
    expect(short.cover[0]).toBe(0);
    expect(short.cover[2]).toBeCloseTo(1, 10);                          // no jump to 1 when covered
    expect(short.cover[1]).toBeCloseTo(0.5, 10);
    expect(short.reveal[0]).toBeCloseTo(1, 10);
    expect(short.reveal[2]).toBeCloseTo(0, 10);                         // no vanishing at the end
    const late = parseVeilCurve({ fps: 30, cover: [0.2, 0.5, 0.8] })!;
    expect(late.cover[0]).toBeCloseTo(0.2, 10);                         // the start as authored (for the matte)
    expect(late.cover[2]).toBeCloseTo(1, 10);
    expect(late.reveal[0]).toBeCloseTo(1, 10);
    expect(late.reveal[late.reveal.length - 1]).toBeCloseTo(0, 10);
    const flatReveal = parseVeilCurve({ fps: 30, cover: [0, 1], reveal: [0.5, 0.5] })!;
    expect(flatReveal.reveal).toEqual([1, 0]);                          // the cover, backwards
  });

  it('rejects anything malformed (the default bloom stands in)', () => {
    expect(parseVeilCurve(null)).toBeNull();
    expect(parseVeilCurve({ fps: 30, cover: [0.5, 0.5] })).toBeNull();   // flat: it would never cover
    expect(parseVeilCurve({ fps: 30, cover: [0.5] })).toBeNull();
    expect(parseVeilCurve({ fps: 0, cover: [0, 1] })).toBeNull();
    expect(parseVeilCurve({ fps: 30, cover: [0, 'x'] })).toBeNull();
  });

  it('samples smoothly between frames', () => {
    expect(sampleCurve([0, 1], 0.25)).toBeCloseTo(0.25);
    expect(sampleCurve([0, 0.5, 1], 1)).toBe(1);
    expect(sampleCurve([0, 0.5, 1], -1)).toBe(0);
  });
});
