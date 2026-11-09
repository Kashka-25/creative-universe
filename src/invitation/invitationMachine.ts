// The invitation, as a state machine on the generic createMachine:
//
//   boot ─START─▶ loading ─LOADED─▶ warming ─WARM─▶ take ─(glow)─▶ transforming ─(luminous)─▶ carrying ─COVERED─▶ done
//     │             └─LOAD_FAILED / 8 s─▶ illustrated ─COME_IN─▶ done
//     └─LITE─▶ illustrated
//
//   take ─COME_IN─▶ transforming     (the page jumps the clock to the glow marker: the trip home starts at once)
//   ESCAPE from anywhere ─▶ done     (home at once, no veil)
//
//   transforming ─(luminous, the visitor is using the header)─▶ waiting ─FREE / COME_IN / GIVE_UP / cap─▶ carrying
//     The cloud never covers a menu someone is using: while the mobile menu is open, keyboard focus
//     is in the header, or a mouse is busy in it, the trip waits (the take holds gently meanwhile)
//     until they are done. A header left untouched for WAIT_IDLE_MS (a menu left open) lets it go
//     on (GIVE_UP, from the page); WAIT_LIMIT_MS is the last resort. Leaving through the menu ends
//     the invitation as usual. "Come on in" is the visitor's decision: once pressed, the trip never
//     waits for the header.
//
// Beats advance from the animation clock (the stage reports MARKER events as the mixer passes
// the timeline's markers). The `after` timeouts are only a safety net: each is the authored
// length of its beat plus a margin, read from timeline.json when the beat starts. 'done' is
// final and START is only accepted in 'boot', so the invitation can never run twice.

import { createMachine, type Machine, type MachineConfig, type Scheduler } from '../intro/machine';
import type { InvitationTiming, MarkerName, Timeline } from './timeline';

export type InvitationState =
  | 'boot' | 'loading' | 'warming' | 'take' | 'transforming' | 'waiting' | 'carrying' | 'illustrated' | 'done';

export type InvitationEvent =
  | { type: 'START' }                       // 3D: load the take
  | { type: 'LITE' }                        // reduced motion, data saver, low memory, no WebGL
  | { type: 'LOADED' }                      // timeline and models parsed
  | { type: 'LOAD_FAILED' }                 // anything missing or broken, or the WebGL context lost
  | { type: 'WARM' }                        // shaders compiled, textures uploaded: the take may start
  | { type: 'MARKER'; name: MarkerName }    // the clock passed a timeline marker
  | { type: 'COME_IN' }                     // the "Come on in" button
  | { type: 'ESCAPE' }                      // the Escape key: home at once
  | { type: 'FREE' }                        // the visitor has finished with the header (menu closed, focus left)
  | { type: 'GIVE_UP' }                     // the header has been left untouched (a menu left open) for WAIT_IDLE_MS
  | { type: 'COVERED' };                    // the cloud veil fills the screen

/** How long loading may take before the illustrated invitation stands in. */
export const LOADING_MS = 8000;
/** How long compiling may take before the take starts anyway (it only risks a first-frame hitch). */
export const WARMING_MS = 6000;
/**
 * How long the trip home waits for a header that is in use but untouched (a menu left open), counted
 * from the visitor's last touch of it (time the tab is visible). The page measures it and sends
 * GIVE_UP: a header someone is actually using is never covered while they use it.
 */
export const WAIT_IDLE_MS = 15_000;
/** The last resort: the whole wait never lasts longer than this, whatever happens, so nothing can hang. */
export const WAIT_LIMIT_MS = 60_000;

const marker = (name: MarkerName) => (e: InvitationEvent) => e.type === 'MARKER' && e.name === name;
const luminous = marker('luminous');

/** Used only if a timed beat is somehow entered before the timeline is known: move on, never hang. */
const UNKNOWN_BEAT_MS = 0;

/**
 * @param timing the beats' safety timeouts, read from timeline.json when each beat starts
 * @param busy   whether the visitor is using the header right now (an open menu, keyboard focus in it)
 */
function invitationConfig(timing: () => InvitationTiming | null, busy: () => boolean): MachineConfig<InvitationState, InvitationEvent> {
  const ms = (k: keyof InvitationTiming) => () => timing()?.[k] ?? UNKNOWN_BEAT_MS;
  return {
    initial: 'boot',
    on: { ESCAPE: 'done' },
    states: {
      boot: { on: { START: 'loading', LITE: 'illustrated' } },
      loading: {
        on: { LOADED: 'warming', LOAD_FAILED: 'illustrated', COME_IN: 'done' },
        after: { ms: LOADING_MS, target: 'illustrated' },
      },
      warming: {
        on: { WARM: 'take', LOAD_FAILED: 'illustrated', COME_IN: 'done' },
        after: { ms: WARMING_MS, target: 'take' },
      },
      take: {
        on: { MARKER: { target: 'transforming', guard: marker('glow') }, COME_IN: 'transforming', LOAD_FAILED: 'illustrated' },
        after: { ms: ms('takeMs'), target: 'transforming' },
      },
      transforming: {
        on: {
          MARKER: [
            { target: 'waiting', guard: (e) => luminous(e) && busy() },
            { target: 'carrying', guard: luminous },
          ],
          LOAD_FAILED: 'illustrated',
        },
        after: { ms: ms('transformMs'), target: () => (busy() ? 'waiting' : 'carrying') },
      },
      // the cloud is luminous, but the visitor is in the header: the trip waits for them (capped)
      waiting: {
        on: { FREE: 'carrying', COME_IN: 'carrying', GIVE_UP: 'carrying', LOAD_FAILED: 'illustrated' },
        after: { ms: WAIT_LIMIT_MS, target: 'carrying' },
      },
      carrying: {
        on: { COVERED: 'done' },
        after: { ms: ms('carryMs'), target: 'done' },
      },
      illustrated: { on: { COME_IN: 'done' } },
      done: { final: true },
    },
  };
}

/**
 * The invitation's machine. It remembers "Come on in": once the visitor has asked to come in, the
 * trip home starts at luminous whatever the header is doing (an open menu included).
 */
export function createInvitationMachine(
  timing: () => InvitationTiming | null,
  scheduler?: Scheduler,
  busy: () => boolean = () => false,
): Machine<InvitationState, InvitationEvent> {
  let invited = false;
  const m = createMachine(invitationConfig(timing, () => !invited && busy()), scheduler);
  return {
    get state() { return m.state; },
    get history() { return m.history; },
    send(e) {
      if (e.type === 'COME_IN') invited = true;
      return m.send(e);
    },
    subscribe: (fn) => m.subscribe(fn),
    matches: (...states) => m.matches(...states),
    stop: () => m.stop(),
  };
}

/** States in which the 3D take is on screen. */
const LIVE: InvitationState[] = ['warming', 'take', 'transforming', 'waiting', 'carrying'];

/**
 * States in which the take's clock runs. It starts in whichever of them the page commits first:
 * a "Come on in" can land in the same moment as WARM, so 'take' itself may never be rendered.
 */
export const TAKE_RUNS: InvitationState[] = ['take', 'transforming', 'waiting', 'carrying'];

export type Visual = 'illustrated' | 'live';

/**
 * What the invitation shows. In 'done' it keeps showing what it showed before (`previous`), until
 * the route changes, so the way home crossfades from it rather than from an empty stage.
 */
export function invitationVisual(state: InvitationState, illustratedNow: boolean, previous: Visual): { visual: Visual; live3D: boolean } {
  const visual: Visual = state === 'done' ? previous : illustratedNow ? 'illustrated' : 'live';
  const live3D = visual === 'live' && (state === 'boot' || state === 'loading' || state === 'done' || LIVE.includes(state));
  return { visual, live3D };
}

/** What a screen reader hears as each beat begins: only what is happening on screen. */
export const NARRATION: Partial<Record<MarkerName, string>> = {
  floatIn: 'Coco floats gently down on his cloud, meditating, his eyes closed.',
  arrive: 'He settles in front of you and breathes slowly.',
  glow: 'The cloud begins to glow.',
  engulf: 'The cloud grows and wraps around him.',
  luminous: 'The glowing cloud fills the screen and carries you home.',
};

/** The heading fades in a moment after he has settled in front of the visitor. */
export const HEADING_MARKERS: MarkerName[] = ['welcome'];

/**
 * Beats closer together than this (authored time) are spoken as one line: a polite live region
 * cannot speak two lines a fraction of a second apart (one is dropped, or spoken late).
 */
export const NARRATION_GAP_SECONDS = 1.2;

export interface Narrator {
  /** The line to speak as the clock passes `name`, or null (nothing yet, or more is coming at once). */
  (name: MarkerName): string | null;
  /** The clock jumped ("Come on in"): lines held back for beats it has left behind are dropped. */
  skip(): void;
  /** Lines still held back, handed over (the veil speaks them with the trip home), and forgotten. */
  flush(): string;
}

/**
 * What the page's live region says as the clock passes each marker. Beats that Blender puts close
 * together (by frame) are gathered and spoken as one line when the last of them is passed, so
 * nothing is announced before it happens and nothing is dropped. A beat the clock skips ("Come on
 * in" jumps to the glow) is never passed, so it is never spoken, and lines held back for beats
 * before a jump are dropped (skip). 'luminous' is spoken by the veil (the page goes inert under
 * it), but it still counts for the spacing: a beat just before it is held back and handed to the
 * veil (flush) to speak with it, never as a second announcement a moment before.
 */
export function createNarrator(t: Timeline, lines: Partial<Record<MarkerName, string>> = NARRATION, gapSeconds = NARRATION_GAP_SECONDS): Narrator {
  const order = (Object.keys(lines) as MarkerName[])
    .filter((m) => t.markers[m] !== undefined)
    .sort((a, b) => t.markers[a]! - t.markers[b]!);
  const gap = gapSeconds * t.fps;
  let pending: string[] = [];
  const flush = () => { const line = pending.join(' '); pending = []; return line; };
  const say = (name: MarkerName): string | null => {
    if (name === 'luminous') return null;                                                // the veil speaks it
    const i = order.indexOf(name);
    if (i < 0) return null;
    pending.push(lines[name]!);
    const next = order[i + 1];
    if (next !== undefined && t.markers[next]! - t.markers[name]! < gap) return null;   // more is coming at once
    return flush();
  };
  return Object.assign(say, { skip: () => { pending = []; }, flush });
}
