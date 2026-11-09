import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Box3, DoubleSide, LessEqualDepth, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import { applyFirstEntry, firstEntry, invitationStart, routeOf } from '../src/invitation/entry';
import {
  createInvitationMachine, createNarrator, invitationVisual, LOADING_MS, NARRATION, NARRATION_GAP_SECONDS, TAKE_RUNS, WAIT_IDLE_MS,
  WAIT_LIMIT_MS, WARMING_MS,
} from '../src/invitation/invitationMachine';
import { boxShows } from '../src/characters/sceneUtils';
import {
  beatTimeoutMs, clipLocalTime, cloudSpan, firstFrameOf, markersCrossed, MARKERS, parseTimeline, readTimeline,
  takeStartFrame, timingFrom, veilSecondsFrom, waitLimitFrame, type Timeline,
} from '../src/invitation/timeline';
import {
  createHeaderWatch, createQuietWatch, createWaitWatch, HEADER_QUIET_MS, POINTER_RECENT_MS, usingHeader, type HeaderDoc,
} from '../src/invitation/headerHold';
import { freshPace, guardStep, slowsForWait, stepPace, WAIT_PACE, type PaceState } from '../src/invitation/pace';
import { CLOUD_DEPTH_ORDER, CLOUD_ORDER, heldCloudLook, HELD_ORDER, magicCloudDepthLook, magicCloudLook } from '../src/invitation/cloudLook';
import { HEADING_MARKERS } from '../src/invitation/invitationMachine';
import { createPausableScheduler } from '../src/intro/machine';
import { fakeClock } from './helpers/fakeClock';

// A timeline shaped like the Blender export (60 fps, master frames). As in Blender's take, he turns
// to the visitor while he is still arriving: 'turn' comes before 'arrive'.
const RAW = {
  fps: 60,
  markers: { floatIn: 0, turn: 90, arrive: 120, smile: 160, offer: 200, lookDown: 250, glow: 280, expand: 320, engulf: 360, luminous: 400, dissipate: 460, complete: 520 },
  clips: {
    invite: { file: 'little-coco-invite.glb', startFrame: 0, endFrame: 420 },
    transform: { file: 'magic-cloud.glb', startFrame: 270, endFrame: 520 },
  },
  swapFrame: 440,
  adultBox: { x: 0, y: 0, w: 1, h: 1 },
};
const TL = parseTimeline(RAW)!;

describe('where a visit begins', () => {
  const at = (hash: string, o: Partial<{ search: string; seen: boolean; storageOk: boolean }> = {}) =>
    firstEntry({ hash, search: o.search ?? '', seen: o.seen ?? false, storageOk: o.storageOk ?? true });

  it('sends a first visit to home to the invitation, however home is written', () => {
    for (const hash of ['', '#', '#/', '#/?x=1']) expect(at(hash), hash).toBe('invite');
    expect(routeOf('#/realm/music/')).toBe('/realm/music');
  });

  it('goes straight in once seen, when storage is blocked, or with ?intro=off', () => {
    expect(at('#/', { seen: true })).toBe('none');
    expect(at('#/', { storageOk: false })).toBe('none');       // could never remember it: no redirect loop
    expect(at('#/', { search: '?intro=off' })).toBe('mark');
    expect(at('#/', { search: '?intro=off', seen: true })).toBe('none');
  });

  it('lets ?intro=full or lite force it, even when seen', () => {
    expect(at('#/', { search: '?intro=full', seen: true })).toBe('invite');
    expect(at('', { search: '?intro=lite', storageOk: false })).toBe('invite');
  });

  it('never redirects a deep link, and counts the welcome as seen', () => {
    expect(at('#/realm/music')).toBe('mark');
    expect(at('#/work/yourigin', { search: '?intro=full' })).toBe('mark');
    expect(at('#/about', { seen: true })).toBe('none');
    expect(at('#/invitation')).toBe('none');                    // the page decides
  });

  it('replaces the history entry (Back never bounces) and keeps the query', () => {
    const history = { state: { idx: 0 }, replaceState: vi.fn() };
    const markSeen = vi.fn();
    const action = applyFirstEntry({
      seen: () => false, storageOk: () => true, markSeen,
      location: { hash: '', search: '?utm=a', pathname: '/site/' }, history,
    });
    expect(action).toBe('invite');
    expect(history.replaceState).toHaveBeenCalledWith({ idx: 0 }, '', '/site/?utm=a#/invitation');
    expect(markSeen).not.toHaveBeenCalled();                    // the invitation marks it when it starts

    applyFirstEntry({ seen: () => false, storageOk: () => true, markSeen, location: { hash: '#/about', search: '', pathname: '/' }, history });
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it('plays the invitation page once per session; Replay plays it again', () => {
    expect(invitationStart({ seen: false, replay: false, forced: null })).toBe('play');
    expect(invitationStart({ seen: true, replay: false, forced: null })).toBe('home');   // a reload or a later visit
    expect(invitationStart({ seen: true, replay: true, forced: null })).toBe('play');
    expect(invitationStart({ seen: true, replay: false, forced: 'lite' })).toBe('play');
    expect(invitationStart({ seen: false, replay: true, forced: 'off' })).toBe('home');
  });
});

describe('the timeline from Blender', () => {
  it('reads markers, clips and the swap frame', () => {
    expect(TL.fps).toBe(60);
    expect(TL.markers.glow).toBe(280);
    expect(TL.clips.transform.startFrame).toBe(270);
    expect(TL.swapFrame).toBe(440);
    expect(takeStartFrame(TL)).toBe(0);
  });

  it('rejects files it cannot trust: only where the site depends on the order', () => {
    expect(parseTimeline(null)).toBeNull();
    expect(parseTimeline({ ...RAW, fps: 0 })).toBeNull();
    expect(parseTimeline({ ...RAW, markers: { ...RAW.markers, glow: undefined } })).toBeNull();          // glow is needed
    expect(parseTimeline({ ...RAW, markers: { ...RAW.markers, luminous: 'later' } })).toBeNull();       // so is luminous
    expect(parseTimeline({ ...RAW, markers: { ...RAW.markers, luminous: 200 } })).toBeNull();           // luminous before the glow
    expect(parseTimeline({ ...RAW, clips: { ...RAW.clips, invite: { file: 'x', startFrame: 300, endFrame: 400 } } })).toBeNull(); // the take starts after its glow
    // optional beats may be missing; broken clip entries are dropped
    const partial = parseTimeline({ fps: 30, markers: { glow: 10, luminous: 20 }, clips: { bad: { startFrame: 5, endFrame: 1 } } })!;
    expect(partial.markers.turn).toBeUndefined();
    expect(partial.clips).toEqual({});
    expect(partial.dropped).toEqual([]);
  });

  it('leaves out an optional marker that is out of place, instead of the whole file', () => {
    const late = parseTimeline({ ...RAW, markers: { ...RAW.markers, smile: 999 } })!;                    // a story beat after the glow
    expect(late.markers.smile).toBeUndefined();
    expect(late.markers.glow).toBe(280);
    expect(late.dropped).toEqual(['smile']);
    const broken = parseTimeline({ ...RAW, markers: { ...RAW.markers, turn: 'soon', engulf: 300, expand: 340 } })!;
    expect(broken.markers.turn).toBeUndefined();                                                         // not a number
    expect(broken.markers.engulf).toBeUndefined();                                                       // before expand
    expect(broken.markers.expand).toBe(340);
    const pastLuminous = parseTimeline({ ...RAW, markers: { ...RAW.markers, engulf: 450, dissipate: 380 } })!;
    expect(pastLuminous.markers.engulf).toBeUndefined();                                                 // must come before luminous
    expect(pastLuminous.markers.dissipate).toBeUndefined();                                              // must come after it
    expect(pastLuminous.markers.complete).toBe(520);
  });

  it("reads Blender's own marker order: he turns before he has fully arrived", () => {
    // a timeline shaped like Blender's (build_invitation.py lists the beats by name, not by frame),
    // with the later beats the magic-cloud build adds; the real file is checked below
    const blender = {
      fps: 60,
      markers: { floatIn: 0, turn: 108, arrive: 174, smile: 192, offer: 213, lookDown: 291, glow: 300 },
      clips: { invite: { file: 'models/invitation/little-coco-invite.glb', startFrame: 0, endFrame: 600 }, hover: { file: 'x', startFrame: 0, endFrame: 120, loop: true } },
      swapFrame: null,
      adultBox: null,
    };
    expect(parseTimeline(blender)).toBeNull();                                                           // no luminous yet: not playable
    const full = parseTimeline({ ...blender, markers: { ...blender.markers, expand: 330, engulf: 380, luminous: 430, dissipate: 470, complete: 540 } })!;
    expect(full).not.toBeNull();
    expect(full.dropped).toEqual([]);
    expect(full.markers.turn).toBe(108);
    expect(full.markers.arrive).toBe(174);
    // reported in the order the clock reaches them, not the order of any list
    expect(markersCrossed(full, 100, 180)).toEqual(['turn', 'arrive']);
    expect(markersCrossed(full, -0.001, 300)).toEqual(['floatIn', 'turn', 'arrive', 'smile', 'offer', 'lookDown', 'glow']);
  });

  // PROVISIONAL. TODO(magic-cloud build): once the Blender cloud build adds 'luminous' (and the
  // later beats) to public/models/invitation/timeline.json, this must parse the real file UNMODIFIED
  // and expect it to be playable; drop the branch that adds stand-in beats. Until then the shipped
  // file is rejected and every visitor gets the illustrated invitation.
  it('[provisional] the real timeline.json: its beats so far are in order (stand-in later beats until the cloud build adds them)', () => {
    const file = new URL('../public/models/invitation/timeline.json', import.meta.url);
    if (!existsSync(file)) return;                                                                       // not exported yet
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { markers?: Record<string, unknown> };
    const later = { expand: 1e6, engulf: 1e6 + 1, luminous: 1e6 + 2, dissipate: 1e6 + 3, complete: 1e6 + 4 };
    if (raw.markers && 'luminous' in raw.markers) {
      const t = parseTimeline(raw);
      expect(t, 'public/models/invitation/timeline.json').not.toBeNull();
      expect(t!.dropped).toEqual([]);
    } else {
      // the magic-cloud build has not added its beats yet: what is there must already be in order
      const t = parseTimeline({ ...raw, markers: { ...raw.markers, ...later } });
      expect(t, 'public/models/invitation/timeline.json (with the later beats added)').not.toBeNull();
      expect(t!.dropped).toEqual([]);
    }
  });

  it('copes with a missing or wrong file: no timeline, so the illustrated invitation', async () => {
    const respond = (body: string, ok = true) => (async () => ({ ok, text: async () => body })) as unknown as typeof fetch;
    const timelineOf = async (f: typeof fetch) => (await readTimeline('x', f)).timeline;
    expect(await timelineOf(respond('', false))).toBeNull();                                 // 404
    expect(await timelineOf(respond('<!doctype html><html></html>'))).toBeNull();            // a dev-server fallback page
    expect(await timelineOf(respond('{ not json'))).toBeNull();
    expect(await timelineOf((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
    expect((await timelineOf(respond(JSON.stringify(RAW))))?.markers.luminous).toBe(400);
    // a missing file and a rejected one are told apart (for the console)
    expect((await readTimeline('x', respond('', false))).problem).toBe('missing');
    expect((await readTimeline('x', respond(JSON.stringify({ fps: 60, markers: { glow: 10 } })))).problem).toBe('rejected');
    expect((await readTimeline('x', respond(JSON.stringify(RAW)))).problem).toBeNull();
  });

  it('times every beat from the authored numbers plus a margin, never by hand', () => {
    const timing = timingFrom(TL, 0.6);
    expect(timing.takeMs).toBe(beatTimeoutMs(280 / 60));
    expect(timing.transformMs).toBe(beatTimeoutMs((400 - 280) / 60));
    expect(timing.carryMs).toBe(beatTimeoutMs(0.6));
    expect(timing.takeMs).toBeGreaterThan((280 / 60) * 1000);       // always longer than the beat itself
    const slower = timingFrom(parseTimeline({ ...RAW, markers: { ...RAW.markers, glow: 340, expand: 340, engulf: 360 } })!, 0.6);
    expect(slower.takeMs).toBeGreaterThan(timing.takeMs);
  });

  it('takes the veil timing from the beats after luminous', () => {
    expect(veilSecondsFrom(TL)).toEqual({ cover: 40 / 60, reveal: 60 / 60 });
    const noSwap = parseTimeline({ ...RAW, swapFrame: undefined })!;
    expect(veilSecondsFrom(noSwap).cover).toBeCloseTo(60 / 60);
    expect(veilSecondsFrom(parseTimeline({ fps: 60, markers: { glow: 1, luminous: 2 } })!)).toEqual({ cover: null, reveal: null });
  });

  it('reports each marker once, in order, as the clock passes it', () => {
    expect(markersCrossed(TL, -0.001, 0)).toEqual(['floatIn']);
    expect(markersCrossed(TL, 80, 170)).toEqual(['turn', 'arrive', 'smile']);
    expect(markersCrossed(TL, 170, 170)).toEqual([]);
    // "Come on in" jumps to the glow: the skipped beats stay unspoken, the glow comes next
    expect(markersCrossed(TL, 280 - 0.001, 281)).toEqual(['glow']);
  });

  it('shows the heading from the first of the smile and the offer, by frame', () => {
    expect(firstFrameOf(TL, HEADING_MARKERS)).toBe(160);
    const offerFirst = parseTimeline({ ...RAW, markers: { ...RAW.markers, smile: 230, offer: 210 } })!;
    expect(firstFrameOf(offerFirst, HEADING_MARKERS)).toBe(210);
    const neither = parseTimeline({ fps: 60, markers: { glow: 280, luminous: 400 } })!;
    expect(firstFrameOf(neither, HEADING_MARKERS)).toBe(280);                                          // else with the glow
  });

  it('starts the magic cloud at the glow when the timeline does not place it (never at the first frame)', () => {
    const noSpan = parseTimeline({ ...RAW, clips: { invite: RAW.clips.invite } })!;
    const span = cloudSpan(noSpan, 4);
    expect(span.startFrame).toBe(280);
    expect(span.endFrame).toBe(280 + 4 * 60);
    expect(clipLocalTime(span, 100, 4, 60)).toBe(0);                     // still on its first frame during the take
    expect(clipLocalTime(span, 310, 4, 60)).toBeCloseTo(0.5);            // half a second after the glow
    expect(clipLocalTime(span, 2000, 4, 60)).toBeCloseTo(4);
    expect(cloudSpan(TL, 4)).toEqual(TL.clips.transform);                 // the file's own span wins
  });

  it("maps the master clock onto each clip, whether Blender slid it to zero or kept absolute frames", () => {
    const span = TL.clips.transform;           // frames 270..520
    const slid = (520 - 270) / 60;
    expect(clipLocalTime(span, 300, slid, 60)).toBeCloseTo(30 / 60);
    expect(clipLocalTime(span, 300, 520 / 60, 60)).toBeCloseTo(300 / 60);   // absolute times
    expect(clipLocalTime(span, 100, slid, 60)).toBe(0);                      // not started: first frame
    expect(clipLocalTime(span, 900, slid, 60)).toBeCloseTo(slid);            // finished: last frame
    expect(clipLocalTime(undefined, 120, 10, 60)).toBeCloseTo(2);
  });
});

describe('the invitation machine', () => {
  const setup = (timeline: Timeline | null = TL, busy = { now: false }) => {
    const clock = fakeClock();
    const m = createInvitationMachine(() => (timeline ? timingFrom(timeline, 0.6) : null), clock.schedule, () => busy.now);
    return { m, clock, busy };
  };
  const toTake = (m: ReturnType<typeof setup>['m']) => {
    m.send({ type: 'START' });
    m.send({ type: 'LOADED' });
    m.send({ type: 'WARM' });
  };

  it('plays the take, the transformation and the trip home, beat by beat from the clock', () => {
    const { m } = setup();
    toTake(m);
    expect(m.state).toBe('take');
    m.send({ type: 'MARKER', name: 'smile' });
    expect(m.state).toBe('take');
    m.send({ type: 'MARKER', name: 'glow' });
    expect(m.state).toBe('transforming');
    m.send({ type: 'MARKER', name: 'engulf' });
    m.send({ type: 'MARKER', name: 'luminous' });
    expect(m.state).toBe('carrying');
    m.send({ type: 'COVERED' });
    expect(m.history).toEqual(['boot', 'loading', 'warming', 'take', 'transforming', 'carrying', 'done']);
  });

  it('can never run twice', () => {
    const { m } = setup();
    expect(m.send({ type: 'START' })).toBe(true);
    expect(m.send({ type: 'START' })).toBe(false);        // START is accepted once
    m.send({ type: 'ESCAPE' });
    expect(m.state).toBe('done');
    for (const type of ['START', 'LOADED', 'WARM', 'COME_IN', 'COVERED', 'LITE'] as const) expect(m.send({ type })).toBe(false);
    expect(m.send({ type: 'MARKER', name: 'glow' })).toBe(false);
  });

  it('times out every beat from the timeline, so nothing can trap a visitor', () => {
    const { m, clock } = setup();
    toTake(m);
    const t = timingFrom(TL, 0.6);
    clock.advance(t.takeMs - 1);
    expect(m.state).toBe('take');
    clock.advance(1);
    expect(m.state).toBe('transforming');
    clock.advance(t.transformMs);
    expect(m.state).toBe('carrying');
    clock.advance(t.carryMs);
    expect(m.state).toBe('done');
  });

  it('falls back to the illustrated invitation if loading stalls or fails, and never moves on by itself', () => {
    const slow = setup();
    slow.m.send({ type: 'START' });
    slow.clock.advance(LOADING_MS);
    expect(slow.m.state).toBe('illustrated');
    slow.clock.advance(600_000);
    expect(slow.m.state).toBe('illustrated');               // no auto-advance
    slow.m.send({ type: 'COME_IN' });
    expect(slow.m.state).toBe('done');

    const broken = setup();
    toTake(broken.m);
    broken.m.send({ type: 'LOAD_FAILED' });                 // e.g. the WebGL context was lost
    expect(broken.m.state).toBe('illustrated');

    const lite = setup();
    lite.m.send({ type: 'LITE' });
    expect(lite.m.state).toBe('illustrated');
  });

  it('leaves warming for home on "Come on in" (no take to jump into yet), or for the painting if the models fail', () => {
    const come = setup();
    come.m.send({ type: 'START' });
    come.m.send({ type: 'LOADED' });
    expect(come.m.state).toBe('warming');
    come.m.send({ type: 'COME_IN' });
    expect(come.m.state).toBe('done');

    const lost = setup();
    lost.m.send({ type: 'START' });
    lost.m.send({ type: 'LOADED' });
    lost.m.send({ type: 'LOAD_FAILED' });                 // e.g. the context was lost while compiling
    expect(lost.m.state).toBe('illustrated');
  });

  it('never hangs if a timed beat is somehow reached with no timing known: each such beat moves on at once', () => {
    // unreachable today (LOADED needs the timeline), pinned so it can never become a trap
    const { m, clock } = setup(null);
    m.send({ type: 'START' });
    m.send({ type: 'LOADED' });
    m.send({ type: 'WARM' });
    expect(m.state).toBe('take');
    clock.advance(0);
    expect(m.history).toEqual(['boot', 'loading', 'warming', 'take', 'transforming', 'carrying', 'done']);
  });

  it('starts the take anyway if compiling takes too long', () => {
    const { m, clock } = setup();
    m.send({ type: 'START' });
    m.send({ type: 'LOADED' });
    clock.advance(WARMING_MS);
    expect(m.state).toBe('take');
  });

  it('goes home at once on Escape, from any beat', () => {
    for (const steps of [0, 1, 2, 3, 4, 5]) {
      const { m } = setup();
      const seq = [{ type: 'START' }, { type: 'LOADED' }, { type: 'WARM' }, { type: 'MARKER', name: 'glow' }, { type: 'MARKER', name: 'luminous' }] as const;
      seq.slice(0, steps).forEach((e) => m.send(e));
      m.send({ type: 'ESCAPE' });
      expect(m.state, `after ${steps} steps`).toBe('done');
    }
  });

  it('"Come on in" starts the transformation at once during the take, and adds nothing after', () => {
    const { m } = setup();
    m.send({ type: 'START' });
    expect(m.send({ type: 'COME_IN' })).toBe(true);        // still loading: straight home
    expect(m.state).toBe('done');

    const take = setup();
    toTake(take.m);
    take.m.send({ type: 'COME_IN' });
    expect(take.m.state).toBe('transforming');
    expect(take.m.send({ type: 'COME_IN' })).toBe(false);   // the transformation does nothing new
    take.m.send({ type: 'MARKER', name: 'glow' });          // the clock reaches the glow it jumped to
    expect(take.m.state).toBe('transforming');
    take.m.send({ type: 'MARKER', name: 'luminous' });
    expect(take.m.send({ type: 'COME_IN' })).toBe(false);
    expect(take.m.state).toBe('carrying');
  });

  it('holds still in a hidden tab: the safety timers pause and resume where they were', () => {
    const clock = fakeClock();
    const sched = createPausableScheduler(clock.schedule, clock.now);
    const m = createInvitationMachine(() => timingFrom(TL, 0.6), sched.schedule);
    m.send({ type: 'START' });
    m.send({ type: 'LOADED' });
    m.send({ type: 'WARM' });
    const { takeMs } = timingFrom(TL, 0.6);
    clock.advance(1000);
    sched.pause();
    clock.advance(10 * takeMs);
    expect(m.state).toBe('take');
    sched.resume();
    clock.advance(takeMs - 1001);
    expect(m.state).toBe('take');
    clock.advance(1);
    expect(m.state).toBe('transforming');
  });

  it('starts the take in whichever running state the page sees first ("Come on in" can race WARM)', () => {
    const { m } = setup();
    m.send({ type: 'START' });
    m.send({ type: 'LOADED' });
    const seen: string[] = [];
    m.subscribe((s) => seen.push(s));
    m.send({ type: 'WARM' });
    m.send({ type: 'COME_IN' });                // same moment: React may only ever render 'transforming'
    expect(seen).toEqual(['take', 'transforming']);
    expect(TAKE_RUNS).toContain(seen[seen.length - 1]);
    expect(TAKE_RUNS).not.toContain('warming');
  });

  it('never covers the header while the visitor is using it: at luminous the trip waits, then carries on when they are done', () => {
    const { m, busy } = setup();
    toTake(m);
    m.send({ type: 'MARKER', name: 'glow' });
    busy.now = true;                                         // the mobile menu is open
    m.send({ type: 'MARKER', name: 'luminous' });
    expect(m.state).toBe('waiting');                         // no cloud over the menu
    expect(TAKE_RUNS).toContain('waiting');                  // the take keeps moving (gently) meanwhile
    expect(invitationVisual('waiting', false, 'live').live3D).toBe(true);
    expect(m.send({ type: 'COVERED' })).toBe(false);         // nothing can skip the wait to home
    busy.now = false;
    m.send({ type: 'FREE' });                                // menu closed, focus elsewhere, for a moment
    expect(m.state).toBe('carrying');
    m.send({ type: 'COVERED' });
    expect(m.history).toEqual(['boot', 'loading', 'warming', 'take', 'transforming', 'waiting', 'carrying', 'done']);
  });

  it('goes straight to the trip when nobody is in the header; a header left untouched lets it go on, and a last-resort cap means nothing can hang', () => {
    const free = setup();
    toTake(free.m);
    free.m.send({ type: 'MARKER', name: 'glow' });
    free.m.send({ type: 'MARKER', name: 'luminous' });
    expect(free.m.state).toBe('carrying');

    const left = setup();
    toTake(left.m);
    left.m.send({ type: 'MARKER', name: 'glow' });
    left.busy.now = true;                                    // a menu left open
    left.m.send({ type: 'MARKER', name: 'luminous' });
    left.clock.advance(WAIT_IDLE_MS);
    expect(left.m.state).toBe('waiting');                    // the machine never times a header in use by itself
    left.m.send({ type: 'GIVE_UP' });                        // the page: untouched for WAIT_IDLE_MS
    expect(left.m.state).toBe('carrying');

    const { m, clock, busy } = setup();
    toTake(m);
    m.send({ type: 'MARKER', name: 'glow' });
    busy.now = true;
    m.send({ type: 'MARKER', name: 'luminous' });
    clock.advance(WAIT_LIMIT_MS - 1);
    expect(m.state).toBe('waiting');
    clock.advance(1);
    expect(m.state).toBe('carrying');                        // the last resort
    expect(WAIT_LIMIT_MS).toBeGreaterThan(WAIT_IDLE_MS);
  });

  it('waits too when the safety net (not the clock) ends the transformation while the visitor is in the header', () => {
    const { m, clock, busy } = setup();
    toTake(m);
    m.send({ type: 'MARKER', name: 'glow' });
    busy.now = true;
    clock.advance(timingFrom(TL, 0.6).transformMs);
    expect(m.state).toBe('waiting');
  });

  it('lets the visitor end the wait: "Come on in" carries them home, Escape goes home at once, a lost context shows the painting', () => {
    const into = () => {
      const s = setup();
      toTake(s.m);
      s.m.send({ type: 'MARKER', name: 'glow' });
      s.busy.now = true;
      s.m.send({ type: 'MARKER', name: 'luminous' });
      return s.m;
    };
    const a = into();
    a.send({ type: 'COME_IN' });
    expect(a.state).toBe('carrying');
    const b = into();
    b.send({ type: 'ESCAPE' });
    expect(b.state).toBe('done');
    const c = into();
    c.send({ type: 'LOAD_FAILED' });
    expect(c.state).toBe('illustrated');
  });

  it('"Come on in" is the visitor\'s decision: once pressed, the trip never waits for the header (an open menu included)', () => {
    // pressed during the take, with the phone menu still open
    const a = setup(TL, { now: true });
    toTake(a.m);
    a.m.send({ type: 'COME_IN' });
    expect(a.m.state).toBe('transforming');
    a.m.send({ type: 'MARKER', name: 'glow' });
    a.m.send({ type: 'MARKER', name: 'luminous' });
    expect(a.m.state).toBe('carrying');

    // pressed again during the transformation (it reached the glow on its own)
    const b = setup(TL, { now: true });
    toTake(b.m);
    b.m.send({ type: 'MARKER', name: 'glow' });
    b.m.send({ type: 'COME_IN' });
    b.m.send({ type: 'MARKER', name: 'luminous' });
    expect(b.m.state).toBe('carrying');

    // the safety net ends the transformation: the same
    const c = setup(TL, { now: true });
    toTake(c.m);
    c.m.send({ type: 'COME_IN' });
    c.clock.advance(timingFrom(TL, 0.6).transformMs);
    expect(c.m.state).toBe('carrying');
  });

  it('keeps showing what was on screen when it is done, so the way home crossfades from it', () => {
    expect(invitationVisual('illustrated', true, 'live')).toEqual({ visual: 'illustrated', live3D: false });
    expect(invitationVisual('done', false, 'illustrated')).toEqual({ visual: 'illustrated', live3D: false });   // not an empty stage
    expect(invitationVisual('take', false, 'live')).toEqual({ visual: 'live', live3D: true });
    expect(invitationVisual('done', false, 'live')).toEqual({ visual: 'live', live3D: true });                // the canvas stays for the crossfade
    expect(invitationVisual('loading', false, 'live').live3D).toBe(true);
  });

  it('narrates only what is on screen, for known beats', () => {
    for (const name of Object.keys(NARRATION)) expect(MARKERS).toContain(name);
    expect(NARRATION.floatIn).toBe('Young Coco floats in on his cloud.');
  });

  it('speaks beats that Blender puts close together as one line, when the last of them happens', () => {
    // synthetic spacing: smile 192, offer 213 (0.35 s); lookDown 291, glow 300 (0.15 s); engulf 0.83 s before luminous
    const t = parseTimeline({ fps: 60, markers: { floatIn: 0, turn: 108, arrive: 174, smile: 192, offer: 213, lookDown: 291, glow: 300, expand: 320, engulf: 380, luminous: 430 } })!;
    const say = createNarrator(t);
    expect(say('floatIn')).toBe(NARRATION.floatIn);
    expect(say('turn')).toBe(NARRATION.turn);                 // 1.4 s before the smile: on its own
    expect(say('arrive')).toBeNull();                         // not narrated
    expect(say('smile')).toBeNull();                          // the offer follows 0.35 s later: wait for it
    expect(say('offer')).toBe(NARRATION.smile + ' ' + NARRATION.offer);
    expect(say('lookDown')).toBeNull();
    expect(say('glow')).toBe(NARRATION.lookDown + ' ' + NARRATION.glow);
    // the trip follows the engulf closely: its line is held back and handed to the veil, which
    // speaks it with the trip (never two announcements a moment apart from two live regions)
    expect(say('engulf')).toBeNull();
    expect(say('luminous')).toBeNull();                       // the veil announces the trip
    expect(say.flush()).toBe(NARRATION.engulf);
    expect(say.flush()).toBe('');                             // handed over once
    expect(NARRATION_GAP_SECONDS).toBeGreaterThanOrEqual(1);

    // with the trip well after it, the engulf is spoken on its own as it happens
    const far = createNarrator(parseTimeline({ fps: 60, markers: { glow: 300, engulf: 380, luminous: 500 } })!);
    expect(far('engulf')).toBe(NARRATION.engulf);
    expect(far.flush()).toBe('');
  });

  it('never speaks a beat the clock skipped ("Come on in" jumps to the glow), nor one it held back before the jump', () => {
    const t = parseTimeline({ fps: 60, markers: { floatIn: 0, turn: 213, smile: 252, offer: 270, lookDown: 291, glow: 366, luminous: 500 } })!;
    const say = createNarrator(t);
    expect(say('floatIn')).toBe(NARRATION.floatIn);
    expect(say('turn')).toBeNull();                           // the smile follows closely: held back
    expect(say('smile')).toBeNull();
    say.skip();                                               // "Come on in": the clock jumps to the glow
    expect(say('glow')).toBe(NARRATION.glow);                 // not "He turns. He smiles. ... It glows." a second late
  });

  /**
   * Narrates a timeline by the rule: close beats spoken together at the last, none before it
   * happens, none twice. What is still held back at luminous is handed to the veil (flush), which
   * speaks it with the trip: after every beat in it, so it counts as one more spoken line.
   */
  const checkNarration = (t: Timeline) => {
    const say = createNarrator(t);
    const gap = NARRATION_GAP_SECONDS * t.fps;
    const spoken: { frame: number; line: string }[] = [];
    for (const name of markersCrossed(t, -1e-3, t.markers.luminous)) {
      const line = say(name);
      if (line) spoken.push({ frame: t.markers[name]!, line });
    }
    const leftover = say.flush();
    const lines = [...spoken.map((x) => x.line), ...(leftover ? [leftover] : [])];
    const beats = (Object.keys(NARRATION) as (keyof typeof NARRATION)[])
      .filter((m) => m !== 'luminous' && t.markers[m] !== undefined)
      .sort((a, b) => t.markers[a]! - t.markers[b]!);
    const all = lines.join(' ');
    for (const m of beats) {
      expect(all.split(NARRATION[m]!).length - 1, m).toBe(1);                                            // spoken once
      const at = spoken.find((x) => x.line.includes(NARRATION[m]!));
      if (at) expect(at.frame, m).toBeGreaterThanOrEqual(t.markers[m]!);                                 // never early (the leftover comes at luminous, after all of it)
    }
    for (let i = 1; i < beats.length; i++) {
      const [a, b] = [beats[i - 1], beats[i]];
      const together = lines.find((l) => l.includes(NARRATION[a]!))?.includes(NARRATION[b]!) ?? false;
      expect(together, `${a} then ${b}`).toBe(t.markers[b]! - t.markers[a]! < gap);                      // joined only when close
    }
    for (let i = 1; i < spoken.length; i++) expect(spoken[i].frame - spoken[i - 1].frame).toBeGreaterThanOrEqual(gap);
    return { spoken, leftover };
  };

  it('narrates the real timeline.json by the rule: close beats spoken together at the last, none before it happens, none twice', () => {
    const file = new URL('../public/models/invitation/timeline.json', import.meta.url);
    if (!existsSync(file)) return;                                                                       // not exported yet
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { markers?: Record<string, unknown> };
    const later = { expand: 1e6, engulf: 1e6 + 1, luminous: 1e6 + 2, dissipate: 1e6 + 3, complete: 1e6 + 4 };
    const t = parseTimeline(raw.markers && 'luminous' in raw.markers ? raw : { ...raw, markers: { ...raw.markers, ...later } })!;
    expect(t).not.toBeNull();
    checkNarration(t);
  });

  it('narrates by the same rule when the trip follows the last beats closely (the later markers Blender will add)', () => {
    // today's beats, with plausible later ones: luminous close behind the glow and the engulf
    const t = parseTimeline({
      fps: 60,
      markers: { floatIn: 0, arrive: 239, turn: 243, smile: 282, offer: 300, lookDown: 387, glow: 396, expand: 420, engulf: 460, luminous: 520, dissipate: 600, complete: 660 },
    })!;
    const { leftover } = checkNarration(t);
    expect(leftover).toBe([NARRATION.lookDown, NARRATION.glow, NARRATION.engulf].join(' '));             // spoken with the trip
    // and with the trip well behind them, each is spoken as it happens
    checkNarration(parseTimeline({ fps: 60, markers: { floatIn: 0, turn: 243, smile: 282, offer: 300, lookDown: 387, glow: 396, engulf: 460, luminous: 560 } })!);
  });

  it('speaks a line held back for the trip as soon as the trip has to wait for the visitor, and only once', () => {
    const t = parseTimeline({ fps: 60, markers: { glow: 300, engulf: 380, luminous: 430 } })!;
    const say = createNarrator(t);
    expect(say('glow')).toBe(NARRATION.glow);
    expect(say('engulf')).toBeNull();                         // the trip follows closely: held back for it
    expect(say('luminous')).toBeNull();
    // the trip waits (the visitor is in the header): the page speaks it now, while it is still true
    expect(say.flush()).toBe(NARRATION.engulf);
    // when the trip finally starts, the veil has only the trip itself to announce
    expect(say.flush()).toBe('');
    const page = readFileSync(new URL('../src/invitation/InvitationPage.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/if \(s === 'waiting'\) \{\s*const held = narrator\.current\?\.flush\(\)/);
  });
});

describe('waiting for a visitor who is using the header', () => {
  const doc = (o: { menuOpen?: boolean; inHeader?: boolean; focusVisible?: boolean | 'unsupported' } = {}): HeaderDoc => ({
    querySelector: (sel: string) => (sel === '.site-nav.is-open' && o.menuOpen ? {} : null),
    activeElement: {
      closest: (sel: string) => (sel === '.site-header' && o.inHeader ? {} : null),
      matches: (sel: string) => {
        if (o.focusVisible === 'unsupported') throw new SyntaxError(sel);
        return sel === ':focus-visible' && !!o.focusVisible;
      },
    },
  });

  it('counts an open menu, or keyboard focus in the header, but not focus left on the menu button by a tap', () => {
    expect(usingHeader(doc())).toBe(false);
    expect(usingHeader(doc({ menuOpen: true }))).toBe(true);
    expect(usingHeader(doc({ inHeader: true, focusVisible: true }))).toBe(true);      // tabbing through the realms
    expect(usingHeader(doc({ inHeader: true, focusVisible: false }))).toBe(false);    // tapped the toggle, menu closed again
    expect(usingHeader(doc({ inHeader: true, focusVisible: 'unsupported' }))).toBe(true);
    expect(usingHeader({ querySelector: () => null, activeElement: null })).toBe(false);
  });

  it('counts a mouse busy in the header (desktop: no menu to open), not one parked there, and never touch', () => {
    let t = 0;
    let hover = true;
    const target = new EventTarget();
    const w = createHeaderWatch({ target, inHeader: (e) => (e as Event & { inHeader?: boolean }).inHeader === true, canHover: () => hover, now: () => t });
    const fire = (type: string, o: { pointerType?: string; inHeader?: boolean }) => target.dispatchEvent(Object.assign(new Event(type), o));
    expect(w.pointerBusy()).toBe(false);
    fire('pointermove', { pointerType: 'mouse', inHeader: true });
    expect(w.pointerBusy()).toBe(true);                             // choosing a realm with the mouse
    t += POINTER_RECENT_MS - 1;
    expect(w.pointerBusy()).toBe(true);
    t += 1;
    expect(w.pointerBusy()).toBe(false);                            // merely parked there
    fire('pointerdown', { pointerType: 'mouse', inHeader: true });
    expect(w.pointerBusy()).toBe(true);
    fire('pointermove', { pointerType: 'mouse', inHeader: false });
    expect(w.pointerBusy()).toBe(false);                            // left the header
    fire('pointerdown', { pointerType: 'touch', inHeader: true });
    expect(w.pointerBusy()).toBe(false);                            // touch never counts (an open menu does)
    expect(w.lastActivity()).toBe(t);                               // but it is a touch of the header
    fire('pointermove', { pointerType: 'mouse', inHeader: true });
    hover = false;
    expect(w.pointerBusy()).toBe(false);                            // a device that cannot hover
    t += 50;
    fire('keydown', { inHeader: true });
    expect(w.lastActivity()).toBe(t);
    fire('focusin', { inHeader: false });
    expect(w.lastActivity()).toBe(t);
    w.stop();
    t += 50;
    fire('keydown', { inHeader: true });
    expect(w.lastActivity()).toBe(t - 50);                          // stopped listening
  });

  it('lets the trip go on once a header in use is left untouched, counting from each touch and only while the tab is visible', () => {
    const run = (busy: (t: number) => boolean, activity: (t: number) => number, hidden = (_t: number) => false) => {
      const watch = createWaitWatch();
      for (let t = 0; t <= 90_000; t += 100) {
        const v = watch({ now: t, hidden: hidden(t), busy: busy(t), activityAt: activity(t) });
        if (v) return { v, t };
      }
      return null;
    };
    expect(run(() => true, () => 0)).toEqual({ v: 'give-up', t: WAIT_IDLE_MS });                   // a menu left open
    expect(run(() => true, (t) => (t >= 10_000 ? 10_000 : 0))).toEqual({ v: 'give-up', t: 10_000 + WAIT_IDLE_MS });   // a touch starts it again
    expect(run(() => true, (t) => Math.floor(t / 5000) * 5000)).toBeNull();                       // in use all along: never covered
    expect(run(() => true, () => 0, (t) => t >= 5000 && t < 25_000)).toEqual({ v: 'give-up', t: 20_000 + WAIT_IDLE_MS });   // hidden time does not count
    expect(run((t) => t < 2000, () => 0)).toEqual({ v: 'free', t: Math.ceil((2000 + HEADER_QUIET_MS) / 100) * 100 });   // finished with it
  });

  it('lets the trip carry on only after the header has been quiet for a moment (hysteresis)', () => {
    const done = createQuietWatch();
    expect(done(true, 0)).toBe(false);
    expect(done(false, 100)).toBe(false);
    expect(done(true, 200)).toBe(false);                           // focus hopped to the next link: start again
    expect(done(false, 300)).toBe(false);
    expect(done(false, 300 + HEADER_QUIET_MS - 1)).toBe(false);
    expect(done(false, 300 + HEADER_QUIET_MS)).toBe(true);
  });

  // drives stepPace as the stage does; returns each frame's speed (authored seconds per second)
  const drive = (st: PaceState, seconds: number, fps: number, input: (i: number) => Parameters<typeof stepPace>[1], room: { left: number }) => {
    const dt = 1 / fps;
    const speeds: number[] = [];
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      const step = stepPace(st, { ...input(i), roomSeconds: room.left }, dt);
      room.left -= step;
      speeds.push(step / dt);
    }
    return speeds;
  };

  it('eases to a gentle glide while waiting with plenty of room, with no jump in speed, and back to full speed after', () => {
    const st = freshPace();
    const room = { left: 100 };
    const waiting = drive(st, 6, 60, () => ({ waiting: true, roomSeconds: 0 }), room);
    for (const v of waiting) expect(v).toBeGreaterThanOrEqual(WAIT_PACE - 1e-3);    // never below the glide: no dead stop
    expect(st.pace).toBeCloseTo(WAIT_PACE, 2);
    const after = drive(st, 4, 60, () => ({ waiting: false, roomSeconds: 0 }), { left: Infinity });
    expect(st.pace).toBeCloseTo(1, 2);
    const all = [1, ...waiting, ...after];
    for (let i = 1; i < all.length; i++) expect(Math.abs(all[i] - all[i - 1])).toBeLessThan(0.03);   // eased: no step in speed
  });

  // What these check is the pace's arithmetic: the room is never used up (no clamped frame), the
  // speed never surges, and both frame rates follow the same curve. With only a fraction of a second
  // of room the take is all but still after a moment: only an authored 'luminous_hold' loop (a
  // Blender job, see pace.ts HOLD_CLIP) truly fills a long wait.
  it('never uses up its room while waiting, never speeds up, and follows the same curve at 60 fps and at 10 fps', () => {
    const runs: Record<string, number[]> = {};
    for (const room0 of [40 / 60, 20 / 60, 3]) {
      for (const fps of [60, 10]) {
        const st = freshPace();
        const room = { left: room0 };
        const speeds = drive(st, WAIT_IDLE_MS / 1000, fps, () => ({ waiting: true, roomSeconds: 0 }), room);
        const label = `room ${room0.toFixed(2)} s at ${fps} fps`;
        expect(room.left, label).toBeGreaterThan(0);                                   // never a clamped frame
        for (const v of speeds) expect(v, label).toBeGreaterThan(0);                   // never exactly still
        for (let i = 1; i < speeds.length; i++) expect(speeds[i], label).toBeLessThanOrEqual(speeds[i - 1] + 1e-9);   // slows, never surges
        runs[`${room0}@${fps}`] = speeds;
      }
      // the same eased slow-down whatever the frame rate (no drop at once at 60 fps; 10 fps samples the
      // same curve). A 0.1 s frame uses a larger share of a short room, so guardStep shortens it by a
      // few percent while the take is still near full speed: the worst measured gap is 0.07, on the
      // first 10 fps frame with 0.33 s of room, and it closes within half a second.
      const fine = runs[`${room0}@60`], coarse = runs[`${room0}@10`];
      expect(fine[0]).toBeGreaterThan(0.9);
      for (let i = 0; i < coarse.length; i++) expect(Math.abs(coarse[i] - fine[i * 6 + 5]), `room ${room0} at ${(i + 1) / 10} s`).toBeLessThan(0.08);
      for (let i = 5; i < coarse.length; i++) expect(Math.abs(coarse[i] - fine[i * 6 + 5]), `room ${room0} at ${(i + 1) / 10} s`).toBeLessThan(0.02);
    }
  });

  it('with only the fraction of a second of room before the next beat, brakes over most of a second, not a third', () => {
    // the planned magic cloud: 0.6 s of authored time between luminous and the swap
    for (const fps of [60, 10]) {
      const speeds = drive(freshPace(), 2, fps, () => ({ waiting: true, roomSeconds: 0 }), { left: 0.6 });
      const at = (s: number) => speeds[Math.round(s * fps) - 1];
      expect(at(0.3), `${fps} fps`).toBeGreaterThan(0.5);                                 // still over half speed after 0.3 s
      expect(at(0.8), `${fps} fps`).toBeGreaterThan(0.1);                                 // still moving after 0.8 s
      let prev = 1, worst = 0;                                                            // the drop in speed per 1/60 s
      for (const v of speeds) { worst = Math.max(worst, (prev - v) * (fps / 60)); prev = v; }
      expect(worst, `${fps} fps`).toBeLessThan(0.03);                                     // no frame brakes hard
    }
  });

  it('plays the transformation at full speed with the visitor in the header: the wait, and its slowing, start at luminous', () => {
    // the machine and the pace together, as the page and the stage run them (60 fps)
    const fps = TL.fps;
    const clock = fakeClock();
    const busy = { now: true };                                                         // in the header from before the glow
    const m = createInvitationMachine(() => timingFrom(TL, 0.6), clock.schedule, () => busy.now);
    m.send({ type: 'START' }); m.send({ type: 'LOADED' }); m.send({ type: 'WARM' });
    const L = TL.markers.luminous;
    const limit = waitLimitFrame(TL, [TL.clips.invite.endFrame]);
    const st = freshPace();
    let frame = TL.markers.glow - 30, waitedFrom = -1;
    for (let i = 0; i < 6 * fps; i++) {
      clock.advance(1000 / fps);
      const step = stepPace(st, { waiting: slowsForWait(m.state, frame, L), roomSeconds: (limit - frame) / fps }, 1 / fps);
      if (frame < L) expect(step * fps, `frame ${frame.toFixed(1)}`).toBe(1);             // full speed, as authored
      expect(step).toBeGreaterThan(0);                                                   // never a dead stop
      const before = frame;
      frame += step * fps;
      for (const name of markersCrossed(TL, before, frame)) m.send({ type: 'MARKER', name });
      if (m.state === 'waiting' && waitedFrom < 0) waitedFrom = frame;
    }
    expect(waitedFrom).toBeGreaterThanOrEqual(L);                                      // the wait began on the luminous cloud
    expect(m.state).toBe('waiting');                                                   // the safety net never ended it early
    expect(frame).toBeLessThan(limit);                                                 // eased down, never reaching the next beat
    busy.now = false;
    m.send({ type: 'FREE' });
    expect(m.state).toBe('carrying');                                                  // the trip home starts once they are done
    // a slow device whose safety net starts the wait before luminous plays on to it at full speed first
    expect(slowsForWait('waiting', L - 1, L)).toBe(false);
    expect(slowsForWait('waiting', L, L)).toBe(true);
    expect(slowsForWait('transforming', L + 5, L)).toBe(false);
  });

  it('with an authored hold loop on screen, lets the take underneath come to rest, never past the beat', () => {
    const st = freshPace();
    const room = { left: 0.5 };
    const speeds = drive(st, 5, 60, () => ({ waiting: true, roomSeconds: 0, holding: true }), room);
    expect(room.left).toBeGreaterThan(0);
    expect(speeds[speeds.length - 1]).toBeLessThan(1e-3);
    expect(speeds[0]).toBeGreaterThan(0.9);                                             // eased down, not stopped dead
  });

  it('after a wait, keeps the take held to the veil: it reaches its next beat as the cloud covers the screen, not before', () => {
    for (const fps of [60, 10]) {
      const st = freshPace();
      const room = { left: 40 / 60 };
      drive(st, 3, fps, () => ({ waiting: true, roomSeconds: 0 }), room);               // waited 3 s
      const atCarry = room.left;
      const cover = 40 / 60;                                                            // the veil's full authored cover
      drive(st, cover, fps, (i) => ({ waiting: false, roomSeconds: 0, coverLeft: cover - i / fps }), room);
      expect(room.left, `${fps} fps`).toBeGreaterThan(0);                               // never past the beat while the screen is still clear
      expect(room.left, `${fps} fps`).toBeLessThan(atCarry * 0.5);                      // and caught up by the time it covers
      drive(st, 3, fps, () => ({ waiting: false, roomSeconds: 0, coverLeft: null }), { left: Infinity });
      expect(st.pace, `${fps} fps`).toBeCloseTo(1, 2);                                  // covered: back to full speed under the veil
    }
  });

  it('guards each step exactly: however long a frame, it never reaches the end of the room', () => {
    expect(guardStep(0.001, 1)).toBeCloseTo(0.001, 6);                                  // far from it: as asked
    expect(guardStep(10, 0.3)).toBeLessThan(0.3);
    expect(guardStep(0.1, 0)).toBe(0);
  });

  it('takes the room it may use from the next beat after luminous, else the end of its clips', () => {
    expect(waitLimitFrame(TL, [420, 520])).toBe(420);              // the end of the invite clip (420) comes first
    expect(waitLimitFrame(TL, [600])).toBe(440);                   // else the swap (440), before dissipate (460)
    const noSwap = parseTimeline({ ...RAW, swapFrame: undefined })!;
    expect(waitLimitFrame(noSwap, [600])).toBe(460);               // else dissipate
    const bare = parseTimeline({ fps: 60, markers: { glow: 100, luminous: 200 } })!;
    expect(waitLimitFrame(bare, [600])).toBe(600);
    expect(waitLimitFrame(bare, [150])).toBe(200);                 // nothing after luminous: no room at all
  });
});

describe('the two clouds', () => {
  it('keeps the held cloud exactly as authored and draws the magic cloud over it, depth-tested but not writing depth', () => {
    const held = heldCloudLook(new MeshStandardMaterial({ color: '#ffffff' }));
    expect(held.transparent).toBe(false);                          // opaque, as authored: never thinned
    expect(held.opacity).toBe(1);
    expect(held.depthWrite).toBe(true);
    expect(held.colorWrite).toBe(true);
    expect(held.emissive.getHexString()).toBe('96ebfb');           // the glow colour, dark until ctl_glow
    expect(held.emissiveIntensity).toBe(0);
    const magic = magicCloudLook(new MeshStandardMaterial());
    expect(magic.transparent).toBe(true);
    expect(magic.depthWrite).toBe(false);
    expect(magic.depthTest).toBe(true);                            // hidden behind him and the held cloud where it is behind them
    expect(magic.polygonOffset).toBe(true);
    expect(magic.polygonOffsetFactor).toBeLessThan(0);             // wins where it starts on the held cloud's surface
    expect(HELD_ORDER).toBeLessThan(CLOUD_ORDER);                  // drawn after him, the magic cloud after the held one
  });

  it("writes the magic cloud's own depth just before it, so only its nearest surface shows at any opacity", () => {
    const magic = magicCloudLook(new MeshStandardMaterial({ side: DoubleSide }));
    const depth = magicCloudDepthLook(magic);
    expect(depth.colorWrite).toBe(false);                          // depth only: it never paints
    expect(depth.depthWrite).toBe(true);
    expect(depth.transparent).toBe(false);                         // drawn with the opaque things, before the magic cloud
    expect(depth.side).toBe(DoubleSide);                           // the nearest of either side, as the cloud is drawn
    expect(depth.polygonOffset).toBe(true);                        // exactly where the visible surface is drawn
    expect(depth.polygonOffsetFactor).toBe(magic.polygonOffsetFactor);
    expect(depth.polygonOffsetUnits).toBe(magic.polygonOffsetUnits);
    expect(magic.depthFunc).toBe(LessEqualDepth);                  // so the visible surface passes where its depth was written
    expect(HELD_ORDER).toBeLessThan(CLOUD_DEPTH_ORDER);            // after the held cloud: it never hides it
    expect(CLOUD_DEPTH_ORDER).toBeLessThan(CLOUD_ORDER);
    const stage = readFileSync(new URL('../src/invitation/InvitationStage.tsx', import.meta.url), 'utf8');
    expect(stage).toMatch(/const depth = magic\.map\(depthCopy\)/);
    expect(stage).toMatch(/copy\.morphTargetInfluences = m\.morphTargetInfluences/);   // moves exactly with it
  });

  it('never hides the held cloud in code: a depth-only held cloud would punch holes in the magic cloud', () => {
    const stage = readFileSync(new URL('../src/invitation/InvitationStage.tsx', import.meta.url), 'utf8');
    expect(stage).not.toMatch(/colorWrite\s*=\s*false/);
    expect(stage).toMatch(/own\(m, heldCloudLook, heldCloud\)/);
    expect(stage).toMatch(/own\(m, magicCloudLook, cloudMats\)/);
  });
});

describe('framing the take', () => {
  // the site's camera: FOV 30 at z 10, looking down -z
  const camera = (aspect: number) => {
    const c = new PerspectiveCamera(30, aspect, 0.1, 60);
    c.position.set(0, 0, 10);
    c.updateMatrixWorld();
    c.updateProjectionMatrix();
    return c;
  };
  // flat boxes at z = 0, where the stage is framed
  const at = (x: number, y = 0, size = 1) => new Box3().setFromCenterAndSize(new Vector3(x, y, 0), new Vector3(size, size, 0));
  const halfWidth = (aspect: number) => 10 * Math.tan((15 * Math.PI) / 180) * aspect;   // visible half-width at z = 0

  it('knows when his first frame is fully off-screen, on desktop and on a portrait phone', () => {
    for (const aspect of [16 / 9, 390 / 844]) {
      const c = camera(aspect);
      const edge = halfWidth(aspect);
      expect(boxShows(at(0), c)).toBe(true);
      expect(boxShows(at(edge + 0.4), c)).toBe(true);            // half in: the take must fade in
      expect(boxShows(at(edge + 0.6), c)).toBe(false);           // fully off to the right
      expect(boxShows(at(-edge - 0.6), c)).toBe(false);
    }
    // a narrow screen shows less to the side, so a start that is off-screen on a phone can still
    // show on a wide desktop (hence startTake checks at the actual aspect and fades in if needed)
    const start = at(halfWidth(16 / 9) + 0.6);
    expect(boxShows(start, camera(16 / 9))).toBe(false);
    expect(boxShows(start, camera(390 / 844))).toBe(false);
    expect(boxShows(at(halfWidth(390 / 844) + 0.2), camera(16 / 9))).toBe(true);
  });

  it('treats an empty box or one behind the camera as not showing', () => {
    expect(boxShows(new Box3(), camera(1))).toBe(false);
    expect(boxShows(new Box3().setFromCenterAndSize(new Vector3(0, 0, 20), new Vector3(1, 1, 1)), camera(1))).toBe(false);
  });
});
