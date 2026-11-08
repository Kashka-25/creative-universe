// Illustrated look: banded toon shading, inverted-hull ink outlines and
// canvas-painted motifs. Colours are sampled from the original artwork
// (blender/reference/guide-reference.png).

import {
  BackSide, CanvasTexture, Color, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter,
  RedFormat, RepeatWrapping, SRGBColorSpace, type ColorRepresentation, type MeshToonMaterialParameters,
} from 'three';

export const PALETTE = {
  fur: '#642521',
  furLight: '#8a3529',
  furDark: '#4a1a17',
  face: '#ffa36d',
  faceShade: '#c67348',
  mouth: '#8c4630',
  hat: '#df4612',
  hatCuff: '#c23a0e',
  overalls: '#d9481a',
  gold: '#fdd63a',
  goldDeep: '#d9a521',
  eyeWhite: '#fff4e4',
  iris: '#3b1d12',
  thirdEye: '#c9f6ef',
  thirdIris: '#4fb3a5',
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
    ctx.lineWidth = h * 0.07;
    ctx.strokeStyle = PALETTE.faceShade;
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, h * 0.22, 0, Math.PI * 2); ctx.fillStyle = PALETTE.thirdIris; ctx.fill();
    ctx.beginPath(); ctx.arc(cx + h * 0.06, cy - h * 0.07, h * 0.06, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
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
