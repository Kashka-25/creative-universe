// Coco, the visitor's companion. No story here: he sits in the home hero, meditating, and keeps the
// visitor company in the corner on every page. The welcome itself lives on its own page (#/invitation).
//
// Devices that should not run 3D (reduced motion, data saver, low memory, no WebGL) and any 3D
// failure get Cassidy's living painting in the hero instead, and so does a model that has not
// arrived in time; in the corner they get his still (PosterCompanion), if there is one. Nothing
// here ever blocks a click or stays over the page's content.

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { detectCapability, webglKnown, webglMissing, type IntroMode } from '../intro/capability';
import { forcedIntro } from '../invitation/entry';
import { SceneBoundary } from '../scene/SceneBoundary';
import { veil } from '../veil/veil';
import { PosterCompanion } from './PosterCompanion';
import { cancelAdultPrefetch } from './prefetch';

const HomeStage = lazy(() => import('./HomeStage'));

/** On a direct visit to a page other than home, the longest he waits for the page to be idle before loading. */
const IDLE_LOAD_MS = 2500;

/** How long (of time the page is actually drawing) he may take to appear before the painting stands in. */
const HOME_LOAD_MS = 10_000;

export interface GuideValue {
  mode: IntroMode;
  /** Coco is drawn in 3D (otherwise the living painting stands in the hero). */
  live3D: boolean;
  /** The 3D Coco is loaded and drawing. */
  ready: boolean;
  /** 3D failed (missing model, lost context, too slow): the painting stands in. */
  failed: boolean;
  /** He appeared under the cloud veil: the cloud clearing is his reveal, so nothing fades on its own. */
  instant: boolean;
}

const GuideContext = createContext<GuideValue>({ mode: 'lite', live3D: false, ready: false, failed: false, instant: false });
export const useGuide = () => useContext(GuideContext);

/** Arrived here from the invitation (router state { from: 'invitation' }). */
const cameFromInvitation = (state: unknown) => (state as { from?: string } | null)?.from === 'invitation';

export function GuideProvider({ children }: { children: ReactNode }) {
  // the cheap signals only: no throwaway WebGL context here (it can cost ~100 ms just as the page
  // becomes usable). His own canvas is the test: if it cannot get a context, SceneBoundary catches
  // it and the painting stands in. Only a browser with no WebGL at all (a free check), or one the
  // invitation has already probed and found wanting, skips him at once.
  const [mode] = useState<IntroMode>(() => detectCapability(window.location.search, { webgl: false }).mode);
  const [failed, setFailed] = useState(() => mode === 'full' && (webglMissing() || webglKnown() === false));
  /** The visitor asked for reduced motion while here: the painting, held still, stands in for the rest of the visit. */
  const [stilled, setStilled] = useState(false);
  const [ready, setReady] = useState(false);
  const [instant, setInstant] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [arriving] = useState(() => cameFromInvitation(location.state));
  const live3D = mode === 'full' && !failed && !stilled;
  // His layer is mounted at once on home (his hero is the first thing seen). Arriving directly on any
  // other page, it waits until that page has been drawn and is idle, so he never competes with it.
  // Once mounted he stays for the visit.
  const [placed, setPlaced] = useState(() => location.pathname === '/');
  const staged = live3D && placed;
  // giving up on him: his model is freed when his stage unmounts, and the invitation's early
  // download of it (if still running) stops now
  const fail = useCallback(() => { cancelAdultPrefetch(); setFailed(true); }, []);

  // Not mounted yet: once the page has loaded, after a paint, once it is idle (or IDLE_LOAD_MS at most), or at
  // once if the visitor goes home first.
  useEffect(() => {
    if (placed || !live3D) return;
    if (location.pathname === '/') { setPlaced(true); return; }
    // after the page has loaded (its own images and fonts first), or IDLE_LOAD_MS at most
    let idle = 0, raf = 0, started = false;
    const go = () => {
      if (started) return;
      started = true;
      raf = requestAnimationFrame(() => {
        idle = window.requestIdleCallback
          ? window.requestIdleCallback(() => setPlaced(true), { timeout: IDLE_LOAD_MS })
          : window.setTimeout(() => setPlaced(true), 600);
      });
    };
    const cap = window.setTimeout(go, IDLE_LOAD_MS);
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
    return () => {
      window.clearTimeout(cap);
      window.removeEventListener('load', go);
      cancelAnimationFrame(raf);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [placed, live3D, location.pathname]);

  // Arriving under the cloud veil (always on home, so he is mounted at once): the cloud waits for him
  // a little longer (bounded) from the moment home mounts, so the hold also covers his download and
  // parse, not only his warm-up. A failure clears it at once (veil.ready below).
  useEffect(() => {
    if (arriving && staged) veil.extendHold();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reduced motion turned on while here: he is stilled at once (the painting, held still, stands in),
  // not only on the next visit. (Not undone if it is turned off again: he would have to load afresh.)
  useEffect(() => {
    if (mode !== 'full' || forcedIntro(window.location.search)) return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq?.addEventListener) return;
    const onChange = () => { if (mq.matches) { cancelAdultPrefetch(); setStilled(true); } };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  // Arrived from the invitation: forget it, so a reload does not settle him again. With no cloud
  // veil to clear (Escape, the illustrated invitation), the page takes focus now.
  useEffect(() => {
    if (!cameFromInvitation(location.state)) return;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    if (veil.phase === 'idle') document.getElementById('main')?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The cloud veil (if one is up) clears as soon as he is drawing, or there is nothing to wait for.
  useEffect(() => {
    if (!staged || ready) veil.ready();
  }, [staged, ready]);

  // A model that never arrives (a stalled download) must not leave the hero empty: after
  // HOME_LOAD_MS of time in which the page is drawing, counted from when he is mounted, the painting
  // stands in. Only drawn frames count (a hidden or paused tab draws nothing, so he could not get
  // ready then either).
  useEffect(() => {
    if (!staged || ready) return;
    let raf = 0;
    let last = performance.now();
    let spent = 0;
    const tick = (now: number) => {
      spent += Math.min(Math.max(0, now - last), 100);
      last = now;
      if (spent >= HOME_LOAD_MS) {
        console.warn('[guide] Coco took too long to load; showing the painting');
        fail();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [staged, ready, fail]);

  const onReady = useCallback(() => {
    // under a covering cloud he appears at once: the cloud clearing is his reveal
    setInstant(veil.blocking);
    setReady(true);
  }, []);

  return (
    <GuideContext.Provider value={{ mode, live3D, ready, failed, instant }}>
      {staged && (
        <div className={`guide-layer${ready ? ' is-ready' : ''}${instant ? ' is-instant' : ''}`} aria-hidden>
          <SceneBoundary onError={fail} label="guide">
            <Suspense fallback={null}>
              <HomeStage arriving={arriving} onReady={onReady} onContextLost={fail} />
            </Suspense>
          </SceneBoundary>
        </div>
      )}
      {!live3D && mode !== 'off' && <PosterCompanion onHome={location.pathname === '/'} />}
      {children}
    </GuideContext.Provider>
  );
}
