// Draws the living painting: Cassidy's painting in two layers (sky behind, the
// chimp in front), gently warped in a shader. Warping moves the existing paint
// a few pixels; nothing is cut out or repainted, so no gaps can open up.
// Plain WebGL, no three.js, so the homepage stays light.

import type { Motion } from './motion';

export interface Layout {
  size: [number, number];
  aspect: number;
  thirdEye: [number, number];
  neck: [number, number];
  sun: [number, number];
  head: { c: [number, number]; r: [number, number] };
  chest: { c: [number, number]; r: [number, number] };
  hands: { c: [number, number]; r: [number, number] };
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // 0,0 = top left, like the landmarks
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uFig;
uniform sampler2D uSky;
uniform sampler2D uMask;
uniform float uAspect, uTime, uBreath, uTilt, uNod, uLift, uGlow, uSun, uOpacity;
uniform vec2 uNeck, uEye, uSunC;
uniform vec4 uHead, uChest, uHands;

vec2 toQ(vec2 uv) { return vec2(uv.x * uAspect, uv.y); }
vec2 fromQ(vec2 q) { return vec2(q.x / uAspect, q.y); }
float inside(vec2 uv, vec4 e, float soft) { return 1.0 - smoothstep(1.0 - soft, 1.0, length((uv - e.xy) / e.zw)); }
vec2 rot(vec2 q, float a) { float c = cos(a), s = sin(a); return vec2(c * q.x - s * q.y, s * q.x + c * q.y); }

// How far the paint at uv moves this frame (uv units; y points down).
vec2 disp(vec2 uv) {
  vec2 d = vec2(0.0);
  float upper = smoothstep(0.62, 0.3, uv.y);
  d.y -= 0.0032 * uBreath * upper;                                  // shoulders and head ride the breath
  float wc = inside(uv, uChest, 0.6);
  d.x += (uv.x - uChest.x) * 0.012 * uBreath * wc;                  // chest widens
  d.y -= 0.0022 * uBreath * wc;
  float wh = inside(uv, uHead, 0.35);
  vec2 q = toQ(uv) - toQ(uNeck);
  d += wh * (fromQ(rot(q, uTilt)) - fromQ(q));                      // head tilts about the neck
  d.y += wh * uNod;
  d.y -= 0.016 * uLift * inside(uv, uHands, 0.55);                  // the cloud offering
  float cm = texture2D(uMask, uv).r;                                // cloud swirls drift
  d += cm * vec2(0.0022 * sin(uv.y * 38.0 + uTime * 0.9), 0.0016 * sin(uv.x * 31.0 + uTime * 0.7));
  return d;
}

void main() {
  vec2 uv = vUv;
  vec2 src = uv - disp(uv);
  src = uv - disp(src);                                             // refine the inverse warp once
  vec4 fig = texture2D(uFig, src);

  vec2 qs = toQ(uv) - toQ(uSunC);
  vec2 skyUv = fromQ(rot(qs, -0.012 * uSun) / (1.0 + 0.018 * uSun)) + uSunC;
  vec4 sky = texture2D(uSky, skyUv);
  float far = smoothstep(0.16, 0.24, length(qs));
  sky.rgb *= 1.0 + far * 0.06 * sin(uTime * 2.3 + uv.y * 18.0);    // the bolt shimmers

  vec2 eye = uEye + disp(uEye);
  vec2 de = toQ(uv) - toQ(eye);
  float g = uGlow * exp(-dot(de, de) / 0.0009);
  vec3 glow = vec3(0.55, 0.97, 0.9) * g * 0.55;

  vec4 col = fig + sky * (1.0 - fig.a);                             // textures are premultiplied
  col.rgb += glow;
  col.a = max(col.a, g * 0.35);
  gl_FragColor = col * uOpacity;
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

export class LivingRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private textures: WebGLTexture[] = [];

  constructor(private canvas: HTMLCanvasElement, layout: Layout, images: { figure: HTMLImageElement; sky: HTMLImageElement; mask: HTMLImageElement }) {
    const opts = { premultipliedAlpha: true, alpha: true, antialias: false };
    const gl = (canvas.getContext('webgl2', opts) ?? canvas.getContext('webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) throw new Error('no WebGL');
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uFig', 'uSky', 'uMask', 'uAspect', 'uTime', 'uBreath', 'uTilt', 'uNod', 'uLift', 'uGlow', 'uSun', 'uOpacity', 'uNeck', 'uEye', 'uSunC', 'uHead', 'uChest', 'uHands']) {
      this.u[n] = gl.getUniformLocation(p, n);
    }
    const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    [images.figure, images.sky, images.mask].forEach((img, i) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, i < 2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (isGl2) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      this.textures.push(t);
    });
    gl.uniform1i(this.u.uFig, 0);
    gl.uniform1i(this.u.uSky, 1);
    gl.uniform1i(this.u.uMask, 2);
    const L = layout;
    gl.uniform1f(this.u.uAspect, L.aspect);
    gl.uniform2f(this.u.uNeck, ...L.neck);
    gl.uniform2f(this.u.uEye, ...L.thirdEye);
    gl.uniform2f(this.u.uSunC, ...L.sun);
    gl.uniform4f(this.u.uHead, ...L.head.c, ...L.head.r);
    gl.uniform4f(this.u.uChest, ...L.chest.c, ...L.chest.r);
    gl.uniform4f(this.u.uHands, ...L.hands.c, ...L.hands.r);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  draw(time: number, m: Motion, opacity = 1) {
    const { gl, u } = this;
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uBreath, m.breath);
    gl.uniform1f(u.uTilt, m.tilt);
    gl.uniform1f(u.uNod, m.nod);
    gl.uniform1f(u.uLift, m.lift);
    gl.uniform1f(u.uGlow, m.glow);
    gl.uniform1f(u.uSun, m.sun);
    gl.uniform1f(u.uOpacity, opacity);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const { gl } = this;
    this.textures.forEach((t) => gl.deleteTexture(t));
    gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
