// Everything around the guide, painted in the style of the artwork:
//   Emblem     his cloud seat, the swirling cloud scrolls and the sun & bolt behind him
//              (travels with "home": centre stage in the intro, the hero afterwards)
//   HeldCloud  the little cloud he cradles in his hands
//   Sky        distant cloud scrolls and drifting gold motes (intro only, fades on reveal)
//   Trail      gold sparks behind him while he flies

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, Points, PointsMaterial,
  SphereGeometry, Vector3,
} from 'three';
import type { IntroState } from '../intro/introMachine';
import { PALETTE, cloudTexture, glowTexture, outlineMaterial, sunAndBoltTexture, toon } from './guide/toon';
import { home, probe } from './rigState';

const damp = (dt: number, speed: number) => 1 - Math.exp(-dt * speed);

/** A painted cloud scroll on a camera-facing card. */
function CloudCard({ seed, tail = null, w, position, opacityRef, bumps }: {
  seed: number; tail?: 'left' | 'right' | null; w: number; position: [number, number, number];
  opacityRef?: { current: number }; bumps?: number;
}) {
  const mat = useMemo(() => new MeshBasicMaterial({ map: cloudTexture(seed, { tail, bumps }), transparent: true, depthWrite: false }), [seed, tail, bumps]);
  useFrame(() => { if (opacityRef) mat.opacity = opacityRef.current; });
  return (
    <Billboard position={position}>
      <mesh material={mat}>
        <planeGeometry args={[w, w / 2]} />
      </mesh>
    </Billboard>
  );
}

const GONE = new Set<IntroState>(['emerging', 'revealing', 'done']);

export function Emblem({ state }: { state: IntroState }) {
  const g = useRef<Group>(null!);
  const backdrop = useRef<Mesh>(null!);
  const puffs = useMemo(() => {
    const mat = toon(PALETTE.cloud, { emissive: PALETTE.cloud, emissiveIntensity: 0.25 });
    const line = outlineMaterial(0.018, PALETTE.cloudLine);
    const geo = new SphereGeometry(1, 20, 14);
    const list: [number, number, number, number, [number, number, number]][] = [
      [0, 0.1, 0, 0.3, [1.7, 0.5, 1.15]],
      [-0.33, 0.13, 0.08, 0.17, [1, 0.85, 1]],
      [0.34, 0.12, 0.1, 0.18, [1, 0.85, 1]],
      [-0.13, 0.16, 0.24, 0.15, [1, 0.8, 1]],
      [0.16, 0.15, 0.25, 0.14, [1, 0.8, 1]],
      [0.02, 0.06, -0.22, 0.2, [1.2, 0.8, 1]],
    ];
    return { mat, line, geo, list };
  }, []);
  const sunMat = useMemo(() => new MeshBasicMaterial({ map: sunAndBoltTexture(), transparent: true, depthWrite: false }), []);

  useFrame(({ clock }) => {
    g.current.position.copy(home.pos);
    g.current.scale.setScalar(home.scale);
    // His little world gives way to the painting's own sun, bolt and clouds as he transforms.
    g.current.visible = home.visible && !GONE.has(state);
    const t = clock.elapsedTime;
    g.current.position.y += Math.sin(t * 0.8) * 0.012 * home.scale;
    backdrop.current.rotation.z = Math.sin(t * 0.25) * 0.02;
    const sunTarget = state === 'boot' || state === 'loading' || state === 'opening' ? 0 : 1;
    sunMat.opacity += (sunTarget - sunMat.opacity) * Math.min(1, (state === 'opening' ? 3 : 20) * (1 / 60));
  });

  return (
    <group ref={g}>
      <mesh ref={backdrop} material={sunMat} position={[0.05, 0.78, -0.42]} renderOrder={-1}>
        <planeGeometry args={[1.75, 1.75]} />
      </mesh>
      {puffs.list.map(([x, y, z, r, s], i) => (
        <mesh key={i} geometry={puffs.geo} material={puffs.mat} position={[x, y, z]} scale={[r * s[0], r * s[1], r * s[2]]}>
          <mesh geometry={puffs.geo} material={puffs.line} />
        </mesh>
      ))}
      <CloudCard seed={11} tail="left" w={0.75} position={[-0.6, 0.22, 0.2]} />
      <CloudCard seed={12} tail="right" w={0.8} position={[0.62, 0.3, 0.22]} />
      <CloudCard seed={13} w={0.5} position={[0.04, -0.02, 0.45]} bumps={4} />
      <CloudCard seed={14} tail="left" w={0.6} position={[-0.52, 0.98, -0.05]} bumps={2} />
    </group>
  );
}

const HELD_STATES = new Set<IntroState>(['boot', 'loading', 'seated', 'awakening', 'acknowledging', 'beckoning', 'done']);

export function HeldCloud({ state }: { state: IntroState }) {
  const g = useRef<Group>(null!);
  const opacity = useRef(0);
  const target = useMemo(() => new Vector3(), []);
  useFrame((_, dt) => {
    const show = HELD_STATES.has(state);
    opacity.current += ((show ? 1 : 0) - opacity.current) * damp(dt, show ? 2 : 6);
    if (state === 'beckoning') target.copy(probe.handL);
    else target.copy(probe.handL).add(probe.handR).multiplyScalar(0.5);
    target.y += 0.06 * probe.scale;
    target.z += 0.05 * probe.scale;
    g.current.position.lerp(target, opacity.current < 0.05 ? 1 : damp(dt, 10));
    g.current.scale.setScalar(probe.scale * (0.6 + 0.4 * opacity.current));
    g.current.visible = opacity.current > 0.02 && home.visible;
  });
  return (
    <group ref={g}>
      <CloudCard seed={21} tail="right" w={0.36} position={[0, 0, 0]} opacityRef={opacity} bumps={3} />
    </group>
  );
}

/** Distant cloud scrolls and gold motes. Fades away once the portfolio is revealed. */
export function Sky({ state, quality }: { state: IntroState; quality: 'high' | 'low' }) {
  const fade = useRef(1);
  const g = useRef<Group>(null!);
  const clouds = useMemo(() => [
    { seed: 31, tail: 'left' as const, w: 2.2, p: [-3.2, 1.9, -5] as [number, number, number] },
    { seed: 32, tail: 'right' as const, w: 2.6, p: [3.4, 2.4, -6] as [number, number, number] },
    { seed: 33, tail: null, w: 1.6, p: [-2.1, -0.2, -3] as [number, number, number] },
    { seed: 34, tail: 'right' as const, w: 1.8, p: [2.3, 0.1, -3.4] as [number, number, number] },
    { seed: 35, tail: null, w: 3.2, p: [0.6, -1.3, -7] as [number, number, number] },
    { seed: 36, tail: 'left' as const, w: 1.3, p: [-1.4, 1.4, -2.2] as [number, number, number] },
    { seed: 37, tail: 'right' as const, w: 1.1, p: [1.6, -0.45, 0.9] as [number, number, number] },
    { seed: 38, tail: null, w: 1.2, p: [-1.7, -0.55, 1.1] as [number, number, number] },
  ], []);
  const motes = useMemo(() => {
    const n = quality === 'high' ? 140 : 60;
    const pos = new Float32Array(n * 3);
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 7;
      pos[i * 3 + 1] = Math.random() * 3.5 - 0.6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5 - 1;
      speed[i] = 0.05 + Math.random() * 0.12;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const mat = new PointsMaterial({ size: 0.05, map: glowTexture('255,214,110'), transparent: true, depthWrite: false, blending: AdditiveBlending, color: PALETTE.gold });
    return { geo, mat, speed, n };
  }, [quality]);

  useFrame((_, dt) => {
    const show = state !== 'revealing' && state !== 'done';
    fade.current += ((show ? 1 : 0) - fade.current) * damp(dt, show ? 3 : 1.8);
    g.current.visible = fade.current > 0.01;
    if (!g.current.visible) return;
    g.current.children.forEach((c, i) => { if (i < clouds.length) c.position.x = clouds[i].p[0] + Math.sin(performance.now() / 9000 + i) * 0.25; });
    const a = motes.geo.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < motes.n; i++) {
      let y = a.getY(i) + motes.speed[i] * dt;
      if (y > 3) y = -0.6;
      a.setY(i, y);
    }
    a.needsUpdate = true;
    motes.mat.opacity = fade.current * 0.85;
  });

  return (
    <group ref={g}>
      {clouds.map((c) => <CloudCard key={c.seed} seed={c.seed} tail={c.tail} w={c.w} position={c.p} opacityRef={fade} />)}
      <points geometry={motes.geo} material={motes.mat} />
    </group>
  );
}

/** Gold sparks rising off him as the light gathers. */
export function Trail({ state }: { state: IntroState }) {
  const N = 90;
  const data = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new Float32Array(N * 3).fill(-999);
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const life = new Float32Array(N);
    const mat = new PointsMaterial({ size: 0.07, map: glowTexture('255,220,120'), transparent: true, depthWrite: false, blending: AdditiveBlending, color: PALETTE.gold });
    return { geo, life, mat, next: 0, acc: 0 };
  }, []);
  const ref = useRef<Points>(null!);
  useFrame((_, dt) => {
    const emitting = state === 'gathering';
    const a = data.geo.getAttribute('position') as BufferAttribute;
    if (emitting) {
      data.acc += dt * 60;
      while (data.acc > 1) {
        data.acc -= 1;
        const i = data.next++ % N;
        a.setXYZ(i, probe.body.x + (Math.random() - 0.5) * 0.15 * probe.scale, probe.body.y + (Math.random() - 0.5) * 0.15 * probe.scale, probe.body.z - 0.05);
        data.life[i] = 1;
      }
    }
    for (let i = 0; i < N; i++) {
      if (data.life[i] <= 0) continue;
      data.life[i] -= dt * 1.3;
      a.setY(i, a.getY(i) + dt * 0.08);
      if (data.life[i] <= 0) a.setXYZ(i, -999, -999, -999);
    }
    a.needsUpdate = true;
    data.mat.size = 0.07 * Math.max(0.4, probe.scale);
  });
  return <points ref={ref} geometry={data.geo} material={data.mat} frustumCulled={false} />;
}
