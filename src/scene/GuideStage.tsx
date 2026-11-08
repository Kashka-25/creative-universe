// The single, persistent 3D layer. Loaded lazily (its own chunk, with three.js)
// and kept mounted for the whole visit, so the guide in the intro and the
// guide perched in the portfolio are the same object in the same scene.

import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import type { IntroEvent, IntroState } from '../intro/introMachine';
import { qualityTier } from '../intro/capability';
import { Director } from './Director';
import { Actor } from './Actor';
import { Emblem, HeldCloud, Sky, Trail } from './Scenery';
import { Metamorphosis } from './Metamorphosis';

export interface GuideStageProps {
  state: IntroState;
  send: (e: IntroEvent) => void;
  onReady: () => void;
  onContextLost: () => void;
  active: boolean;
}

export default function GuideStage({ state, send, onReady, onContextLost, active }: GuideStageProps) {
  const [quality] = useState(qualityTier);
  const [dpr, setDpr] = useState(quality === 'high' ? 1.75 : 1.5);

  return (
    <Canvas
      className="stage-canvas"
      flat
      dpr={[1, dpr]}
      frameloop={active ? 'always' : 'never'}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 35, near: 0.05, far: 60, position: [0, 0.85, 5.2] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost(); });
      }}
      aria-hidden
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} />
      <hemisphereLight args={['#fff1d6', '#c9704a', 1.5]} />
      <directionalLight position={[2.5, 3.5, 3]} intensity={2.1} color="#ffe2a8" />
      <directionalLight position={[1.5, 2, -3]} intensity={1.2} color="#ffd36a" />
      <Director state={state} />
      <Sky state={state} quality={quality} />
      <Emblem state={state} />
      <Suspense fallback={null}>
        <Actor state={state} send={send} onReady={onReady} />
        <HeldCloud state={state} />
      </Suspense>
      <Trail state={state} />
      <Metamorphosis state={state} quality={quality} />
    </Canvas>
  );
}
