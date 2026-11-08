// The story of the introduction, as a state machine.
//
//   boot ─FULL─▶ loading ─READY─▶ seated ─(2.4s | visitor moves)─▶ awakening
//     │             └─LOAD_FAILED/timeout─▶ lite                       │ wake clip done
//     └─LITE─▶ lite ─FOLLOW─▶ liteFlight ─▶ revealing          acknowledging
//                                              ▲                        │ acknowledge clip done
//                                              │                  beckoning  (waits for FOLLOW)
//                                              │                        │ FOLLOW or 9s
//   The metamorphosis (timed beats, 8.6 s):    │                        ▼
//     gathering ─▶ chrysalis ─▶ opening ─▶ emerging ───────────────────┘  (his true form: the painting)
//   revealing ─LANDED (the painting settles into the portfolio hero)─▶ done
//   boot ─PERCH (intro already seen / deep link)─▶ done
//   SKIP from any state ─▶ revealing
//
// Each clip-driven state also has a timeout, so a missing or broken clip can
// never trap a visitor in the intro.

import { createMachine, type MachineConfig, type Scheduler } from './machine';
import type { ClipName } from '../scene/guide/contract';

export type IntroState =
  | 'boot' | 'loading' | 'seated' | 'awakening' | 'acknowledging' | 'beckoning'
  | 'gathering' | 'chrysalis' | 'opening' | 'emerging' | 'lite' | 'liteFlight' | 'revealing' | 'done';

export type IntroEvent =
  | { type: 'FULL' }
  | { type: 'LITE' }
  | { type: 'READY' }
  | { type: 'LOAD_FAILED'; reason?: string }
  | { type: 'INTERACT' }
  | { type: 'CLIP_DONE'; clip: ClipName }
  | { type: 'FOLLOW' }
  | { type: 'LANDED' }
  | { type: 'PERCH' }
  | { type: 'SKIP' };

const clipDone = (clip: ClipName, target: IntroState) => ({
  target,
  guard: (e: IntroEvent) => e.type === 'CLIP_DONE' && e.clip === clip,
});

/** How long each beat of the metamorphosis lasts (ms). */
export const METAMORPHOSIS = { gathering: 2000, chrysalis: 2600, opening: 1600, emerging: 2400 } as const;

export const introConfig: MachineConfig<IntroState, IntroEvent> = {
  initial: 'boot',
  on: { SKIP: 'revealing' },
  states: {
    boot: { on: { FULL: 'loading', LITE: 'lite', PERCH: 'done' } },
    loading: { on: { READY: 'seated', LOAD_FAILED: 'lite' }, after: { ms: 15000, target: 'lite' } },
    seated: { on: { INTERACT: 'awakening' }, after: { ms: 2400, target: 'awakening' } },
    awakening: { on: { CLIP_DONE: clipDone('wake', 'acknowledging') }, after: { ms: 7000, target: 'acknowledging' } },
    acknowledging: { on: { CLIP_DONE: clipDone('acknowledge', 'beckoning') }, after: { ms: 6000, target: 'beckoning' } },
    beckoning: { on: { FOLLOW: 'gathering' }, after: { ms: 9000, target: 'gathering' } },
    gathering: { after: { ms: METAMORPHOSIS.gathering, target: 'chrysalis' } },
    chrysalis: { after: { ms: METAMORPHOSIS.chrysalis, target: 'opening' } },
    opening: { after: { ms: METAMORPHOSIS.opening, target: 'emerging' } },
    emerging: { after: { ms: METAMORPHOSIS.emerging, target: 'revealing' } },
    lite: { on: { FOLLOW: 'liteFlight' }, after: { ms: 9000, target: 'liteFlight' } },
    liteFlight: { after: { ms: 1400, target: 'revealing' } },
    revealing: { on: { LANDED: 'done' }, after: { ms: 3600, target: 'done' } },
    done: { final: true },
  },
};

export const createIntroMachine = (scheduler?: Scheduler) => createMachine(introConfig, scheduler);

/** What each state asks of the scene: which clip plays and which camera shot frames it. */
export interface Beat {
  clip?: ClipName;
  shot: ShotName;
  /** Head/eyes follow the visitor's pointer this much (0..1). */
  look: number;
  /** Third-eye glow 0..1. */
  glow: number;
  /** Read out to screen readers when the beat starts. */
  narration?: string;
}

export type ShotName = 'establish' | 'approach' | 'portrait' | 'cocoon' | 'perch';

export const beats: Partial<Record<IntroState, Beat>> = {
  loading:       { shot: 'establish', look: 0, glow: 0 },
  seated:        { clip: 'seated_idle', shot: 'establish', look: 0, glow: 0.1, narration: 'A small figure sits on a turquoise cloud, eyes closed, breathing slowly.' },
  awakening:     { clip: 'wake', shot: 'approach', look: 0.3, glow: 0.7, narration: 'He opens his eyes. The third eye on his forehead begins to glow.' },
  acknowledging: { clip: 'acknowledge', shot: 'portrait', look: 0.9, glow: 1, narration: 'He looks straight at you and smiles.' },
  beckoning:     { clip: 'beckon', shot: 'portrait', look: 1, glow: 1, narration: 'He raises a hand and beckons: follow me.' },
  gathering:     { clip: 'seated_idle', shot: 'cocoon', look: 0, glow: 1, narration: 'He closes his eyes. Light gathers around him in little turquoise and golden curls.' },
  chrysalis:     { clip: 'seated_idle', shot: 'cocoon', look: 0, glow: 1, narration: 'The light wraps around him like a cocoon, glowing softly, like a heartbeat.' },
  opening:       { shot: 'cocoon', look: 0, glow: 1, narration: 'The cocoon unfurls like clouds opening.' },
  emerging:      { shot: 'cocoon', look: 0, glow: 1, narration: 'He emerges in his true form, the painted guide, with his sun, his lightning and his clouds.' },
  revealing:     { shot: 'perch', look: 0, glow: 0.8, narration: 'He settles into his home at the heart of the Creative Universe.' },
  done:          { shot: 'perch', look: 1, glow: 0.8 },
};

/** States in which the intro covers the page. */
export const INTRO_STATES: IntroState[] = ['boot', 'loading', 'seated', 'awakening', 'acknowledging', 'beckoning', 'gathering', 'chrysalis', 'opening', 'emerging', 'lite', 'liteFlight'];

/** The metamorphosis beats, in order. */
export const METAMORPHOSIS_STATES: IntroState[] = ['gathering', 'chrysalis', 'opening', 'emerging'];
