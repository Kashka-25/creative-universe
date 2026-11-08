// The guide's behaviour after the intro, as a state machine. It only decides
// WHAT he is doing; where he goes is chosen by the brain from the page's spots,
// and HOW it looks is the 3D layer's job.
//
//   offstage ─ENTER─▶ settled ◀──────────────────────────────┐
//                       │ GO (a new spot: navigation or scroll)   │
//                       ▼                                         │ DONE / timeout
//                  acknowledging ─DEPART / 0.7 s─▶ travelling ─ARRIVED─▶ arriving
//   settled ─POKE─▶ reacting ─DONE─▶ settled
//   settled ─HINT─▶ hinting  ─DONE─▶ settled
//   LEAVE from anywhere ─▶ offstage
//
// Every timed state has a timeout, so a missing clip never strands him.

import { createMachine, type MachineConfig, type Scheduler } from '../intro/machine';

export type CompanionState = 'offstage' | 'settled' | 'acknowledging' | 'travelling' | 'arriving' | 'reacting' | 'hinting';

export type CompanionEvent =
  | { type: 'ENTER' }
  | { type: 'LEAVE' }
  | { type: 'GO' }
  | { type: 'DEPART' }
  | { type: 'ARRIVED' }
  | { type: 'DONE' }
  | { type: 'POKE' }
  | { type: 'HINT' };

export const companionConfig: MachineConfig<CompanionState, CompanionEvent> = {
  initial: 'offstage',
  on: { LEAVE: 'offstage' },
  states: {
    offstage: { on: { ENTER: 'settled' } },
    settled: { on: { GO: 'acknowledging', POKE: 'reacting', HINT: 'hinting' } },
    acknowledging: { on: { DEPART: 'travelling' }, after: { ms: 700, target: 'travelling' } },
    travelling: { on: { ARRIVED: 'arriving' }, after: { ms: 4500, target: 'arriving' } },
    arriving: { on: { DONE: 'settled', GO: 'acknowledging' }, after: { ms: 5000, target: 'settled' } },
    reacting: { on: { DONE: 'settled', GO: 'acknowledging' }, after: { ms: 3000, target: 'settled' } },
    hinting: { on: { DONE: 'settled', GO: 'acknowledging', POKE: 'reacting' }, after: { ms: 5000, target: 'settled' } },
  },
};

export const createCompanionMachine = (scheduler?: Scheduler) => createMachine(companionConfig, scheduler);

/** States in which he is moving between spots (the 3D layer must render). */
export const MOVING: CompanionState[] = ['acknowledging', 'travelling', 'arriving'];

export type Travel = 'fly' | 'walk' | 'snap';

/**
 * Walk when the next spot is close and roughly level on screen, fly otherwise.
 * Positions are screen pixels; `onScreen` says whether he is visible now.
 */
export function chooseTravel(from: { x: number; y: number } | null, to: { x: number; y: number }, onScreen: boolean, toMode: 'sit' | 'stand' | 'hover'): Travel {
  if (!from) return 'snap';
  const dx = to.x - from.x, dy = to.y - from.y;
  if (onScreen && toMode !== 'hover' && Math.abs(dx) < 380 && Math.abs(dy) < 140) return 'walk';
  return 'fly';
}
