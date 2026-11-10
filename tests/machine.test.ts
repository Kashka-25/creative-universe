import { describe, expect, it } from 'vitest';
import { createMachine, createPausableScheduler } from '../src/intro/machine';
import { fakeClock } from './helpers/fakeClock';

describe('createMachine', () => {
  type S = 'a' | 'b' | 'c';
  type E = { type: 'GO' } | { type: 'JUMP'; ok: boolean } | { type: 'RESET' };

  it('moves on declared events and ignores others', () => {
    const m = createMachine<S, E>({ initial: 'a', states: { a: { on: { GO: 'b' } }, b: {}, c: { final: true } } });
    expect(m.send({ type: 'RESET' })).toBe(false);
    expect(m.send({ type: 'GO' })).toBe(true);
    expect(m.state).toBe('b');
  });

  it('applies guards', () => {
    const m = createMachine<S, E>({
      initial: 'a',
      states: { a: { on: { JUMP: { target: 'c', guard: (e) => e.type === 'JUMP' && e.ok } } }, b: {}, c: {} },
    });
    m.send({ type: 'JUMP', ok: false });
    expect(m.state).toBe('a');
    m.send({ type: 'JUMP', ok: true });
    expect(m.state).toBe('c');
  });

  it('runs global transitions everywhere except final states', () => {
    const m = createMachine<S, E>({ initial: 'a', on: { RESET: 'c' }, states: { a: { on: { GO: 'b' } }, b: {}, c: { final: true } } });
    m.send({ type: 'GO' });
    m.send({ type: 'RESET' });
    expect(m.state).toBe('c');
    expect(m.send({ type: 'GO' })).toBe(false);
  });

  it('fires "after" timers only while their state is active', () => {
    const clock = fakeClock();
    const m = createMachine<S, E>({ initial: 'a', states: { a: { on: { GO: 'b' }, after: { ms: 100, target: 'c' } }, b: {}, c: {} } }, clock.schedule);
    m.send({ type: 'GO' });
    clock.advance(200);
    expect(m.state).toBe('b');
  });

  it('notifies subscribers with the transition', () => {
    const m = createMachine<S, E>({ initial: 'a', states: { a: { on: { GO: 'b' } }, b: {}, c: {} } });
    const seen: string[] = [];
    m.subscribe((s, t) => seen.push(`${t?.from}->${s}`));
    m.send({ type: 'GO' });
    expect(seen).toEqual(['a->b']);
  });

  it('tries several guarded targets for one event in order (the first that passes wins)', () => {
    let busy = false;
    const m = () => createMachine<S, E>({
      initial: 'a',
      states: {
        a: { on: { GO: [{ target: 'c', guard: () => busy }, { target: 'b' }] } },
        b: {},
        c: {},
      },
    });
    const free = m();
    free.send({ type: 'GO' });
    expect(free.state).toBe('b');
    busy = true;
    const held = m();
    held.send({ type: 'GO' });
    expect(held.state).toBe('c');
    const none = createMachine<S, E>({ initial: 'a', states: { a: { on: { GO: [{ target: 'b', guard: () => false }] } }, b: {}, c: {} } });
    expect(none.send({ type: 'GO' })).toBe(false);
  });

  it('decides an after-target when the timer fires, not when the state is entered', () => {
    const clock = fakeClock();
    let where: S = 'b';
    const m = createMachine<S, E>({ initial: 'a', states: { a: { after: { ms: 100, target: () => where } }, b: {}, c: {} } }, clock.schedule);
    where = 'c';
    clock.advance(100);
    expect(m.state).toBe('c');
  });
});

describe('timers', () => {
  type S = 'a' | 'b';
  type E = { type: 'GO' };

  it('reads a lazy "after" each time the state is entered (timings known only at runtime)', () => {
    const clock = fakeClock();
    let ms = 0;
    const m = createMachine<S, E>({ initial: 'a', states: { a: { on: { GO: 'b' } }, b: { after: { ms: () => ms, target: 'a' } } } }, clock.schedule);
    ms = 500;
    m.send({ type: 'GO' });
    clock.advance(499);
    expect(m.state).toBe('b');
    clock.advance(1);
    expect(m.state).toBe('a');
  });

  it('pauses timers with a hidden tab and resumes them where they were', () => {
    const clock = fakeClock();
    const pausable = createPausableScheduler(clock.schedule, clock.now);
    let fired = 0;
    pausable.schedule(() => fired++, 1000);
    clock.advance(400);
    pausable.pause();
    clock.advance(10_000);              // hidden for ten seconds: nothing happens
    expect(fired).toBe(0);
    pausable.resume();
    clock.advance(599);
    expect(fired).toBe(0);              // 600 ms were left
    clock.advance(1);
    expect(fired).toBe(1);
  });

  it('cancels a paused timer for good', () => {
    const clock = fakeClock();
    const pausable = createPausableScheduler(clock.schedule, clock.now);
    let fired = 0;
    const cancel = pausable.schedule(() => fired++, 100);
    pausable.pause();
    cancel();
    pausable.resume();
    clock.advance(1000);
    expect(fired).toBe(0);
  });
});
