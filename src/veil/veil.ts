// The cloud veil's controller: a tiny state machine with a clock, no DOM and no WebGL, so it can be
// mounted above the router (it survives the change of page) and tested in node.
//
//   idle ─cover()─▶ covering ─(cover curve ends)─▶ covered ─(home ready, or 2.5 s)─▶ revealing ─▶ idle
//
// Home may ask the cloud to stay a little longer while its guide is visibly warming up underneath
// (extendHold, at most MAX_EXTRA_HOLD_MS more), so the cloud clears on him rather than on an empty
// hero, and his warm-up never lands in the middle of the clearing. Every phase ends on a timer, so
// the veil can never stay up. Authored lengths are played as
// authored, never faster: a length no sane cloud would need (a broken file) is not used at all, and
// the default stands in. Under reduced motion there is no veil at all: cover() resolves at once and
// the page simply changes. The site's veil runs on a clock that stops while the tab is hidden, so it
// picks up where it was.
//
// Getting ready: the invitation asks the view to prepare (its WebGL context, shader and matte) while
// nothing is moving yet, and waits a short while for it; once the take starts, that window closes
// and nothing heavy is done until the next trip. If no trip follows, release() frees it all. A
// request that arrives while a trip is still clearing (Replay the welcome, at once) is kept and
// carried out the moment the cloud has cleared.

import { createPausableScheduler, realScheduler, type Scheduler } from '../intro/machine';
import { prefersReducedMotion } from '../intro/capability';
import { DEFAULT_COVER_SECONDS, DEFAULT_REVEAL_SECONDS, curveSeconds, easeInOut, sampleCurve, type VeilCurve } from './curve';

export type VeilPhase = 'idle' | 'covering' | 'covered' | 'revealing';

/** Longest the cloud waits, fully covering, for the home page's guide to be ready. */
export const HOLD_CAP_MS = 2500;
/** The most extendHold() can add to that (home's guide is warming up underneath: a slow phone). */
export const MAX_EXTRA_HOLD_MS = 3500;
/** A reveal that starts part-way (Escape during the cover) is shortened in proportion, never below this. */
const MIN_REVEAL_SHARE = 0.3;
/**
 * The longest cover and reveal an authored file may ask for. Longer is treated as a broken file:
 * that number is not used (the default is), and nothing is ever played faster than authored.
 */
export const MAX_COVER_SECONDS = 3;
export const MAX_REVEAL_SECONDS = 3;

/** An authored length if it is a usable one, (0, max]; otherwise null, with a note in the console. */
export function authoredSeconds(seconds: number | null | undefined, max: number, what: string): number | null {
  if (seconds === null || seconds === undefined || !(seconds > 0)) return null;
  if (seconds <= max) return seconds;
  console.warn(`[veil] the ${what} asks for ${seconds.toFixed(2)} s (more than ${max} s); the default is used instead`);
  return null;
}

export interface CoverOptions {
  /** Where the cloud starts from, 0..1 of the screen from the top left (the fallback bloom's centre). */
  origin?: { x: number; y: number };
  /** Authored lengths from the timeline, used when the curve file is not in use. */
  coverSeconds?: number | null;
  revealSeconds?: number | null;
  /** What a screen reader hears as the cloud covers the page (announced above the page, which goes inert). */
  announce?: string;
}

export interface VeilSnapshot {
  phase: VeilPhase;
  /** Clock time the phase began (ms). */
  since: number;
  /** Length of the phase (ms); covered waits up to HOLD_CAP_MS. */
  length: number;
  /** Coverage when the phase began (a reveal may start part-way). */
  from: number;
  /**
   * Coverage per ms when a reveal began part-way through a cover: the turnaround carries the
   * cover's own speed and eases into the clearing, so it never stops dead. 0 otherwise.
   */
  velocity?: number;
  origin: { x: number; y: number };
  /** The authored curve for this trip: only together with the matte it was authored for. */
  curve: VeilCurve | null;
  /** This trip's announcement, if any. */
  announce?: string;
}

/**
 * An authored cover curve that does not start from nothing (its first sample is above 0) would put
 * the cloud on screen at that coverage in one frame. It fades in over this long instead.
 */
export const COVER_FADE_IN_MS = 140;

/** The veil's overall opacity at clock time `t`: 1, except at the start of a cover that would otherwise step in. Pure. */
export function veilAlphaAt(s: VeilSnapshot, t: number): number {
  if (s.phase !== 'covering' || !s.curve || s.from > 0.001 || !(s.curve.cover[0] > 0.01)) return 1;
  const u = Math.min(1, Math.max(0, (t - s.since) / COVER_FADE_IN_MS));
  return u * u * (3 - 2 * u);
}

/** How much of the screen the cloud covers at clock time `t` (0..1). Pure. */
export function coverageAt(s: VeilSnapshot, t: number): number {
  const u = s.length > 0 ? Math.min(1, Math.max(0, (t - s.since) / s.length)) : 1;
  switch (s.phase) {
    case 'idle': return 0;
    case 'covered': return 1;
    case 'covering': {
      const c = s.curve ? sampleCurve(s.curve.cover, u) : easeInOut(u);
      return s.from + (1 - s.from) * c;
    }
    case 'revealing': {
      const c = s.curve ? sampleCurve(s.curve.reveal, u) : 1 - easeInOut(u);
      // cubic Hermite term: starts at the cover's speed, ends at rest, adds nothing at either end
      const carry = (s.velocity ?? 0) * s.length * (u * u * u - 2 * u * u + u);
      return Math.min(1, Math.max(0, s.from * c + carry));
    }
  }
}

export interface Veil {
  readonly phase: VeilPhase;
  snapshot(): VeilSnapshot;
  coverage(t?: number): number;
  /** The overall opacity (see veilAlphaAt). */
  alpha(t?: number): number;
  /** The veil's own clock (ms): it stops while the tab is hidden, like the trip itself. */
  now(): number;
  /**
   * Fill the screen. Resolves true once it is fully covered (at once under reduced motion), or
   * false if it was cleared before it covered (Escape): the page then goes home as for Escape.
   */
  cover(opts?: CoverOptions): Promise<boolean>;
  /** The page underneath is ready: clear the veil as soon as it has fully covered. */
  ready(): void;
  /**
   * The page underneath is visibly getting ready (home's guide is warming up): while this trip is
   * covering or covered, the cloud may wait up to `extraMs` (at most MAX_EXTRA_HOLD_MS) beyond
   * HOLD_CAP_MS for ready(). No effect once it has started to clear, or with no trip.
   */
  extendHold(extraMs?: number): void;
  /** Clear it now, from wherever it is (Escape). */
  reveal(): void;
  /** The authored curve, once loaded (a curve longer than any sane cloud is not used). */
  setCurve(curve: VeilCurve | null): void;
  /** The view has the Blender matte on the GPU: the authored curve (made for it) may shape the cloud. */
  setMatte(inUse: boolean): void;
  /** How long a cover will take: the curve file (with its matte), else the authored fallback, else the default. */
  plannedCoverSeconds(fallback?: number | null): number;
  /**
   * Ask the view to get its shader and matte ready ahead of time (heavy work is allowed now). Asked
   * while a trip is still under way, it is carried out as soon as that trip has cleared.
   */
  prepare(): void;
  /** True between prepare() and the view being ready (or the wait for it ending). */
  readonly preparing: boolean;
  /** The view is ready: shader compiled, matte uploaded (or known to be missing). */
  prepared(): void;
  /** Resolves when the view is ready, or after `capMs`; either way the window for heavy work closes. */
  whenPrepared(capMs: number): Promise<void>;
  /** No trip is coming (the visitor left another way): the view frees its context. Only while idle. */
  release(): void;
  subscribe(fn: (phase: VeilPhase, prev: VeilPhase) => void): () => void;
  onPrepare(fn: () => void): () => void;
  onRelease(fn: () => void): () => void;
  /** Blocks pointer input only while the cloud is closing in or covering. */
  readonly blocking: boolean;
}

export function createVeil(deps: { schedule?: Scheduler; now?: () => number; reducedMotion?: () => boolean } = {}): Veil {
  const schedule = deps.schedule ?? realScheduler;
  const now = deps.now ?? (() => performance.now());
  const reduced = deps.reducedMotion ?? prefersReducedMotion;
  const listeners = new Set<(p: VeilPhase, prev: VeilPhase) => void>();
  const preparers = new Set<() => void>();
  const releasers = new Set<() => void>();
  const prepWaiters = new Set<() => void>();
  let snap: VeilSnapshot = { phase: 'idle', since: 0, length: 0, from: 0, origin: { x: 0.5, y: 0.5 }, curve: null };
  let curve: VeilCurve | null = null;
  let matte = false;
  let prep: 'none' | 'preparing' | 'settled' = 'none';
  /** prepare() was asked for while a trip was under way: it runs when the trip has cleared. */
  let prepareAfterTrip = false;
  let cancelTimer: (() => void) | null = null;
  let waiting: { promise: Promise<boolean>; resolve: (covered: boolean) => void } | null = null;
  let homeReady = false;
  let revealSeconds = DEFAULT_REVEAL_SECONDS;
  /** How long 'covered' may wait for ready() on this trip. */
  let holdMs = HOLD_CAP_MS;

  const go = (phase: VeilPhase, length: number, from: number, after: (() => void) | null, velocity = 0) => {
    const prev = snap.phase;
    cancelTimer?.();
    cancelTimer = null;
    snap = { ...snap, phase, since: now(), length, from, velocity };
    if (after) cancelTimer = schedule(after, length);
    listeners.forEach((l) => l(phase, prev));
  };

  const settle = (covered: boolean) => { waiting?.resolve(covered); waiting = null; };

  const settlePrep = () => {
    if (prep === 'preparing') prep = 'settled';
    const w = [...prepWaiters];
    prepWaiters.clear();
    w.forEach((f) => f());
  };

  // after a trip the view frees everything; the next trip prepares afresh (at once, if it already asked)
  const toIdle = () => {
    const again = prepareAfterTrip;
    prepareAfterTrip = false;
    prep = again ? 'preparing' : 'none';
    matte = false;
    snap = { ...snap, curve: null, announce: undefined };
    go('idle', 0, 0, null);
    if (again) preparers.forEach((p) => p());
  };

  /** The authored curve shapes the cloud only together with the matte it was made for. */
  const tripCurve = () => (matte ? curve : null);

  const planned = (fallback?: number | null) => {
    const c = tripCurve();
    return c ? curveSeconds(c.cover, c.fps) : authoredSeconds(fallback, MAX_COVER_SECONDS, 'cover') ?? DEFAULT_COVER_SECONDS;
  };

  const reveal = () => {
    if (snap.phase === 'idle' || snap.phase === 'revealing') return;
    const t = now();
    const from = coverageAt(snap, t);
    // turning round mid-cover: carry its speed into the clearing (see coverageAt)
    const velocity = snap.phase === 'covering' && snap.length > 0
      ? Math.max(0, (from - coverageAt(snap, t - 16)) / 16)
      : 0;
    settle(snap.phase === 'covered');
    const c = snap.curve;
    const full = (c ? curveSeconds(c.reveal, c.fps) : revealSeconds) * 1000;
    go('revealing', full * Math.max(MIN_REVEAL_SHARE, from), from, toIdle, velocity);
  };

  const covered = () => {
    go('covered', holdMs, 1, reveal);
    settle(true);
    if (homeReady) reveal();
  };

  return {
    get phase() { return snap.phase; },
    get blocking() { return snap.phase === 'covering' || snap.phase === 'covered'; },
    get preparing() { return prep === 'preparing'; },
    snapshot: () => snap,
    coverage: (t = now()) => coverageAt(snap, t),
    alpha: (t = now()) => veilAlphaAt(snap, t),
    now,
    cover(opts = {}) {
      if (reduced()) return Promise.resolve(true);
      if (waiting) return waiting.promise;
      if (snap.phase === 'covered') return Promise.resolve(true);
      homeReady = false;
      holdMs = HOLD_CAP_MS;
      revealSeconds = authoredSeconds(opts.revealSeconds, MAX_REVEAL_SECONDS, 'reveal') ?? DEFAULT_REVEAL_SECONDS;
      const coverMs = planned(opts.coverSeconds) * 1000;
      // the trip's shape is fixed now: the curve (with its matte) or the eased default
      snap = { ...snap, origin: opts.origin ?? snap.origin, curve: tripCurve(), announce: opts.announce };
      const from = coverageAt(snap, now());
      let resolve!: (covered: boolean) => void;
      const promise = new Promise<boolean>((r) => { resolve = r; });
      waiting = { promise, resolve };
      go('covering', coverMs * (1 - from), from, covered);
      return promise;
    },
    ready() {
      homeReady = true;
      if (snap.phase === 'covered') reveal();
    },
    extendHold(extraMs = MAX_EXTRA_HOLD_MS) {
      if (homeReady || (snap.phase !== 'covering' && snap.phase !== 'covered')) return;
      const longer = HOLD_CAP_MS + Math.min(MAX_EXTRA_HOLD_MS, Math.max(0, extraMs));
      if (longer <= holdMs) return;
      holdMs = longer;
      if (snap.phase === 'covered') {
        // the same covered phase, its timer moved on (counted from when it covered)
        cancelTimer?.();
        snap = { ...snap, length: holdMs };
        cancelTimer = schedule(reveal, Math.max(0, snap.since + holdMs - now()));
      }
    },
    reveal,
    setCurve(c) {
      const ok = !c || (
        authoredSeconds(curveSeconds(c.cover, c.fps), MAX_COVER_SECONDS, 'cover curve') !== null
        && authoredSeconds(curveSeconds(c.reveal, c.fps), MAX_REVEAL_SECONDS, 'reveal curve') !== null
      );
      curve = ok ? c : null;
    },
    setMatte(inUse) { matte = inUse; },
    plannedCoverSeconds: planned,
    prepare() {
      if (snap.phase !== 'idle') { prepareAfterTrip = true; return; }
      if (prep === 'none') prep = 'preparing';
      preparers.forEach((p) => p());
    },
    prepared() {
      prepareAfterTrip = false;           // the window has closed: nothing heavy after this trip either
      settlePrep();
    },
    whenPrepared(capMs) {
      if (prep !== 'preparing' && !prepareAfterTrip) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let cancel: (() => void) | null = null;
        const done = () => { cancel?.(); cancel = null; prepWaiters.delete(done); resolve(); };
        prepWaiters.add(done);
        cancel = schedule(() => { cancel = null; settlePrep(); }, capMs);
      });
    },
    release() {
      prepareAfterTrip = false;               // no trip is coming: nothing to get ready for
      if (snap.phase !== 'idle') return;      // a trip is under way: it frees everything when it ends
      settlePrep();
      prep = 'none';
      matte = false;
      releasers.forEach((r) => r());
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    onPrepare(fn) { preparers.add(fn); return () => { preparers.delete(fn); }; },
    onRelease(fn) { releasers.add(fn); return () => { releasers.delete(fn); }; },
  };
}

/** What a tab clock reads: whether the tab is hidden, and when that changes (a real `document` fits). */
export interface TabClockDeps {
  isHidden: () => boolean;
  onVisibility: (fn: () => void) => void;
  now?: () => number;
  /** The scheduler under it (a fake one in tests). */
  base?: Scheduler;
}

/**
 * A clock and scheduler that stop while the tab is hidden and carry on where they were, so a
 * cloud that was half-way across the screen is still half-way when the visitor comes back.
 */
export function tabClock(d: TabClockDeps): { schedule: Scheduler; now: () => number } {
  const now = d.now ?? (() => performance.now());
  const sched = createPausableScheduler(d.base, now);
  let hiddenAt = 0;
  let hiddenTotal = 0;
  const sync = () => {
    if (d.isHidden()) { if (!sched.paused) { hiddenAt = now(); sched.pause(); } }
    else if (sched.paused) { hiddenTotal += now() - hiddenAt; sched.resume(); }
  };
  sync();
  d.onVisibility(sync);
  return { schedule: sched.schedule, now: () => (sched.paused ? hiddenAt : now()) - hiddenTotal };
}

/** The one veil the site uses (mounted by CloudVeil above the router). */
export const veil = createVeil(typeof document !== 'undefined'
  ? tabClock({ isHidden: () => document.hidden, onVisibility: (fn) => document.addEventListener('visibilitychange', fn) })
  : {});
