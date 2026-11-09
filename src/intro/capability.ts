// Decides which introduction a device gets:
//   full  the real-time 3D guide
//   lite  the illustrated 2D welcome (no WebGL, reduced motion, data saver, low-end device)
//   off   straight into the portfolio
// Override for testing with ?intro=full | lite | off

export type IntroMode = 'full' | 'lite' | 'off';

export interface Capability { mode: IntroMode; reason: string }

/** The WebGL probe (a throwaway context costs ~100 ms on some machines), made once per page load. */
let webgl: boolean | undefined;

export function webglAvailable(): boolean {
  if (webgl !== undefined) return webgl;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return (webgl = false);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return (webgl = true);
  } catch {
    return (webgl = false);
  }
}

/**
 * `webgl: false` decides from the cheap signals only and assumes WebGL (the caller probes it later,
 * after the first paint, or lets a failing canvas fall back): the probe never delays a first paint.
 */
export function detectCapability(search = window.location.search, opts: { webgl?: boolean } = {}): Capability {
  const forced = new URLSearchParams(search).get('intro');
  if (forced === 'full' || forced === 'lite' || forced === 'off') return { mode: forced, reason: 'forced by ?intro' };

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return { mode: 'lite', reason: 'reduced motion' };
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return { mode: 'lite', reason: 'data saver' };
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 2) return { mode: 'lite', reason: 'low memory' };
  if (opts.webgl !== false && !webglAvailable()) return { mode: 'lite', reason: 'no WebGL' };
  return { mode: 'full', reason: 'capable' };
}

/** The probe's result if it has already run (the invitation runs it), without running it. */
export const webglKnown = (): boolean | undefined => webgl;

/** No WebGL at all in this browser (a free check: no context is made). */
export const webglMissing = () => typeof window !== 'undefined' && typeof window.WebGLRenderingContext === 'undefined';

/** The most device pixels a full-window 3D canvas may have (multisampled colour and depth, redrawn every frame). */
export const PIXEL_BUDGET = { high: 4.2e6, low: 2.5e6 } as const;

/**
 * The resolution a 3D stage renders at, decided ONCE before anything is shown and never changed
 * while he is on screen (a change of resolution shows as a pop). Capped below the screen's own
 * density: 1.75 on capable devices, 1.5 on phones and small or modest machines; and, given the
 * canvas's size in CSS px (`cssPixels`, measured once), kept within PIXEL_BUDGET. Never below 1.
 */
export function stageDpr(tier: 'high' | 'low', devicePixelRatio: number, cssPixels?: number): number {
  const cap = tier === 'low' ? 1.5 : 1.75;
  const dpr = Math.max(1, Math.min(cap, devicePixelRatio || 1));
  if (!(cssPixels && cssPixels > 0)) return dpr;
  return Math.max(1, Math.min(dpr, Math.sqrt(PIXEL_BUDGET[tier] / cssPixels)));
}

/** Lower render cost on phones and small screens. */
export function qualityTier(): 'high' | 'low' {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = navigator.hardwareConcurrency ?? 4;
  return coarse || small || cores <= 4 ? 'low' : 'high';
}

// When the intro plays: 'every-visit' | 'once-per-session' | 'once'
const POLICY: 'every-visit' | 'once-per-session' | 'once' = 'once-per-session';
const KEY = 'ccu:intro-seen';

function store(kind: 'session' | 'local'): Storage | null {
  try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; }
}

export function introAlreadySeen(): boolean {
  if (POLICY === 'every-visit') return false;
  try { return !!store(POLICY === 'once' ? 'local' : 'session')?.getItem(KEY); } catch { return false; }
}

export function markIntroSeen() {
  try { store(POLICY === 'once' ? 'local' : 'session')?.setItem(KEY, String(Date.now())); } catch { /* private mode */ }
}

/**
 * Whether the "seen" flag can be stored at all. Without storage the welcome could not remember
 * it has played, so first-visit redirects are skipped (they would repeat on every reload).
 */
export function introStorageAvailable(): boolean {
  if (POLICY === 'every-visit') return true;
  try {
    const s = store(POLICY === 'once' ? 'local' : 'session');
    if (!s) return false;
    const probe = `${KEY}:probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** True when the visitor (or the OS) asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
