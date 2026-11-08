import { describe, expect, it } from 'vitest';
import { createMachine, type Scheduler } from '../src/intro/machine';
import { createIntroMachine } from '../src/intro/introMachine';

/** A scheduler we drive by hand: no real timers in tests. */
function fakeClock() {
  let now = 0;
  const jobs: { at: number; fn: () => void; dead: boolean }[] = [];
  const schedule: Scheduler = (fn, ms) => {
    const job = { at: now + ms, fn, dead: false };
    jobs.push(job);
    return () => { job.dead = true; };
  };
  const advance = (ms: number) => {
    now += ms;
    for (const j of [...jobs].sort((a, b) => a.at - b.at)) {
      if (!j.dead && j.at <= now) { j.dead = true; j.fn(); }
    }
  };
  return { schedule, advance };
}

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
});

describe('intro story', () => {
  it('plays the whole welcome: wake, acknowledge, beckon, follow, rise, fly, land', () => {
    const clock = fakeClock();
    const m = createIntroMachine(clock.schedule);
    m.send({ type: 'FULL' });
    m.send({ type: 'READY' });
    expect(m.state).toBe('seated');
    clock.advance(2400);
    expect(m.state).toBe('awakening');
    m.send({ type: 'CLIP_DONE', clip: 'acknowledge' }); // wrong clip: ignored
    expect(m.state).toBe('awakening');
    m.send({ type: 'CLIP_DONE', clip: 'wake' });
    m.send({ type: 'CLIP_DONE', clip: 'acknowledge' });
    expect(m.state).toBe('beckoning');
    m.send({ type: 'FOLLOW' });
    m.send({ type: 'CLIP_DONE', clip: 'rise' });
    expect(m.state).toBe('flying');
    m.send({ type: 'PASSED' });
    expect(m.state).toBe('revealing');
    m.send({ type: 'LANDED' });
    expect(m.state).toBe('done');
    expect(m.history).toEqual(['boot', 'loading', 'seated', 'awakening', 'acknowledging', 'beckoning', 'rising', 'flying', 'revealing', 'done']);
  });

  it('never traps a visitor: every beat times out', () => {
    const clock = fakeClock();
    const m = createIntroMachine(clock.schedule);
    m.send({ type: 'FULL' });
    m.send({ type: 'READY' });
    clock.advance(60_000); // no clip ever reports back
    for (let i = 0; i < 12 && m.state !== 'done'; i++) clock.advance(10_000);
    expect(m.state).toBe('done');
  });

  it('skips from any beat', () => {
    for (const steps of [0, 1, 2]) {
      const m = createIntroMachine(fakeClock().schedule);
      m.send({ type: 'FULL' });
      if (steps > 0) m.send({ type: 'READY' });
      if (steps > 1) m.send({ type: 'INTERACT' });
      m.send({ type: 'SKIP' });
      expect(m.state).toBe('revealing');
    }
  });

  it('falls back to the illustrated welcome when the 3D cannot load', () => {
    const m = createIntroMachine(fakeClock().schedule);
    m.send({ type: 'FULL' });
    m.send({ type: 'LOAD_FAILED' });
    expect(m.state).toBe('lite');
    m.send({ type: 'FOLLOW' });
    expect(m.state).toBe('liteFlight');
  });

  it('goes straight to the perched guide for returning visitors', () => {
    const m = createIntroMachine(fakeClock().schedule);
    m.send({ type: 'PERCH' });
    expect(m.state).toBe('done');
  });
});
