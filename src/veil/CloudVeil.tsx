// The cloud that carries the visitor home. Mounted ABOVE the router, so it stays on screen while the
// page changes underneath: the invitation's cloud swells to fill the screen, the home page takes its
// place, and the cloud clears to reveal Coco meditating there.
//
// Drawn with one small WebGL shader: each pixel of the Blender-rendered matte (veil-matte.webp) holds
// when the cloud reaches it; the authored curve (veil.json, made for that matte) says how far it has
// reached. Without the matte, a soft radial bloom in the same colours on an eased curve. No hard
// edges either way. Every phase ends on a timer (see veil.ts), and it never takes clicks once it is
// clearing.
//
// Smoothness: the WebGL context, the shader and the matte texture are all made while the
// invitation is loading and warming up (veil.prepare()), while nothing moves on screen. The veil
// stays laid out (invisible) while idle, so its one warm-up frame is drawn at full size and the
// cover's first frame allocates nothing. The matte is decoded off the main thread and uploaded as
// plain RGBA (no conversion), and only inside that window: a matte that arrives once the take is
// moving waits for the next trip, and this trip uses the bloom. The context is released after each
// trip, and when the visitor leaves without one (veil.release()). While the cloud blocks the
// pointer, the page beneath is inert (no keyboard focus behind the cloud either).

import { useEffect, useRef, useState } from 'react';
import { asset } from '../content';
import { INVITATION } from '../guide/paths';
import { loadJson } from '../invitation/timeline';
import { parseVeilCurve } from './curve';
import { veil, type VeilPhase } from './veil';

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// (the precision line is added per device: highp wherever the GPU has it, so the noise survives)
const FRAG = `
varying vec2 vUv;
uniform sampler2D uMatte;
uniform float uHasMatte;
uniform float uCoverage;
uniform vec2 uOrigin;
uniform vec2 uAspect;      // screen width / height, and the matte's
uniform float uTime;       // seconds since this trip began, on the veil's clock (it holds while the tab is hidden)
uniform float uAlpha;      // overall opacity: 1, except while an authored cover that starts part-way eases in
const float SOFT = 0.08;
const vec3 TURQUOISE = vec3(0.102, 0.737, 0.855);   // #1abcda
const vec3 MID = vec3(0.588, 0.922, 0.984);         // #96ebfb
const vec3 WHITE = vec3(0.937, 1.0, 1.0);           // #efffff

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);                  // 0..1 from the top left
  float sa = uAspect.x, ma = uAspect.y;
  float arrival;
  if (uHasMatte > 0.5) {
    // the matte covers the screen like object-fit: cover
    vec2 scale = sa > ma ? vec2(1.0, ma / sa) : vec2(sa / ma, 1.0);
    arrival = texture2D(uMatte, (uv - 0.5) * scale + 0.5).r;
  } else {
    vec2 d = (uv - uOrigin) * vec2(sa, 1.0);
    vec2 far = max(uOrigin, 1.0 - uOrigin) * vec2(sa, 1.0);
    arrival = length(d) / length(far);
    arrival = clamp(arrival + (fbm(uv * 3.0 + uTime * 0.05) - 0.5) * 0.18, 0.0, 1.0);
  }
  float reach = uCoverage * (1.0 + 2.0 * SOFT) - SOFT;
  float a = smoothstep(arrival - SOFT, arrival + SOFT, reach);
  float depth = clamp((reach - arrival) / 0.35, 0.0, 1.0);
  vec3 col = mix(TURQUOISE, MID, smoothstep(0.0, 0.5, depth));
  col = mix(col, WHITE, smoothstep(0.35, 1.0, depth));
  col = mix(col, WHITE, a * (1.0 - a) * 2.0);                        // a luminous rim
  col += (fbm(uv * 5.0 - uTime * 0.04) - 0.5) * 0.06 * (1.0 - depth); // soft billows
  col = mix(col, WHITE, smoothstep(0.85, 1.0, uCoverage) * 0.6);      // fully luminous when it covers
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * a, a) * uAlpha;
}`;

type MatteImage = ImageBitmap | HTMLImageElement;

interface Renderer {
  /** The shader has finished compiling (asking never blocks). */
  ready(): boolean;
  draw(coverage: number, origin: { x: number; y: number }, time: number, useMatte: boolean, alpha?: number): void;
  setMatte(img: MatteImage): void;
  readonly hasMatte: boolean;
  dispose(): void;
}

interface ParallelCompile { COMPLETION_STATUS_KHR: number }

/**
 * The veil's resolution, in buffer pixels per CSS pixel. It is a soft, slow, low-frequency cloud,
 * so a lower resolution scaled up by the browser looks the same and costs a fraction of the GPU
 * time on a dense phone screen, at the very moment two other canvases are drawing beneath it.
 */
const VEIL_DPR = 0.75;

/** A full-screen canvas in `host` with the veil's shader. Compiling starts now; nothing blocks until the first draw. */
function createRenderer(host: HTMLElement): Renderer | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'cloud-veil__canvas';
  host.appendChild(canvas);
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) { canvas.remove(); return null; }
  // A context lost mid-trip (a phone reclaiming GPU memory while the visitor switches apps) draws
  // nothing and says nothing: draw() then throws, and the plain bloom takes over for the trip.
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  const parallel = gl.getExtension('KHR_parallel_shader_compile') as ParallelCompile | null;
  const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const precision = high && high.precision > 0 ? 'highp' : 'mediump';
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, `precision ${precision} float;\n${FRAG}`);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.flush();                      // hand the work to the GPU now, so it compiles while nothing is drawn
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const tex = gl.createTexture();
  type Uniforms = Record<'matte' | 'has' | 'cov' | 'origin' | 'aspect' | 'time' | 'alpha', WebGLUniformLocation | null>;
  let loc: Uniforms | null = null;
  let matteAspect = 1;
  let hasMatte = false;

  // The program's first use: status checks and lookups, which cost nothing once compiling is done.
  const finish = (): Uniforms => {
    if (loc) return loc;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || 'veil shader');
    }
    gl.useProgram(program);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(program, n);
    loc = {
      matte: u('uMatte'), has: u('uHasMatte'), cov: u('uCoverage'), origin: u('uOrigin'), aspect: u('uAspect'), time: u('uTime'),
      alpha: u('uAlpha'),
    };
    return loc;
  };

  // the canvas's CSS size, or the window's if it has none yet: the buffer is always full size
  const cssSize = () => ({
    w: canvas.clientWidth || window.innerWidth,
    h: canvas.clientHeight || window.innerHeight,
  });
  const resize = () => {
    const dpr = Math.min(VEIL_DPR, window.devicePixelRatio || 1);
    const { w: cw, h: ch } = cssSize();
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
  };

  return {
    ready: () => !parallel || gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR) === true,
    get hasMatte() { return hasMatte; },
    setMatte(img) {
      const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
      const h = 'naturalHeight' in img ? img.naturalHeight : img.height;
      matteAspect = w / Math.max(1, h);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      // RGBA as decoded (the shader reads .r): no repacking on the main thread
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      hasMatte = true;
    },
    draw(coverage, origin, time, useMatte, alpha = 1) {
      if (lost || gl.isContextLost()) throw new Error('the veil lost its WebGL context');
      const l = finish();
      resize();
      const { w, h } = cssSize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(l.matte, 0);
      gl.uniform1f(l.has, useMatte && hasMatte ? 1 : 0);
      gl.uniform1f(l.cov, coverage);
      gl.uniform2f(l.origin, origin.x, origin.y);
      gl.uniform2f(l.aspect, w / Math.max(1, h), matteAspect);
      gl.uniform1f(l.time, time);
      gl.uniform1f(l.alpha, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = 1;
      canvas.height = 1;
      canvas.remove();
    },
  };
}

/**
 * The matte file's bytes (kept: decoding again for a later trip needs no new download). Null if
 * there is none; 'stopped' if the download was stopped (no trip is coming), so it is tried again later.
 */
async function fetchMatte(url: string, signal: AbortSignal): Promise<Blob | null | 'stopped'> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 && !blob.type.startsWith('text/') ? blob : null;
  } catch {
    return signal.aborted ? 'stopped' : null;
  }
}

/** Decodes the matte off the main thread, exactly as stored (no premultiplying, no colour conversion). */
async function decodeMatte(blob: Blob): Promise<MatteImage> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const closeImage = (img: MatteImage | null) => { if (img && 'close' in img) img.close(); };

/** The page under the veil: everything the router renders (see main.tsx). */
const pageRoot = () => document.getElementById('page');

export function CloudVeil() {
  const [phase, setPhase] = useState<VeilPhase>(veil.phase);
  const [announcement, setAnnouncement] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const fallback = useRef<HTMLDivElement>(null);
  const renderer = useRef<Renderer | null | undefined>(undefined);   // undefined: not made yet; null: no WebGL
  const building = useRef(false);
  const matte = useRef<{ blob: Blob | null; image: MatteImage | null; loading: boolean; missing: boolean }>({
    blob: null, image: null, loading: false, missing: false,
  });
  const useMatte = useRef(false);
  const curveFetched = useRef(false);
  /** The veil's own downloads (its matte and curve): stopped when no trip is coming. */
  const downloads = useRef<AbortController | null>(null);
  const downloading = () => {
    if (!downloads.current || downloads.current.signal.aborted) downloads.current = new AbortController();
    return downloads.current.signal;
  };
  // the noise in the cloud (billows, rim) runs on one clock per trip, the veil's own: continuous
  // across its phases, and held (like the coverage) while the tab is hidden
  const tripStart = useRef(0);
  const [plain, setPlain] = useState(false);

  const dispose = () => {
    renderer.current?.dispose();
    if (renderer.current) renderer.current = undefined;
    building.current = false;
  };

  const fail = (e: unknown) => {
    console.warn('[veil] using the plain bloom', e);
    renderer.current?.dispose();
    renderer.current = null;
    building.current = false;
    veil.setMatte(false);
    setPlain(true);
  };

  /**
   * Inside the prepare window, once the shader has compiled and the matte has arrived (or is known to
   * be missing): upload the matte, draw one invisible full-size frame, and tell the invitation.
   * Outside the window nothing heavy happens; a late matte waits for the next trip.
   */
  const finishIfReady = () => {
    if (!veil.preparing || veil.phase !== 'idle' || building.current) return;
    const r = renderer.current;
    if (r !== null && matte.current.loading) return;             // the bloom (no WebGL) needs no matte
    if (r) {
      try {
        const img = matte.current.image;
        if (img && !r.hasMatte) {
          r.setMatte(img);
          closeImage(img);
          matte.current.image = null;
          veil.setMatte(true);
        }
        r.draw(0, veil.snapshot().origin, 0, r.hasMatte);
      } catch (e) { fail(e); }
    }
    veil.prepared();
  };

  /** The matte, decoded and waiting to be uploaded (fetched once; decoded again for a later trip). */
  const getMatte = () => {
    const m = matte.current;
    if (m.missing || m.loading || m.image || renderer.current === null || renderer.current?.hasMatte) return;
    m.loading = true;
    const signal = downloading();
    (async () => {
      if (!m.blob) {
        const got = await fetchMatte(asset(INVITATION.veilMatte), signal);
        if (got === 'stopped') {
          // no trip was coming; if one is being prepared again already, fetch afresh for it
          m.loading = false;
          if (veil.preparing) getMatte();
          return;
        }
        m.blob = got;
      }
      if (m.blob) {
        try { m.image = await decodeMatte(m.blob); } catch { m.blob = null; m.missing = true; }
      } else m.missing = true;
      m.loading = false;
      // decoded after the visitor left without a trip (release() has run): nothing will upload it,
      // so it is not kept decoded (its bytes stay for a later trip)
      if (m.image && !veil.preparing && renderer.current === undefined) {
        closeImage(m.image);
        m.image = null;
        return;
      }
      finishIfReady();
    })();
  };

  // Phase changes: the page beneath is inert while the cloud blocks it (from the cover's second
  // frame, so its first frame stays light). When a cover starts, the cloud's shape (matte or bloom)
  // is fixed for the trip. When it has cleared after a trip home, the page takes focus (unless the
  // visitor has already put it somewhere) and the context goes.
  useEffect(() => veil.subscribe((p, prev) => {
    setPhase(p);
    const page = pageRoot();
    if (page) {
      if (veil.blocking) requestAnimationFrame(() => { if (veil.blocking) page.inert = true; });
      else page.inert = false;
    }
    if (p === 'covering' && prev === 'idle') {
      useMatte.current = !!renderer.current?.hasMatte;
      tripStart.current = veil.now();
      setAnnouncement(veil.snapshot().announce ?? '');
    }
    if (p === 'idle') {
      setAnnouncement('');
      if (prev === 'revealing') {
        const active = document.activeElement;
        if (!active || active === document.body) document.getElementById('main')?.focus({ preventScroll: true });
        dispose();
        closeImage(matte.current.image);      // a matte that came too late for this trip (its bytes stay)
        matte.current.image = null;
      }
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prepared ahead of time (the invitation asks as it starts loading): the curve and the matte are
  // fetched, the shader is built and compiled in parallel; then one invisible frame is drawn.
  useEffect(() => veil.onPrepare(() => {
    if (!curveFetched.current) {
      curveFetched.current = true;
      const signal = downloading();
      loadJson(asset(INVITATION.veilCurve), (url, init) => fetch(url, { ...init, signal })).then((raw) => {
        if (signal.aborted) { curveFetched.current = false; return; }   // stopped: tried again next time
        veil.setCurve(parseVeilCurve(raw));
      });
    }
    getMatte();
    if (renderer.current === undefined && !building.current && host.current) {
      try { renderer.current = createRenderer(host.current); } catch (e) { fail(e); return; }
      if (!renderer.current) { setPlain(true); finishIfReady(); return; }
      building.current = true;
      let frames = 0;
      const poll = () => {
        const r = renderer.current;
        if (!r || !building.current) { building.current = false; return; }
        if (r.ready() || ++frames > 120) { building.current = false; finishIfReady(); return; }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
      return;
    }
    finishIfReady();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // No trip is coming: stop the veil's downloads, free the context, and the decoded matte (its bytes
  // stay for a later trip).
  useEffect(() => veil.onRelease(() => {
    if (veil.phase !== 'idle') return;
    downloads.current?.abort();
    dispose();
    closeImage(matte.current.image);
    matte.current.image = null;
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape clears it at once.
  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') veil.reveal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // Draw every frame while it is up.
  useEffect(() => {
    if (phase === 'idle') return;
    // nobody prepared it ahead of time: made now, as a last resort
    if (renderer.current === undefined && host.current && !plain) {
      try { renderer.current = createRenderer(host.current); } catch (e) { fail(e); }
      if (renderer.current === null) setPlain(true);
    }
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = veil.now();
      const cov = veil.coverage(now);
      const alpha = veil.alpha(now);
      const { origin } = veil.snapshot();
      if (renderer.current) {
        const t = (now - tripStart.current) / 1000;
        try { renderer.current.draw(cov, origin, t, useMatte.current, alpha); } catch (e) { fail(e); }
      } else if (fallback.current) {
        fallback.current.style.opacity = String(cov * alpha);
        fallback.current.style.backgroundImage =
          `radial-gradient(circle at ${origin.x * 100}% ${origin.y * 100}%, #efffff 0%, #96ebfb 55%, #1abcda 120%)`;
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [phase, plain]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    renderer.current?.dispose();
    renderer.current = undefined;
    closeImage(matte.current.image);
    const page = pageRoot();
    if (page) page.inert = false;
  }, []);

  const up = phase !== 'idle';
  return (
    <>
      {/* laid out even while idle (invisible), so the prepared canvas is already full size */}
      <div className={`cloud-veil${up ? ' is-up' : ''}${veil.blocking ? ' is-blocking' : ''}`} aria-hidden>
        <div ref={host} className="cloud-veil__host" hidden={plain} />
        {plain && <div ref={fallback} className="cloud-veil__plain" />}
      </div>
      {/* above the page, which is inert while the cloud covers it: the trip home is still announced */}
      <p className="visually-hidden" aria-live="polite">{announcement}</p>
    </>
  );
}
