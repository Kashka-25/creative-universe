// Character studio: the original painting beside live front, three-quarter
// and side views of the 3D guide, for judging likeness before animation work.
// Route: #/studio   (not linked from the site)

import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { asset } from '../content';
import { buildProceduralGuide } from '../scene/guide/proceduralGuide';
import { GuideAnimator } from '../scene/guide/GuideAnimator';

type Pose = 'closed' | 'open';

// Dev tool: render each view and a side-by-side sheet to docs/likeness/*.png
const canvases = new Map<string, { el: HTMLCanvasElement; invalidate: () => void }>();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
async function post(name: string, dataUrl: string) {
  const r = await fetch('/__studio/snapshot', { method: 'POST', body: JSON.stringify({ name, dataUrl }) });
  if (!r.ok) throw new Error(await r.text());
}
async function saveLikeness(pose: Pose) {
  const frame = () => new Promise((r) => setTimeout(() => r(null), 120));
  canvases.forEach((c) => c.invalidate());
  await frame(); await frame();
  const views = [...canvases.entries()];
  const ref = document.querySelector<HTMLImageElement>('.studio__panel--ref img')!;
  const W = views[0][1].el.width, H = views[0][1].el.height, LABEL = Math.round(H * 0.07);
  const sheet = document.createElement('canvas');
  sheet.width = W * (views.length + 1);
  sheet.height = H + LABEL;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#fffaf1';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const pad = W * 0.06, scale = Math.min((W - pad * 2) / ref.naturalWidth, (H - pad * 2) / ref.naturalHeight);
  ctx.drawImage(ref, (W - ref.naturalWidth * scale) / 2, (H - ref.naturalHeight * scale) / 2, ref.naturalWidth * scale, ref.naturalHeight * scale);
  views.forEach(([, c], i) => ctx.drawImage(c.el, W * (i + 1), 0));
  ctx.fillStyle = '#3a1714';
  ctx.font = `600 ${Math.round(LABEL * 0.45)}px Figtree Variable, sans-serif`;
  ctx.textAlign = 'center';
  ['Reference', ...views.map(([k]) => k)].forEach((label, i) => ctx.fillText(label, W * i + W / 2, H + LABEL * 0.62));
  for (const [label, c] of views) await post(`${slug(label)}-${pose}`, c.el.toDataURL('image/png'));
  await post(`sheet-${pose}`, sheet.toDataURL('image/png'));
  return 'saved';
}

function Model({ pose }: { pose: Pose }) {
  const model = useMemo(() => buildProceduralGuide(), []);
  const animator = useMemo(() => new GuideAnimator(model.object, model.clips), [model]);
  const invalidate = useThree((s) => s.invalidate);
  if (import.meta.env.DEV) ((window as unknown as { __studio: unknown[] }).__studio ??= []).push({ model, animator });
  useEffect(() => {
    animator.snap(pose === 'closed' ? 'seated_idle' : 'perch_idle');
    animator.update(0, { lookTarget: null, lookWeight: 0, glow: pose === 'open' ? 0.6 : 0 });
    invalidate();
  }, [animator, pose, invalidate]);
  return <primitive object={model.object} />;
}

function Aim({ angle, target }: { angle: number; target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const d = 3.9;
    const a = (angle * Math.PI) / 180;
    camera.position.set(target[0] + Math.sin(a) * d, target[1] + 0.25, target[2] + Math.cos(a) * d);
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
  }, [angle, camera, target]);
  return null;
}

function View({ angle, label, pose }: { angle: number; label: string; pose: Pose }) {
  const target = useMemo<[number, number, number]>(() => [0, 0.6, 0], []);
  return (
    <figure className="studio__panel">
      <div className="studio__canvas">
        <Canvas
          flat
          frameloop="demand"
          dpr={2.5}
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: 22, near: 0.05, far: 30 }}
          onCreated={({ gl, invalidate }) => { canvases.set(label, { el: gl.domElement, invalidate }); }}
        >
          <hemisphereLight args={['#fff1d6', '#c9704a', 1.5]} />
          <directionalLight position={[2.5, 3.5, 3]} intensity={2.1} color="#ffe2a8" />
          <directionalLight position={[1.5, 2, -3]} intensity={1.2} color="#ffd36a" />
          <Aim angle={angle} target={target} />
          <Model pose={pose} />
        </Canvas>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export default function Turnaround() {
  const [pose, setPose] = useState<Pose>('closed');
  useEffect(() => { document.title = 'Character studio · Cassidy’s Creative Universe'; }, []);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __saveLikeness: () => Promise<string> }).__saveLikeness = () => saveLikeness(pose);
  }, [pose]);
  return (
    <div className="studio">
      <header className="studio__head">
        <h1>Character likeness pass</h1>
        <p>The original painting is the source of truth. Live 3D views of the guide, rendered with the site’s own lighting.</p>
        <div className="studio__toggle" role="group" aria-label="Eyes">
          <button type="button" aria-pressed={pose === 'closed'} onClick={() => setPose('closed')}>Eyes closed (as painted)</button>
          <button type="button" aria-pressed={pose === 'open'} onClick={() => setPose('open')}>Awake</button>
          {import.meta.env.DEV && <button type="button" onClick={() => saveLikeness(pose)}>Save sheet to docs/likeness</button>}
        </div>
      </header>
      <div className="studio__grid">
        <figure className="studio__panel studio__panel--ref">
          <div className="studio__canvas"><img src={asset('art/guide.webp')} alt="Cassidy's original painting of the guide" /></div>
          <figcaption>Reference</figcaption>
        </figure>
        <View angle={0} label="Front" pose={pose} />
        <View angle={-40} label="Three-quarter" pose={pose} />
        <View angle={-90} label="Side" pose={pose} />
      </div>
    </div>
  );
}
