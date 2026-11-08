// Owns the intro: decides whether it plays, runs the state machine, hosts the
// persistent 3D layer and the on-screen controls, and tells the portfolio
// when it may take over.

import {
  Component, createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { createIntroMachine, beats, INTRO_STATES, type IntroEvent, type IntroState } from './introMachine';
import { detectCapability, introAlreadySeen, markIntroSeen, type IntroMode } from './capability';
import { stage } from '../scene/stage';
import { LiteIntro } from './LiteIntro';

const GuideStage = lazy(() => import('../scene/GuideStage'));

interface IntroContextValue {
  state: IntroState;
  mode: IntroMode;
  /** The 3D guide is loaded and drawing. */
  guideReady: boolean;
  /** 3D failed (no chunk, lost context): show the painting instead. */
  sceneFailed: boolean;
  /** The intro is covering the page. */
  covering: boolean;
  send: (e: IntroEvent) => void;
  replay: () => void;
}

const IntroContext = createContext<IntroContextValue | null>(null);
export const useIntro = () => useContext(IntroContext)!;

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn('[intro] 3D scene failed, using the illustrated intro.', error); this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function shouldPlay(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has('intro') && params.get('intro') !== 'off') return true;
  const route = window.location.hash.replace(/^#/, '') || '/';
  return route === '/' && !introAlreadySeen();
}

export function IntroProvider({ children }: { children: ReactNode }) {
  const [mode] = useState<IntroMode>(() => detectCapability().mode);
  const [machine, setMachine] = useState(() => createIntroMachine());
  const [state, setState] = useState<IntroState>(machine.state);
  const [guideReady, setGuideReady] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [stageActive, setStageActive] = useState(true);
  const controlsRef = useRef<HTMLDivElement>(null);
  const debug = useMemo(() => new URLSearchParams(window.location.search).has('debug'), []);

  const shouldPlayRef = useRef(shouldPlay());

  // Wire the machine to React and start it.
  useEffect(() => {
    const unsub = machine.subscribe((s) => setState(s));
    setState(machine.state);
    if (machine.state === 'boot') {
      if (!shouldPlayRef.current) machine.send({ type: 'PERCH' });
      else if (mode === 'full') machine.send({ type: 'FULL' });
      else if (mode === 'lite') machine.send({ type: 'LITE' });
      else machine.send({ type: 'PERCH' });
    }
    return () => { unsub(); };
  }, [machine, mode]);

  const send = useCallback((e: IntroEvent) => { machine.send(e); }, [machine]);
  const replay = useCallback(() => {
    machine.stop();
    shouldPlayRef.current = true;
    window.location.hash = '#/';
    window.scrollTo({ top: 0 });
    setMachine(createIntroMachine());
  }, [machine]);

  const covering = INTRO_STATES.includes(state);

  // Once revealed: remember it, and move focus into the page if it was on the intro controls.
  useEffect(() => {
    if (state === 'revealing' || state === 'done') {
      markIntroSeen();
      if (controlsRef.current?.contains(document.activeElement)) document.getElementById('main')?.focus();
    }
  }, [state]);

  // Visitor activity wakes him early; Escape skips.
  useEffect(() => {
    if (!covering) return;
    const wake = () => machine.send({ type: 'INTERACT' });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') machine.send({ type: 'SKIP' }); else wake(); };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', key);
    let moves = 0;
    const move = () => { if (++moves > 25) wake(); };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('wheel', wake);
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointermove', move);
    };
  }, [covering, machine]);

  // Lock page scroll while the intro covers it.
  useEffect(() => {
    document.documentElement.classList.toggle('intro-covering', covering);
  }, [covering]);

  // After the intro, only draw while the hero stage is on screen.
  useEffect(() => {
    if (covering || state === 'revealing') { setStageActive(true); return; }
    let io: IntersectionObserver | null = null;
    const watch = () => {
      io?.disconnect();
      if (!stage.el) { setStageActive(false); return; }
      io = new IntersectionObserver(([entry]) => setStageActive(entry.isIntersecting), { rootMargin: '80px' });
      io.observe(stage.el);
    };
    watch();
    const unsub = stage.subscribe(watch);
    return () => { unsub(); io?.disconnect(); };
  }, [covering, state]);

  const fail = useCallback(() => {
    setSceneFailed(true);
    machine.send({ type: machine.state === 'loading' || machine.state === 'boot' ? 'LOAD_FAILED' : 'SKIP' });
  }, [machine]);

  const onReady = useCallback(() => {
    setGuideReady(true);
    machine.send({ type: 'READY' });
  }, [machine]);

  const use3D = mode === 'full' && !sceneFailed;
  const beat = beats[state];
  const value: IntroContextValue = { state, mode, guideReady, sceneFailed, covering, send, replay };

  return (
    <IntroContext.Provider value={value}>
      {use3D && (
        <div className={`stage-layer is-${covering ? 'intro' : state === 'revealing' ? 'revealing' : 'perch'} ${stageActive ? '' : 'is-idle'}`}>
          <div className="stage-sky" aria-hidden />
          <SceneBoundary onError={fail}>
            <Suspense fallback={null}>
              <GuideStage state={state} send={send} onReady={onReady} onContextLost={fail} active={stageActive} />
            </Suspense>
          </SceneBoundary>
        </div>
      )}

      {(state === 'lite' || state === 'liteFlight' || (state === 'revealing' && !use3D)) && (
        <LiteIntro state={state} send={send} />
      )}

      {covering && (
        <div className="intro-controls" ref={controlsRef}>
          <button type="button" className="intro-skip" onClick={() => send({ type: 'SKIP' })}>
            Skip intro <span aria-hidden>→</span>
          </button>
          {(state === 'loading' || state === 'boot') && use3D && (
            <p className="intro-loading" role="status">
              <span className="intro-loading__sun" aria-hidden /> Waking the world…
            </p>
          )}
          {state === 'beckoning' && (
            <button type="button" className="intro-follow" onClick={() => send({ type: 'FOLLOW' })}>
              Follow him
            </button>
          )}
          <p className="visually-hidden" aria-live="polite">{beat?.narration ?? ''}</p>
        </div>
      )}

      {debug && (
        <div className="intro-debug">
          <strong>{state}</strong> · {mode}{sceneFailed ? ' (3D failed)' : ''}
          <div>
            {(['INTERACT', 'FOLLOW', 'SKIP'] as const).map((t) => <button key={t} type="button" onClick={() => send({ type: t })}>{t}</button>)}
            <button type="button" onClick={replay}>replay</button>
          </div>
        </div>
      )}

      {children}
    </IntroContext.Provider>
  );
}
