import type { Scheduler } from '../../src/intro/machine';

/** A scheduler we drive by hand: no real timers in tests. `now` reads the fake time. */
export function fakeClock() {
  let now = 0;
  const jobs: { at: number; fn: () => void; dead: boolean }[] = [];
  const schedule: Scheduler = (fn, ms) => {
    const job = { at: now + ms, fn, dead: false };
    jobs.push(job);
    return () => { job.dead = true; };
  };
  /** Moves time forward, running due jobs in order (including jobs they schedule). */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = jobs.filter((j) => !j.dead && j.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = Math.max(now, due.at);
      due.dead = true;
      due.fn();
    }
    now = end;
  };
  return { schedule, advance, now: () => now, pending: () => jobs.filter((j) => !j.dead).length };
}
