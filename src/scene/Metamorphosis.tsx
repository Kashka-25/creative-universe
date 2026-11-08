// The metamorphosis: the little guide's chrysalis.
//
//   gathering  turquoise and gold motes rise from his cloud and spiral round him
//   chrysalis  they weave into a cocoon of warm light that wraps him from the
//              feet up, then pulses twice, gently, in time with his third eye
//   opening    the cocoon unfurls outward like the painting's cloud scrolls, in a
//              soft shower of gold
//   emerging   a fading glow where he was; the painting (his true form) appears
//              over it in the page (EmergingPainting in the intro layer)
//
// Each frame it also reports where the cocoon is on screen, so the painting can
// appear exactly where he was.

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LatheGeometry, Mesh, MeshBasicMaterial,
  PlaneGeometry, Points, PointsMaterial, ShaderMaterial, Vector2, Vector3,
} from 'three';
import type { IntroState } from '../intro/introMachine';
import { METAMORPHOSIS } from '../intro/introMachine';
import { glowTexture } from './guide/toon';
import { home } from './rigState';
import { emergence } from './emergence';

/** Seconds the cocoon takes to wrap him, feet to crown. */
export const COCOON_GROW = 1.6;
const H = 1.22;          // cocoon height (guide units)
const BASE = -0.04;
const PETALS = 6;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const radiusAt = (t: number) => 0.56 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.75 * (1 - 0.12 * t);

const AMBER = new Color('#ffcf7a');
const TURQ = new Color('#8ff3ea');

const cocoonVert = `
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vPhi;
void main() {
  vY = position.y;
  vPhi = atan(position.x, position.z);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const cocoonFrag = `
uniform float uTime, uGrow, uOpacity, uPulse, uH;
uniform vec3 uAmber, uTurq;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vPhi;
void main() {
  float h = clamp(vY / uH, 0.0, 1.0);
  if (h > uGrow) discard;                                        // it wraps him from the feet up
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float swirl = 0.5 + 0.5 * sin(vPhi * 6.0 + h * 9.0 - uTime * 1.3); // cloud-scroll bands drifting round
  float curl = 0.5 + 0.5 * sin(vPhi * 11.0 - h * 14.0 + uTime * 0.8);
  vec3 col = mix(uAmber, uTurq, smoothstep(0.15, 0.95, h * 0.6 + swirl * 0.4));
  float edge = smoothstep(uGrow - 0.08, uGrow, h) * step(uGrow, 0.995);  // bright weaving edge while it grows
  col *= 0.75 + 0.55 * rim + 0.35 * uPulse + 0.25 * curl;
  col += vec3(1.0, 0.95, 0.8) * edge * 0.9;
  float a = (0.62 + 0.3 * rim + 0.1 * swirl + edge * 0.3) * uOpacity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export function Metamorphosis({ state, quality }: { state: IntroState; quality: 'high' | 'low' }) {
  const { camera, size } = useThree();
  const root = useRef<Group>(null!);
  const prev = useRef<IntroState>(state);
  const since = useRef(0);

  const cocoon = useMemo(() => {
    const pts: Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(new Vector2(radiusAt(t) + 0.002, t * H));
    }
    const mat = new ShaderMaterial({
      vertexShader: cocoonVert,
      fragmentShader: cocoonFrag,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uGrow: { value: 0 }, uOpacity: { value: 0 }, uPulse: { value: 0 }, uH: { value: H },
        uAmber: { value: AMBER }, uTurq: { value: TURQ },
      },
    });
    const petals = Array.from({ length: PETALS }, (_, k) => {
      const geo = new LatheGeometry(pts, 8, -Math.PI / PETALS, (2 * Math.PI) / PETALS);
      const pivot = new Group();
      pivot.rotation.y = (k * 2 * Math.PI) / PETALS;
      const mesh = new Mesh(geo, mat);
      pivot.add(mesh);
      return { pivot, mesh };
    });
    return { mat, petals };
  }, []);

  const motes = useMemo(() => {
    const n = quality === 'high' ? 420 : 200;
    const geo = new BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4); // angle, height, speed, radius jitter
    for (let i = 0; i < n; i++) {
      seed[i * 4] = Math.random() * Math.PI * 2;
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = 0.6 + Math.random() * 0.9;
      seed[i * 4 + 3] = Math.random();
      const c = Math.random() < 0.6 ? TURQ : AMBER;
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    const mat = new PointsMaterial({
      size: 0.045, map: glowTexture('255,255,255'), vertexColors: true, transparent: true, depthWrite: false,
      blending: AdditiveBlending, opacity: 0,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    return { geo, mat, seed, n, points };
  }, [quality]);

  const flash = useMemo(() => {
    const m = new MeshBasicMaterial({ map: glowTexture('255,236,190'), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 });
    return new Mesh(new PlaneGeometry(1, 1), m);
  }, []);

  const tmp = useMemo(() => ({ top: new Vector3(), bottom: new Vector3(), centre: new Vector3() }), []);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (prev.current !== state) { prev.current = state; since.current = 0; }
    since.current += dt;
    const s = since.current;
    const t = clock.elapsedTime;
    const g = root.current;
    g.position.copy(home.pos);
    g.scale.setScalar(home.scale);

    const active = state === 'gathering' || state === 'chrysalis' || state === 'opening' || state === 'emerging';
    g.visible = active;
    if (!active) { emergence.setRect(null); return; }

    // ── cocoon ──
    const u = cocoon.mat.uniforms;
    u.uTime.value = t;
    let grow = 0, opacity = 0, open = 0, pulse = 0;
    if (state === 'chrysalis') {
      grow = smooth(s / COCOON_GROW);
      opacity = Math.min(1, s / 0.4);
      const beat = Math.max(0, s - COCOON_GROW - 0.1);
      pulse = Math.max(0, Math.sin(beat * Math.PI * 2 * 0.85)) * (beat > 0 && beat < 1.2 ? 1 : 0); // two gentle beats
    } else if (state === 'opening') {
      grow = 1;
      open = smooth(s / (METAMORPHOSIS.opening / 1000));
      opacity = 1 - smooth((s - 0.5) / 1.1);
      pulse = 1 - open;
    }
    u.uGrow.value = grow;
    u.uOpacity.value = opacity;
    u.uPulse.value = pulse;
    for (const p of cocoon.petals) {
      p.mesh.rotation.x = open * 1.25;          // each petal falls outward from its base, like a cloud scroll unfurling
      p.mesh.position.y = BASE;
      p.pivot.visible = opacity > 0.01;
    }

    // ── motes ──
    const a = motes.geo.getAttribute('position') as BufferAttribute;
    const sd = motes.seed;
    let mo = 0;
    for (let i = 0; i < motes.n; i++) {
      const ang0 = sd[i * 4], h0 = sd[i * 4 + 1], sp = sd[i * 4 + 2], jit = sd[i * 4 + 3];
      let x = 0, y = 0, z = 0;
      if (state === 'gathering') {
        // rise from the cloud and spiral in towards the cocoon's shape
        const k = smooth(Math.min(1, (s * sp) / 1.8));
        const h = h0 * k;
        const r = (1.1 - 0.5 * k) * (0.6 + 0.4 * jit) + radiusAt(h) * k * 0.6;
        const ang = ang0 + s * (1.2 + sp);
        x = Math.sin(ang) * r; z = Math.cos(ang) * r; y = BASE + h * H;
      } else if (state === 'chrysalis') {
        const r = radiusAt(h0) * (1.02 + 0.08 * jit);
        const ang = ang0 + t * (0.9 + sp * 0.6);
        x = Math.sin(ang) * r; z = Math.cos(ang) * r; y = BASE + h0 * H;
      } else {
        // opening and after: a soft burst outward and upward
        const tt = state === 'opening' ? s : s + METAMORPHOSIS.opening / 1000;
        const r = radiusAt(h0) + tt * (0.35 + 0.5 * sp);
        const ang = ang0 + t * 0.4;
        x = Math.sin(ang) * r; z = Math.cos(ang) * r; y = BASE + h0 * H + tt * 0.25 * sp;
      }
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true;
    if (state === 'gathering') mo = Math.min(1, s / 0.8);
    else if (state === 'chrysalis') mo = 1 - 0.5 * smooth((s - COCOON_GROW) / 0.6);
    else if (state === 'opening') mo = 0.9;
    else mo = Math.max(0, 0.8 - s / 1.6);
    motes.mat.opacity = mo;
    motes.mat.size = 0.045 * home.scale * (state === 'opening' ? 1.4 : 1);

    // ── the flash as it opens ──
    const fm = flash.material as MeshBasicMaterial;
    const f = state === 'opening' ? Math.sin(Math.PI * Math.min(1, s / (METAMORPHOSIS.opening / 1000))) : state === 'emerging' ? Math.max(0, 0.5 - s / 2) : 0;
    fm.opacity = f;
    flash.position.set(0, BASE + H * 0.48, 0.2);
    flash.scale.setScalar(1.2 + 1.6 * f);
    flash.quaternion.copy(camera.quaternion);

    // ── where is he on screen? (for the painting to appear in his place) ──
    tmp.centre.set(0, BASE + H * 0.5, 0).multiplyScalar(home.scale).add(home.pos).project(camera);
    tmp.top.set(0, BASE + H, 0).multiplyScalar(home.scale).add(home.pos).project(camera);
    tmp.bottom.set(0, BASE, 0).multiplyScalar(home.scale).add(home.pos).project(camera);
    emergence.setRect({
      x: (tmp.centre.x * 0.5 + 0.5) * size.width,
      y: (-tmp.centre.y * 0.5 + 0.5) * size.height,
      h: Math.abs(tmp.top.y - tmp.bottom.y) * 0.5 * size.height,
    });
  });

  return (
    <group ref={root}>
      {cocoon.petals.map((p, i) => <primitive key={i} object={p.pivot} />)}
      <primitive object={motes.points} />
      <primitive object={flash} />
    </group>
  );
}
