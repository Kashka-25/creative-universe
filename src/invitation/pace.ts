// How the take moves while the trip home waits for the visitor, and right after. Pure (no three.js,
// no DOM): InvitationStage applies it every frame, and it is tested in node.
//
// Waiting: the visitor is using the header when the cloud turns luminous, so the trip home waits.
// The transformation itself always plays at full speed, as authored: nothing slows before luminous.
// What plays meanwhile is best authored: a looping HOLD_CLIP in a model (Blender), which the stage
// crossfades into while it waits and out of when the trip carries on; the take itself then eases
// to rest underneath, unseen. Without one, the take glides on through the little authored time it
// has before its next beat (the veil's full cover, or the cloud dissipating), never reaching it:
//   - it eases down from full speed with no step in speed (a critically damped spring), more firmly
//     when there is little room, so the slowing uses at most DECEL_SHARE of it;
//   - then it glides at most WAIT_PACE, and never faster than the room left spread over
//     WAIT_SPAN_SECONDS, so it slows on gently as the wait goes on but never comes to rest;
//   - an exact exponential guard keeps any frame, however long, from reaching the beat.
// With little room that glide is slow (a fraction of a second of authored movement spread over the
// wait): only an authored hold loop truly fills a long wait.
//
// After a wait: the trip carries on and the veil starts its full cover, so the take stays held to
// the veil, reaching its next beat just as the cloud covers the screen, never while the screen is
// still clear (the frames authored to play under the veil stay under it).

import { springStep } from '../guide/glide';
import { WAIT_IDLE_MS, type InvitationState } from './invitationMachine';

/**
 * Whether the take slows for the wait (stepPace's `waiting`): only while the trip waits, and only
 * once the clock has reached luminous. A slow device whose safety net starts the wait early plays on
 * to luminous at full speed first, so the wait (and any hold loop) always begins on the luminous cloud.
 */
export const slowsForWait = (phase: InvitationState, masterFrame: number, luminousFrame: number) =>
  phase === 'waiting' && masterFrame >= luminousFrame;

/** A looping clip Blender may add to either model: what plays while the trip waits (see the top). */
export const HOLD_CLIP = 'luminous_hold';
/** The crossfade into and out of the hold loop (seconds). */
export const HOLD_FADE_SECONDS = 0.8;
/** The fastest glide while waiting: this share of the authored speed. */
export const WAIT_PACE = 0.2;
/** How quickly the pace eases at least (rad/s; settles in about 1.5 s). */
export const PACE_OMEGA = 3;
/** After a wait, how firmly it eases towards the speed that keeps up with the veil (settles in about 0.6 s). */
export const TIE_OMEGA = 8;
/**
 * Share of the room the slowing-down may use; the rest is spread over the wait. Most of it: with the
 * fraction of a second there is before the next beat, a smaller share would brake in a third of a
 * second. This only softens the brake; the take is still all but still afterwards (see the top).
 */
export const DECEL_SHARE = 0.75;
/** The wait the glide is spread over: the inactivity cap with a margin (a longer wait slows on gently). */
export const WAIT_SPAN_SECONDS = (WAIT_IDLE_MS / 1000) * 1.2;

export interface PaceState {
  pace: number;
  velocity: number;
  /** While waiting: how firmly the pace eases down (fixed when the wait begins). */
  waitOmega: number | null;
}

export const freshPace = (): PaceState => ({ pace: 1, velocity: 0, waitOmega: null });

export interface PaceInput {
  /** The trip home is waiting for the visitor. */
  waiting: boolean;
  /** Authored seconds left before the beat the take must not reach early (Infinity: no limit). */
  roomSeconds: number;
  /** Every visible model plays its authored hold loop: the take underneath may come to rest. */
  holding?: boolean;
  /** After a wait, while the veil is still covering: seconds until it covers. Null otherwise. */
  coverLeft?: number | null;
}

/** The glide while waiting, for the room left: at most WAIT_PACE, else the room spread over the wait. */
export const waitGlide = (roomSeconds: number, holding = false) =>
  holding ? 0 : Math.min(WAIT_PACE, Math.max(0, roomSeconds) / WAIT_SPAN_SECONDS);

/**
 * How firmly to ease down from `pace` as the wait begins: a critically damped spring from `pace` to
 * `glide` travels (pace - glide) · 2 / omega, which may use at most DECEL_SHARE of the room.
 */
export function waitOmega(roomSeconds: number, pace: number, holding = false): number {
  if (!(roomSeconds > 0) || !Number.isFinite(roomSeconds)) return PACE_OMEGA;
  const glide = waitGlide(roomSeconds * (1 - DECEL_SHARE), holding);
  return Math.max(PACE_OMEGA, (2 * Math.max(0, pace - glide)) / (roomSeconds * DECEL_SHARE));
}

/** Authored time to advance for `want` seconds' worth, never reaching the end of `room` (exact for any frame). */
export const guardStep = (want: number, room: number) => (room > 0 ? room * (1 - Math.exp(-want / room)) : 0);

/** One frame of the take's pace. Returns the authored time (seconds) to advance the take by. */
export function stepPace(s: PaceState, i: PaceInput, dt: number): number {
  if (!(dt > 0)) return 0;
  const room = Math.max(0, i.roomSeconds);
  const limited = Number.isFinite(room);
  let target = 1;
  let omega = PACE_OMEGA;
  let guarded = false;
  if (i.waiting) {
    if (s.waitOmega === null) s.waitOmega = waitOmega(room, s.pace, i.holding);
    omega = s.waitOmega;
    target = limited ? waitGlide(room, i.holding) : i.holding ? 0 : WAIT_PACE;
    guarded = limited;
  } else {
    s.waitOmega = null;
    if (i.coverLeft !== null && i.coverLeft !== undefined && limited) {
      // held to the veil: the speed that uses the room up just as it covers
      target = Math.min(1, room / Math.max(i.coverLeft, dt));
      omega = TIE_OMEGA;
      guarded = true;
    }
  }
  [s.pace, s.velocity] = springStep(s.pace, s.velocity, target, omega, dt);
  s.pace = Math.min(1, Math.max(0, s.pace));
  const want = dt * s.pace;
  return guarded ? guardStep(want, room) : want;
}
