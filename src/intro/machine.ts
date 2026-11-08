// A small, reusable finite state machine.
//
// - States declare which events move them where (`on`).
// - Global events (`config.on`) apply in every non-final state (e.g. SKIP).
// - `after` schedules an automatic transition while a state is active.
// - `guard` can veto a transition.
// The scheduler is injectable so tests run without real timers.

export interface MachineEvent { type: string }

export type Target<S extends string, E extends MachineEvent> =
  | S
  | { target: S; guard?: (event: E, from: S) => boolean };

export interface StateNode<S extends string, E extends MachineEvent> {
  on?: Partial<Record<E['type'], Target<S, E>>>;
  after?: { ms: number; target: S };
  final?: boolean;
}

export interface MachineConfig<S extends string, E extends MachineEvent> {
  initial: S;
  states: Record<S, StateNode<S, E>>;
  on?: Partial<Record<E['type'], Target<S, E>>>;
}

export type Scheduler = (fn: () => void, ms: number) => () => void;
const realScheduler: Scheduler = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export interface Transition<S extends string, E extends MachineEvent> { from: S; to: S; event: E | { type: 'after' } }

export interface Machine<S extends string, E extends MachineEvent> {
  readonly state: S;
  send(event: E): boolean;
  subscribe(fn: (state: S, t: Transition<S, E> | null) => void): () => void;
  matches(...states: S[]): boolean;
  stop(): void;
  /** States visited so far, for debugging and tests. */
  readonly history: S[];
}

export function createMachine<S extends string, E extends MachineEvent>(
  config: MachineConfig<S, E>,
  scheduler: Scheduler = realScheduler,
): Machine<S, E> {
  let state = config.initial;
  let cancelAfter: (() => void) | null = null;
  let stopped = false;
  const listeners = new Set<(s: S, t: Transition<S, E> | null) => void>();
  const history: S[] = [state];

  const resolve = (t: Target<S, E> | undefined, event: E): S | null => {
    if (!t) return null;
    if (typeof t === 'string') return t;
    if (t.guard && !t.guard(event, state)) return null;
    return t.target;
  };

  const enter = (to: S, event: E | { type: 'after' }) => {
    const from = state;
    cancelAfter?.();
    cancelAfter = null;
    state = to;
    history.push(to);
    const node = config.states[to];
    if (node.after && !node.final) {
      const { ms, target } = node.after;
      cancelAfter = scheduler(() => {
        if (!stopped && state === to) enter(target, { type: 'after' });
      }, ms);
    }
    listeners.forEach((fn) => fn(state, { from, to, event }));
  };

  // Arm the initial state's timer, if any.
  const init = config.states[state];
  if (init.after) {
    const { ms, target } = init.after;
    const from = state;
    cancelAfter = scheduler(() => { if (!stopped && state === from) enter(target, { type: 'after' }); }, ms);
  }

  return {
    get state() { return state; },
    get history() { return history.slice(); },
    send(event) {
      if (stopped) return false;
      const node = config.states[state];
      if (node.final) return false;
      const type = event.type as E['type'];
      const to = resolve(node.on?.[type], event) ?? resolve(config.on?.[type], event);
      if (to === null || to === state) return false;
      enter(to, event);
      return true;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    matches: (...states) => states.includes(state),
    stop() {
      stopped = true;
      cancelAfter?.();
      listeners.clear();
    },
  };
}
