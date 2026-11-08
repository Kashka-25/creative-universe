// Decides which introduction a device gets:
//   full  the real-time 3D guide
//   lite  the illustrated 2D welcome (no WebGL, reduced motion, data saver, low-end device)
//   off   straight into the portfolio
// Override for testing with ?intro=full | lite | off

export type IntroMode = 'full' | 'lite' | 'off';

export interface Capability { mode: IntroMode; reason: string }

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function detectCapability(search = window.location.search): Capability {
  const forced = new URLSearchParams(search).get('intro');
  if (forced === 'full' || forced === 'lite' || forced === 'off') return { mode: forced, reason: 'forced by ?intro' };

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return { mode: 'lite', reason: 'reduced motion' };
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return { mode: 'lite', reason: 'data saver' };
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 2) return { mode: 'lite', reason: 'low memory' };
  if (!webglAvailable()) return { mode: 'lite', reason: 'no WebGL' };
  return { mode: 'full', reason: 'capable' };
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
