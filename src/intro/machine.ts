// A small, reusable finite state machine.
//
// - States declare which events move them where (`on`).
// - Global events (`config.on`) apply in every non-final state (e.g. SKIP).
// - `after` schedules an automatic transition while a state is active (its target may be decided
//   when the timer fires).
// - `guard` can veto a transition. An event may list several guarded targets: the first that
//   passes wins.
// The scheduler is injectable so tests run without real timers.

export interface MachineEvent { type: string }

export type Target<S extends string, E extends MachineEvent> =
  | S
  | { target: S; guard?: (event: E, from: S) => boolean };

/** One target, or several guarded ones tried in order (the first whose guard passes wins). */
export type Targets<S extends string, E extends MachineEvent> = Target<S, E> | Target<S, E>[];

export interface StateNode<S extends string, E extends MachineEvent> {
  on?: Partial<Record<E['type'], Targets<S, E>>>;
  /**
   * `ms` may be a function: it is read each time the state is entered (e.g. timings loaded at
   * runtime). `target` may be a function too: it is read when the timer fires.
   */
  after?: { ms: number | (() => number); target: S | (() => S) };
  final?: boolean;
}

export interface MachineConfig<S extends string, E extends MachineEvent> {
  initial: S;
  states: Record<S, StateNode<S, E>>;
  on?: Partial<Record<E['type'], Targets<S, E>>>;
}

export type Scheduler = (fn: () => void, ms: number) => () => void;
export const realScheduler: Scheduler = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

const msOf = (ms: number | (() => number)) => Math.max(0, typeof ms === 'function' ? ms() : ms);
const targetOf = <S extends string>(t: S | (() => S)): S => (typeof t === 'function' ? t() : t);

export interface PausableScheduler {
  schedule: Scheduler;
  /** Freeze every pending timer, keeping what is left of it. */
  pause(): void;
  /** Start the frozen timers again where they stopped. */
  resume(): void;
  readonly paused: boolean;
}

/**
 * A scheduler whose timers can be paused (a hidden tab) and resumed where they were.
 * Wraps another scheduler, so tests can drive it with a fake clock.
 */
export function createPausableScheduler(base: Scheduler = realScheduler, now: () => number = () => performance.now()): PausableScheduler {
  interface Job { fn: () => void; remaining: number; startedAt: number; cancel: (() => void) | null }
  const jobs = new Set<Job>();
  let paused = false;
  const arm = (job: Job) => {
    job.startedAt = now();
    job.cancel = base(() => { jobs.delete(job); job.fn(); }, job.remaining);
  };
  return {
    get paused() { return paused; },
    schedule(fn, ms) {
      const job: Job = { fn, remaining: ms, startedAt: 0, cancel: null };
      jobs.add(job);
      if (!paused) arm(job);
      return () => { job.cancel?.(); jobs.delete(job); };
    },
    pause() {
      if (paused) return;
      paused = true;
      const t = now();
      for (const job of jobs) {
        job.cancel?.();
        job.cancel = null;
        job.remaining = Math.max(0, job.remaining - (t - job.startedAt));
      }
    },
    resume() {
      if (!paused) return;
      paused = false;
      for (const job of jobs) arm(job);
    },
  };
}

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

  const resolveOne = (t: Target<S, E>, event: E): S | null => {
    if (typeof t === 'string') return t;
    if (t.guard && !t.guard(event, state)) return null;
    return t.target;
  };
  const resolve = (t: Targets<S, E> | undefined, event: E): S | null => {
    if (!t) return null;
    if (!Array.isArray(t)) return resolveOne(t, event);
    for (const one of t) {
      const to = resolveOne(one, event);
      if (to !== null) return to;
    }
    return null;
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
        if (!stopped && state === to) enter(targetOf(target), { type: 'after' });
      }, msOf(ms));
    }
    listeners.forEach((fn) => fn(state, { from, to, event }));
  };

  // Arm the initial state's timer, if any.
  const init = config.states[state];
  if (init.after) {
    const { ms, target } = init.after;
    const from = state;
    cancelAfter = scheduler(() => { if (!stopped && state === from) enter(targetOf(target), { type: 'after' }); }, msOf(ms));
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
