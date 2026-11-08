// Illustrated look: banded toon shading, inverted-hull ink outlines and
// canvas-painted motifs. Colours are sampled from the original artwork
// (blender/reference/guide-reference.png).

import {
  BackSide, CanvasTexture, Color, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter,
  RedFormat, RepeatWrapping, SRGBColorSpace, type ColorRepresentation, type MeshToonMaterialParameters,
} from 'three';

export const PALETTE = {
  fur: '#5c211d',
  furLight: '#7a2f27',
  furDark: '#3f1613',
  furStreak: '#94402f',
  face: '#ffa36d',
  faceShade: '#c67348',
  faceEdge: '#e2885a',
  mouth: '#6e3020',
  lash: '#5a2418',
  hat: '#e04a12',
  hatShade: '#b8330f',
  hatCuff: '#d84410',
  overalls: '#e0561c',
  overallsLine: '#b23d0e',
  gold: '#fdd63a',
  goldDeep: '#d9a521',
  eyeWhite: '#fff4e4',
  iris: '#3b1d12',
  thirdEye: '#bdf3ee',
  thirdIris: '#5ec7b7',
  cloud: '#b8fff6',
  cloudLine: '#22c3e6',
  cloudDeep: '#5fd7e8',
  ink: '#2a0e0c',
} as const;

let gradient: DataTexture | null = null;
/** Four tone bands: shadow, mid, light, highlight. */
export function toonGradient() {
  if (gradient) return gradient;
  gradient = new DataTexture(new Uint8Array([110, 176, 232, 255]), 4, 1, RedFormat);
  gradient.minFilter = NearestFilter;
  gradient.magFilter = NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

let furGradient: DataTexture | null = null;
/** Softer, darker bands for fur, so maroon stays maroon under the warm key light. */
export function furToonGradient() {
  if (furGradient) return furGradient;
  furGradient = new DataTexture(new Uint8Array([70, 120, 165, 200]), 4, 1, RedFormat);
  furGradient.minFilter = NearestFilter;
  furGradient.magFilter = NearestFilter;
  furGradient.generateMipmaps = false;
  furGradient.needsUpdate = true;
  return furGradient;
}

export function toon(color: ColorRepresentation, extra: MeshToonMaterialParameters = {}) {
  return new MeshToonMaterial({ color: new Color(color), gradientMap: toonGradient(), ...extra });
}

const outlineCache = new Map<string, MeshBasicMaterial>();
/** Back-face hull pushed out along normals: reads as a hand-inked line. */
export function outlineMaterial(width: number, color: ColorRepresentation = PALETTE.ink) {
  const key = `${width.toFixed(4)}|${String(color)}`;
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const m = new MeshBasicMaterial({ color: new Color(color), side: BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.vertexShader = 'uniform float uOutline;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  transformed += normalize(normal) * uOutline;',
    );
  };
  m.customProgramCacheKey = () => `outline-${key}`;
  outlineCache.set(key, m);
  return m;
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministic pseudo-random numbers, so painted motifs look the same every visit. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Lightning bolt, centred on cx,cy, h tall. */
export function boltPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number) {
  const w = h * 0.55;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.15, cy - h / 2);
  ctx.lineTo(cx - w * 0.45, cy + h * 0.06);
  ctx.lineTo(cx - w * 0.02, cy + h * 0.06);
  ctx.lineTo(cx - w * 0.2, cy + h / 2);
  ctx.lineTo(cx + w * 0.45, cy - h * 0.1);
  ctx.lineTo(cx + w * 0.04, cy - h * 0.1);
  ctx.closePath();
}

/** Third eye as in the artwork: pale almond, turquoise iris. */
export function thirdEyeTexture() {
  return canvasTexture(256, 160, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.44, cy);
    ctx.quadraticCurveTo(cx, cy - h * 0.62, cx + w * 0.44, cy);
    ctx.quadraticCurveTo(cx, cy + h * 0.62, cx - w * 0.44, cy);
    ctx.closePath();
    ctx.fillStyle = PALETTE.thirdEye;
    ctx.fill();
    ctx.lineWidth = h * 0.06;
    ctx.strokeStyle = '#4fb8b0';
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.beginPath(); ctx.arc(cx, cy, h * 0.3, 0, Math.PI * 2); ctx.fillStyle = PALETTE.thirdIris; ctx.fill();
    ctx.restore();
  });
}

/** Knitted ribbing for the beanie cuff. */
export function ribTexture() {
  const t = canvasTexture(256, 32, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.hatCuff;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120, 30, 6, 0.55)';
    ctx.lineWidth = 3;
    for (let x = 4; x < w; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

/**
 * Auspicious cloud in the artwork's style: pale aqua puffs with a bright cyan
 * line, spiral curls inside, and an optional sweeping tail.
 */
export function cloudTexture(seed = 1, opts: { tail?: 'left' | 'right' | null; bumps?: number } = {}) {
  const rnd = seeded(seed);
  const W = 512, H = 256;
  return canvasTexture(W, H, (ctx) => {
    const bumps = opts.bumps ?? 3 + Math.floor(rnd() * 3);
    const circles: [number, number, number][] = [];
    const span = W * (opts.tail ? 0.5 : 0.78);
    const x0 = opts.tail === 'left' ? W * 0.44 : W * 0.11;
    for (let i = 0; i < bumps; i++) {
      const t = bumps === 1 ? 0.5 : i / (bumps - 1);
      const r = H * (0.17 + rnd() * 0.12) * (1 - Math.abs(t - 0.5) * 0.6);
      const cx = x0 + span * t;
      const cy = H * 0.56 - r * 0.25 - Math.sin(t * Math.PI) * H * 0.1 + (rnd() - 0.5) * H * 0.05;
      circles.push([cx, cy, r]);
    }
    const line = H * 0.035;
    // tail first, so the puffs sit over its root
    if (opts.tail) {
      const dir = opts.tail === 'left' ? -1 : 1;
      const [bx, by] = opts.tail === 'left' ? circles[0] : circles[circles.length - 1];
      ctx.lineCap = 'round';
      const steps = 22;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? PALETTE.cloudLine : PALETTE.cloud;
        for (let i = 0; i < steps; i++) {
          const a = i / steps, b = (i + 1) / steps;
          const pt = (k: number) => [bx + dir * k * W * 0.4, by + Math.sin(k * Math.PI * 1.1) * -H * 0.12 + k * H * 0.12] as const;
          const [ax, ay] = pt(a), [cx2, cy2] = pt(b);
          const width = H * 0.16 * (1 - a) + 2;
          ctx.lineWidth = pass === 0 ? width + line * 2 : width;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cx2, cy2); ctx.stroke();
        }
      }
    }
    // union outline: stroke all, then fill all
    ctx.lineWidth = line * 2;
    ctx.strokeStyle = PALETTE.cloudLine;
    for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = PALETTE.cloud;
    for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    // flat base
    const minX = Math.min(...circles.map(([x, , r]) => x - r * 0.6));
    const maxX = Math.max(...circles.map(([x, , r]) => x + r * 0.6));
    const baseY = Math.max(...circles.map(([, y, r]) => y + r * 0.55));
    ctx.fillRect(minX, baseY - H * 0.12, maxX - minX, H * 0.12);
    ctx.beginPath(); ctx.moveTo(minX, baseY); ctx.lineTo(maxX, baseY);
    ctx.lineWidth = line; ctx.stroke();
    // spiral curls
    ctx.lineWidth = line * 0.8;
    ctx.lineCap = 'round';
    for (const [x, y, r] of circles) {
      ctx.beginPath();
      const turns = 1.6;
      for (let i = 0; i <= 40; i++) {
        const k = i / 40;
        const ang = k * turns * Math.PI * 2 + rnd() * 0.02;
        const rr = r * 0.55 * (1 - k * 0.85);
        const px = x + Math.cos(ang) * rr, py = y + r * 0.05 + Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  });
}

/** The backdrop from the artwork: a rayed sun and a great lightning bolt. */
export function sunAndBoltTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const rnd = seeded(7);
    // bolt (behind the sun)
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.moveTo(w * 0.2, h * 0.14);
    ctx.lineTo(w * 0.5, h * 0.36);
    ctx.lineTo(w * 0.36, h * 0.4);
    ctx.lineTo(w * 0.86, h * 0.92);
    ctx.lineTo(w * 0.56, h * 0.5);
    ctx.lineTo(w * 0.68, h * 0.47);
    ctx.lineTo(w * 0.3, h * 0.1);
    ctx.closePath();
    ctx.fill();
    // sun disc
    const sx = w * 0.64, sy = h * 0.27, sr = w * 0.14;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    // brush-stroke rays of varied length on the open side
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI * 0.95 + (i / 25) * Math.PI * 1.25;
      const long = i % 2 === 0;
      const r1 = sr * 1.22, r2 = sr * (long ? 2.0 + rnd() * 0.5 : 1.5 + rnd() * 0.25);
      ctx.lineWidth = w * (long ? 0.012 : 0.008);
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
      ctx.lineTo(sx + Math.cos(a) * r2, sy + Math.sin(a) * r2);
      ctx.stroke();
    }
  });
}

/** Soft round glow for additive sprites. */
export function glowTexture(rgb = '255,214,120') {
  return canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.35, `rgba(${rgb},0.45)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}


/**
 * The face, painted like the illustration: warm peach with darker edges, arched
 * brow creases, small nose-bridge wrinkles, under-eye lines, cheek folds and the
 * big tan lower lip. Mapped by front projection onto the sculpted face mask
 * (unit coords x, y in -1..1).
 */
export function faceTexture() {
  return canvasTexture(1024, 1024, (ctx, W, H) => {
    const X = (x: number) => (x * 0.5 + 0.5) * W;
    const Y = (y: number) => (1 - (y * 0.5 + 0.5)) * H;
    ctx.fillStyle = PALETTE.face;
    ctx.fillRect(0, 0, W, H);
    // darker towards the edges of the mask
    const edge = ctx.createRadialGradient(X(0), Y(0.05), W * 0.3, X(0), Y(0.05), W * 0.52);
    edge.addColorStop(0, 'rgba(226,136,90,0)');
    edge.addColorStop(1, 'rgba(198,115,72,0.85)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    // big lower lip / chin, darker tan, under the mouth line
    ctx.fillStyle = PALETTE.faceShade;
    ctx.beginPath();
    ctx.moveTo(X(-0.58), Y(-0.42));
    ctx.quadraticCurveTo(X(0), Y(-0.48), X(0.58), Y(-0.42));
    ctx.quadraticCurveTo(X(0.5), Y(-0.86), X(0), Y(-0.9));
    ctx.quadraticCurveTo(X(-0.5), Y(-0.86), X(-0.58), Y(-0.42));
    ctx.fill();

    const stroke = (pts: [number, number][], width: number, color: string) => {
      ctx.strokeStyle = color === PALETTE.faceShade ? '#b65f3a' : color;
      ctx.lineWidth = width * 1.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
      if (pts.length === 3) ctx.quadraticCurveTo(X(pts[1][0]), Y(pts[1][1]), X(pts[2][0]), Y(pts[2][1]));
      else for (const [x, y] of pts.slice(1)) ctx.lineTo(X(x), Y(y));
      ctx.stroke();
    };
    for (const s of [1, -1]) {
      // brow creases: an arch over each eye, and a shorter one above it
      stroke([[s * 0.13, 0.12], [s * 0.36, 0.34], [s * 0.66, 0.18]], 9, PALETTE.faceShade);
      stroke([[s * 0.22, 0.3], [s * 0.4, 0.42], [s * 0.58, 0.32]], 6, PALETTE.faceShade);
      // eye crease (upper lid fold) and under-eye lines
      stroke([[s * 0.2, 0.1], [s * 0.42, 0.16], [s * 0.66, 0.06]], 5, '#d98252');
      stroke([[s * 0.22, -0.08], [s * 0.42, -0.1], [s * 0.62, -0.04]], 5, '#ffc7a0');
      stroke([[s * 0.24, -0.15], [s * 0.42, -0.19], [s * 0.6, -0.12]], 4, '#e3925f');
      // cheek folds framing the muzzle
      stroke([[s * 0.2, -0.2], [s * 0.42, -0.26], [s * 0.66, -0.42]], 7, PALETTE.faceShade);
      stroke([[s * 0.36, -0.16], [s * 0.58, -0.22], [s * 0.76, -0.36]], 5, '#d98252');
      // mouth-corner lines
      stroke([[s * 0.56, -0.34], [s * 0.66, -0.42], [s * 0.6, -0.52]], 5, PALETTE.faceShade);
    }
    // nose-bridge wrinkles
    stroke([[-0.07, 0.14], [0, 0.17], [0.07, 0.14]], 4, PALETTE.faceShade);
    stroke([[-0.06, 0.06], [0, 0.09], [0.06, 0.06]], 4, PALETTE.faceShade);
    stroke([[-0.04, 0.0], [0, 0.02], [0.04, 0.0]], 3, '#d98252');
    // soft shading around the nose
    const nose = ctx.createRadialGradient(X(0), Y(-0.16), 2, X(0), Y(-0.16), W * 0.08);
    nose.addColorStop(0, 'rgba(198,115,72,0.55)');
    nose.addColorStop(1, 'rgba(198,115,72,0)');
    ctx.fillStyle = nose;
    ctx.fillRect(0, 0, W, H);
  });
}

/** Burnt-orange knit: soft vertical stitch columns and a few fold shadows. */
export function knitTexture(base: string = PALETTE.hat, line = 'rgba(150, 40, 8, 0.28)', ribs = false) {
  const t = canvasTexture(512, 512, (ctx, W, H) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = line;
    ctx.lineWidth = ribs ? 7 : 3;
    const step = ribs ? 18 : 12;
    for (let x = 0; x < W; x += step) {
      ctx.beginPath();
      for (let y = 0; y <= H; y += 16) ctx.lineTo(x + Math.sin(y * 0.05 + x) * (ribs ? 0.5 : 1.5), y);
      ctx.stroke();
    }
    if (!ribs) {
      const rnd = seeded(5);
      ctx.strokeStyle = 'rgba(140, 34, 6, 0.35)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const x = rnd() * W, y = rnd() * H * 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 30, y + 20, x + 70 + rnd() * 40, y + 6);
        ctx.stroke();
      }
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Corduroy for the dungarees. */
export function corduroyTexture() {
  const t = canvasTexture(256, 256, (ctx, W, H) => {
    ctx.fillStyle = PALETTE.overalls;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = PALETTE.overallsLine;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 3;
    for (let x = 4; x < W; x += 11) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Painted fur: dense downward strands in the painting's maroons, for the base fur shapes. */
export function furTexture() {
  const t = canvasTexture(512, 512, (ctx, W, H) => {
    const rnd = seeded(9);
    ctx.fillStyle = PALETTE.fur;
    ctx.fillRect(0, 0, W, H);
    const tones = [PALETTE.furDark, PALETTE.furDark, PALETTE.furLight, PALETTE.furStreak];
    ctx.lineCap = 'round';
    for (let i = 0; i < 900; i++) {
      const x = rnd() * W, y = rnd() * H, len = 18 + rnd() * 40;
      ctx.strokeStyle = tones[Math.floor(rnd() * tones.length)];
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.lineWidth = 1.5 + rnd() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (rnd() - 0.5) * 10, y + len * 0.5, x + (rnd() - 0.5) * 14, y + len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}
