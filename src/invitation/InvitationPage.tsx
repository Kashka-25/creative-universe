// The invitation: its own page (#/invitation), outside the portfolio's Layout.
//
// Young Coco's Blender take plays once; the cloud he offers grows, engulfs him and carries the
// visitor home under the cloud veil, where Adult Coco sits meditating. "Come on in" is always
// there: during the take it jumps straight to the glow, so the transformation and the trip home
// start at once. Escape goes home at once. The realms stay one click away in the header, and the
// cloud never covers the header while the visitor is using it: the trip home waits for them.
//
// Visible words are Cassidy's own: the heading and the button. Everything else is narration of
// what is on screen, for screen readers.

import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { asset } from '../content';
import { detectCapability, introAlreadySeen, markIntroSeen, type IntroMode } from '../intro/capability';
import { createPausableScheduler, type Machine, type PausableScheduler } from '../intro/machine';
import { Header, SkipLink } from '../portfolio/Layout';
import { welcomeNavigate } from '../portfolio/transitions';
import { useDocumentTitle } from '../portfolio/useDocumentTitle';
import { SceneBoundary } from '../scene/SceneBoundary';
import { INVITATION } from '../guide/paths';
import { prefetchAdult } from '../guide/prefetch';
import { veil } from '../veil/veil';
import { forcedIntro, invitationStart } from './entry';
import { IllustratedInvitation } from './IllustratedInvitation';
import { takePosterFocus } from './InvitationPoster';
import {
  createInvitationMachine, createNarrator, HEADING_MARKERS, invitationVisual, NARRATION, TAKE_RUNS, type InvitationEvent, type InvitationState,
  type Visual,
} from './invitationMachine';
import { createHeaderWatch, createWaitWatch, usingHeader } from './headerHold';
import { firstFrameOf, readTimeline, timingFrom, veilSecondsFrom, type MarkerName, type Timeline } from './timeline';
import { ENTER, HEADING } from './words';

const InvitationStage = lazy(() => import('./InvitationStage'));

/** How long the take waits, once warm, for the cloud veil to finish getting ready (its matte, its shader). */
const VEIL_PREP_MS = 1000;

/**
 * Downloads a file into the HTTP cache, reading the whole body (an unread body stalls and is not
 * cached in full). Errors are ignored: the real loader reports them.
 */
function warmFetch(url: string, signal?: AbortSignal) {
  fetch(url, { signal }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => undefined);
}

export default function InvitationPage() {
  useDocumentTitle(HEADING);
  const location = useLocation();
  const replay = (location.state as { replay?: boolean } | null)?.replay === true;
  // decided once, when the page opens: a reload (the seen flag is set at the start) goes home
  const [start] = useState(() => invitationStart({ seen: introAlreadySeen(), replay, forced: forcedIntro(window.location.search) }));
  // the device probe only when it will play (going straight home needs none)
  const [mode] = useState<IntroMode>(() => (start === 'play' ? detectCapability().mode : 'off'));
  if (start === 'home' || mode === 'off') return <Navigate to="/" replace />;
  return <Invitation mode={mode} />;
}

export type Focus = { x: number; y: number };

function Invitation({ mode }: { mode: 'full' | 'lite' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<InvitationState>('boot');
  const [marker, setMarker] = useState<MarkerName | null>(null);
  const [narration, setNarration] = useState('');
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [jump, setJump] = useState(0);
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [failed, setFailed] = useState(false);
  const stageEl = useRef<HTMLDivElement>(null);
  const machine = useRef<Machine<InvitationState, InvitationEvent> | null>(null);
  const scheduler = useRef<PausableScheduler | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const narrator = useRef<ReturnType<typeof createNarrator> | null>(null);
  /** The visitor in the header (a mouse busy there, their last touch of it), from the moment the page opens. */
  const header = useRef<ReturnType<typeof createHeaderWatch> | null>(null);
  /** Whether the visitor is using the header (an open menu, keyboard focus in it, a mouse busy there). */
  const headerBusy = useCallback(() => usingHeader(document) || header.current?.pointerBusy() === true, []);
  const modelsReady = useRef(false);
  const focus = useRef<Focus>({ x: 0.5, y: 0.5 });
  /** Where the cloud is on screen now (set by the stage), for a trip the safety net starts early. */
  const focusProbe = useRef<(() => Focus) | null>(null);
  /** The page's own downloads of the take's models (into the HTTP cache). */
  const warming = useRef<AbortController | null>(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // what was on screen before 'done', kept in 'done' so the way home crossfades from it (the
  // view transition's snapshot is taken after this render)
  const shown = useRef<Visual>('live');

  const send = useCallback((e: InvitationEvent) => { machine.current?.send(e); }, []);

  // It starts now: mark it seen (a reload never replays it), and forget the replay request.
  // Keyboard focus the visitor had already put on the static poster's copy of a control (while
  // this code was loading) moves to the same control here; otherwise, reached from inside the site
  // (Replay the welcome), the new page takes focus.
  useEffect(() => {
    markIntroSeen();
    window.scrollTo({ top: 0 });
    const was = takePosterFocus();
    const lost = !document.activeElement || document.activeElement === document.body;
    const again = was && lost ? document.querySelector<HTMLElement>(`.invitation ${was}`) ?? document.querySelector<HTMLElement>(was) : null;
    if (again) again.focus({ preventScroll: true });
    else if (location.key !== 'default') document.getElementById('main')?.focus({ preventScroll: true });
    if (location.state) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The take's models start downloading now, alongside the 3D code (into the HTTP cache; the
  // loader then reads them from there). Stopped once the loader has them, as soon as the take is
  // given up (the illustrated invitation needs none of it), or if the visitor leaves first.
  useEffect(() => {
    if (mode !== 'full') return;
    const ctl = new AbortController();
    warming.current = ctl;
    for (const url of [INVITATION.young, INVITATION.cloud]) warmFetch(asset(url), ctl.signal);
    return () => { ctl.abort(); warming.current = null; };
  }, [mode]);

  // Who is in the header, watched from the start (a mouse there, the last touch of it).
  useEffect(() => {
    const w = createHeaderWatch({
      target: document,
      inHeader: (e) => !!(e.target as Element | null)?.closest?.('.site-header'),
      canHover: () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches,
    });
    header.current = w;
    return () => { w.stop(); header.current = null; };
  }, []);

  // The machine: created here and stopped on the way out (StrictMode-safe). Its safety timers
  // pause with the tab.
  useEffect(() => {
    const sched = createPausableScheduler();
    if (document.hidden) sched.pause();
    const timing = () => {
      const t = timelineRef.current;
      return t ? timingFrom(t, veil.plannedCoverSeconds(veilSecondsFrom(t).cover)) : null;
    };
    // the trip home waits while the visitor is using the header (an open menu, keyboard focus in
    // it, a mouse busy in it), unless they have pressed "Come on in" (the machine remembers)
    const m = createInvitationMachine(timing, sched.schedule, headerBusy);
    machine.current = m;
    scheduler.current = sched;
    let prefetched = false;

    const unsub = m.subscribe((s, t) => {
      setState(s);
      // the page's own downloads stop: the loader has the models now, or they are not needed any more
      if (s === 'warming' || s === 'illustrated') warming.current?.abort();
      // the take is moving: the veil does nothing heavy from now on (a late matte waits)
      if (TAKE_RUNS.includes(s)) veil.prepared();
      if (s === 'take' && !prefetched) {
        prefetched = true;
        // home's guide, into the HTTP cache while the take plays, so he is there at once. The
        // download starts now (it costs the main thread nothing, and an early "Come on in" leaves
        // little time); only his code, which must be parsed, waits for an idle moment. If home
        // later gives up on him, it stops this download too (guide/prefetch.ts).
        prefetchAdult();
        const prefetch = () => { import('../guide/HomeStage').catch(() => undefined); };
        if ('requestIdleCallback' in window) window.requestIdleCallback(prefetch, { timeout: 2000 });
        else setTimeout(prefetch, 1000);
      }
      // "Come on in", or the safety net if the clock has fallen behind: the clock eases on to the
      // glow, so the take and the machine stay together
      if (s === 'transforming' && (t?.event.type === 'COME_IN' || t?.event.type === 'after')) {
        narrator.current?.skip();      // lines held back for the beats it leaves behind are never spoken late
        setJump((j) => j + 1);
      }
      // the trip waits for the visitor: a line held back to be spoken with the trip is spoken now,
      // while it is still true (the page is not inert while it waits); the veil then says only the trip
      if (s === 'waiting') {
        const held = narrator.current?.flush() ?? '';
        if (held) startTransition(() => setNarration(held));
      }
      if (s === 'carrying') {
        // reached by the safety net before the clock passed 'luminous', or after waiting for the
        // visitor (the cloud has drifted on a little): where the cloud is now
        if (t?.event.type === 'after' || t?.from === 'waiting') focus.current = focusProbe.current?.() ?? focus.current;
        const tl = timelineRef.current;
        const secs = tl ? veilSecondsFrom(tl) : { cover: null, reveal: null };
        // a line held back because the trip followed it closely is spoken with the trip, by the veil
        const lead = narrator.current?.flush() ?? '';
        const announce = lead ? `${lead} ${NARRATION.luminous}` : NARRATION.luminous;
        veil.cover({ origin: focus.current, coverSeconds: secs.cover, revealSeconds: secs.reveal, announce })
          // cleared before it covered (Escape): home at once, as for Escape
          .then((covered) => m.send({ type: covered ? 'COVERED' : 'ESCAPE' }));
      }
      // the 3D take is over without a trip: the veil's context is not needed
      if (s === 'illustrated') veil.release();
      if (s === 'done') {
        const viaVeil = t?.event.type === 'COVERED' || (t?.event.type === 'after' && t.from === 'carrying');
        // A crossfade whenever part of the page is still in view: with no cloud on screen, and for
        // Escape while the cloud is still closing in (the uncovered part would otherwise cut to
        // home in one frame; the veil is its own live group in the transition, so only the brief
        // update step holds it). Under a full cover the change is unseen: no transition.
        const crossfade = !viaVeil && (veil.phase === 'idle' || veil.phase === 'covering');
        if (!viaVeil && veil.phase !== 'idle') veil.reveal();   // Escape: no veil
        if (veil.phase === 'idle') veil.release();               // home without a trip
        const opts = { replace: true, state: { from: 'invitation' } };
        if (crossfade) welcomeNavigate(navigateRef.current, '/', opts);
        else void navigateRef.current('/', opts);
      }
    });
    m.send({ type: mode === 'full' ? 'START' : 'LITE' });
    return () => {
      unsub();
      m.stop();
      machine.current = null;
      scheduler.current = null;
      // left another way (a realm in the header, Back): no trip is coming
      if (veil.phase === 'idle') veil.release();
    };
  }, [mode]);

  // The take's timing, authored in Blender.
  useEffect(() => {
    if (mode !== 'full') return;
    let cancelled = false;
    readTimeline(asset(INVITATION.timeline)).then(({ timeline: t, problem }) => {
      if (cancelled) return;
      if (!t) {
        console.warn(problem === 'rejected'
          ? '[invitation] timeline.json lacks the glow or luminous marker, or has them out of order: showing the illustrated invitation'
          : '[invitation] no timeline.json: showing the illustrated invitation');
        send({ type: 'LOAD_FAILED' });
        return;
      }
      if (t.dropped.length) console.warn(`[invitation] timeline.json: left out markers that are out of place: ${t.dropped.join(', ')}`);
      timelineRef.current = t;
      narrator.current = createNarrator(t);
      setTimeline(t);
      // the take can play: the veil gets its shader and matte ready while nothing moves yet (not
      // before: a visit that ends in the illustrated invitation never builds any of it)
      if (machine.current?.state === 'loading') veil.prepare();
      if (modelsReady.current) send({ type: 'LOADED' });
    });
    return () => { cancelled = true; };
  }, [mode, send]);

  // A hidden tab holds everything where it is: the clock, the safety timers.
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.hidden;
      setPaused(hidden);
      if (hidden) scheduler.current?.pause(); else scheduler.current?.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Waiting for a visitor who is using the header: the trip carries on once they have finished with
  // it (menu closed, focus elsewhere, the mouse gone) and it has stayed that way for a moment, or
  // once the header has been left untouched for WAIT_IDLE_MS (a menu left open). Every touch of the
  // header starts that time again (see createWaitWatch).
  useEffect(() => {
    if (state !== 'waiting') return;
    const watch = createWaitWatch();
    const id = window.setInterval(() => {
      const verdict = watch({
        now: performance.now(),
        hidden: document.hidden,
        busy: usingHeader(document) || header.current?.pointerBusy() === true,
        activityAt: header.current?.lastActivity() ?? -Infinity,
      });
      if (verdict === 'free') send({ type: 'FREE' });
      else if (verdict === 'give-up') send({ type: 'GIVE_UP' });
    }, 100);
    return () => window.clearInterval(id);
  }, [state, send]);

  // Escape: home at once (the open menu closes first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.site-nav.is-open')) return;
      send({ type: 'ESCAPE' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  const onLoaded = useCallback(() => {
    modelsReady.current = true;
    if (timelineRef.current) send({ type: 'LOADED' });
  }, [send]);
  // warm: the take may start once the veil is ready too (briefly; it never holds the take for long)
  const onWarm = useCallback(() => {
    veil.whenPrepared(VEIL_PREP_MS).then(() => send({ type: 'WARM' }));
  }, [send]);
  const onMarker = useCallback((name: MarkerName, at?: Focus) => {
    if (at) focus.current = at;
    // the heading and the narration are not urgent: they never share a frame with the take. The
    // trip home is announced by the veil instead (the page goes inert under it).
    // Beats Blender puts close together are spoken as one line (see createNarrator).
    const line = narrator.current?.(name) ?? null;
    startTransition(() => {
      setMarker(name);
      if (line) setNarration(line);
    });
    send({ type: 'MARKER', name });
  }, [send]);
  const onFail = useCallback(() => {
    setFailed(true);
    warming.current?.abort();
    send({ type: 'LOAD_FAILED' });
  }, [send]);

  // In 'done' the page keeps whatever it was showing until the route changes, so the way home
  // crossfades from it instead of from an empty stage.
  const { visual, live3D } = invitationVisual(state, mode === 'lite' || failed || state === 'illustrated', shown.current);
  shown.current = visual;
  const illustrated = visual === 'illustrated';
  // by frame: Blender decides the order of the beats
  const headingShown = illustrated
    || (marker !== null && timeline !== null && (timeline.markers[marker] ?? -Infinity) >= firstFrameOf(timeline, HEADING_MARKERS))
    || state === 'transforming' || state === 'waiting' || state === 'carrying' || state === 'done';

  return (
    <div className={`invitation is-${state}`}>
      <SkipLink />
      {/* leaving by the header replaces the invitation in history, like every other way out (Back never bounces) */}
      <Header replace crossfade />
      <main id="main" tabIndex={-1} className="invitation__main">
        <h1 className={`invitation__title${headingShown ? ' is-shown' : ''}`}>{HEADING}</h1>
        <div className="invitation__stage" ref={stageEl}>
          {illustrated && <IllustratedInvitation />}
        </div>
        <div className="invitation__actions">
          <button type="button" className="button button--primary invitation__enter" onClick={() => send({ type: 'COME_IN' })}>
            {ENTER}
          </button>
        </div>
        <p className="visually-hidden" aria-live="polite">{narration}</p>
      </main>
      {live3D && (
        <div className="invitation__layer" aria-hidden>
          <SceneBoundary onError={onFail} label="invitation">
            <Suspense fallback={null}>
              <InvitationStage
                phase={state}
                timeline={timeline}
                paused={paused}
                jump={jump}
                stageEl={stageEl}
                focusProbe={focusProbe}
                onLoaded={onLoaded}
                onWarm={onWarm}
                onMarker={onMarker}
                onFail={onFail}
              />
            </Suspense>
          </SceneBoundary>
        </div>
      )}
    </div>
  );
}
