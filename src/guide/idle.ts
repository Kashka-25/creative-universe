// What Coco does while he meditates on the home page, decided by a pure, seeded scheduler (no
// timers, no three.js: the stage asks it at the right moments, and tests drive it with numbers).
//
//   drifts     a rare, tiny posture drift (drift_a / drift_b / drift_c), started only on a
//              'breathe' loop boundary, never two at once, never the same twice in a row, every
//              2 to 4 breaths
//   flutter    a small face flutter every 6 to 14 seconds
//   reactions  a small response to the visitor (react_left / react_right / react_smile), chosen by
//              where the stimulus is relative to him; never while one plays, with a cooldown at
//              least as long as the clip
//
// Sides: react_left / react_right are HIS left and right, the Blender convention the project's
// bones use (_L / _R). He faces the visitor, so something on the screen's right is on his left.

import type { Stimulus } from './attention';

export type ReactionClip = 'react_left' | 'react_right' | 'react_smile';
export const DRIFTS = ['drift_a', 'drift_b', 'drift_c'] as const;
export const REACTIONS: ReactionClip[] = ['react_left', 'react_right', 'react_smile'];

/** A tiny seeded random source (xorshift), so behaviour is reproducible in tests. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export interface IdleOptions {
  /** Drift clips the model actually has. */
  drifts: string[];
  /** Clips the model has, for reactions and flutter. */
  has: (clip: string) => boolean;
  /** Clip length in seconds (for cooldowns). */
  length: (clip: string) => number;
  /** Breaths between drift starts (inclusive range). */
  driftEvery?: [number, number];
  /** Seconds between flutters. */
  flutterEvery?: [number, number];
  /** Extra quiet after a reaction ends before another may start (seconds). */
  reactionGap?: number;
  /** Share of the screen width around him that counts as "in front": he smiles instead of turning. */
  inFront?: number;
}

export interface IdleScheduler {
  /**
   * Call on every 'breathe' loop boundary; returns the drift to start there, if any. Frames
   * rarely land exactly on the boundary: `offset` is how long ago it was crossed (the loop's time
   * now), and a drift started there is started that far in, so it is timed from the boundary.
   */
  onLoop(now: number, offset?: number): string | null;
  /** Call every frame; returns 'flutter' when it is time. */
  tick(now: number): 'flutter' | null;
  /** A stimulus from the page; `him` is his position on screen (0..1). Returns the reaction, if any. */
  onStimulus(now: number, s: Stimulus, him: { x: number; y: number }): ReactionClip | null;
  /** Seconds (on the caller's clock) until which a reaction is playing. */
  readonly reactingUntil: number;
  readonly driftingUntil: number;
}

const between = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r();
/** Frame timing slack: a drift that ends within this of a boundary has ended there. */
const SLACK = 1 / 20;
const intBetween = (r: () => number, [a, b]: [number, number]) => a + Math.min(b - a, Math.floor(r() * (b - a + 1)));

/** Which way he responds to something at screen x (0..1), given where he is. */
export function reactionFor(s: Stimulus, him: { x: number }, inFront = 0.08): ReactionClip | null {
  if (s.kind === 'tap') return 'react_smile';
  const dx = s.x - him.x;
  if (Math.abs(dx) < inFront) return 'react_smile';
  return dx < 0 ? 'react_right' : 'react_left';    // screen-left is his right
}

export function createIdleScheduler(seed: number, start: number, opts: IdleOptions): IdleScheduler {
  const r = rng(seed);
  const driftEvery = opts.driftEvery ?? [2, 4];
  const flutterEvery = opts.flutterEvery ?? [6, 14];
  const gap = opts.reactionGap ?? 2.5;
  let loopsLeft = intBetween(r, driftEvery);
  let lastDrift: string | null = null;
  let driftingUntil = -Infinity;
  let reactingUntil = -Infinity;
  let reactionReadyAt = -Infinity;
  let nextFlutter = start + between(r, flutterEvery);

  return {
    get reactingUntil() { return reactingUntil; },
    get driftingUntil() { return driftingUntil; },
    onLoop(now, offset = 0) {
      if (opts.drifts.length === 0) return null;
      const boundary = now - Math.max(0, offset);
      if (boundary < driftingUntil - SLACK) return null;  // never two at once
      loopsLeft -= 1;
      if (loopsLeft > 0) return null;
      if (now < reactingUntil) { loopsLeft = 1; return null; }   // let the reaction finish; try the next breath
      const choices = opts.drifts.length > 1 ? opts.drifts.filter((d) => d !== lastDrift) : opts.drifts;
      const drift = choices[Math.floor(r() * choices.length) % choices.length];
      lastDrift = drift;
      driftingUntil = boundary + opts.length(drift);
      loopsLeft = intBetween(r, driftEvery);
      return drift;
    },
    tick(now) {
      if (now < nextFlutter) return null;
      if (!opts.has('flutter')) { nextFlutter = Infinity; return null; }
      if (now < reactingUntil) { nextFlutter = reactingUntil + 0.5; return null; }
      nextFlutter = now + between(r, flutterEvery);
      return 'flutter';
    },
    onStimulus(now, s, him) {
      if (now < reactionReadyAt) return null;            // one at a time, then a calm gap
      let clip = reactionFor(s, him, opts.inFront);
      if (clip && !opts.has(clip)) clip = opts.has('react_smile') ? 'react_smile' : null;
      if (!clip) return null;
      const len = Math.max(0, opts.length(clip));
      reactingUntil = now + len;
      reactionReadyAt = now + len + gap;                  // cooldown ≥ the clip's length
      return clip;
    },
  };
}
