// The guide himself: loads the Blender GLB if one is registered
// (public/models/manifest.json), otherwise builds the stand-in. Then plays the
// story's clips, flies him along his path and lands him in the portfolio.

import { use, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CatmullRomCurve3, Group, MathUtils, Quaternion, Vector3, type Object3D } from 'three';
import { beats, type IntroEvent, type IntroState } from '../intro/introMachine';
import { asset } from '../content';
import { GuideAnimator } from './guide/GuideAnimator';
import { buildProceduralGuide } from './guide/proceduralGuide';
import type { GuideModel } from './guide/types';
import { pointer } from './stage';
import { home, probe } from './rigState';

interface Manifest { guide: { src: string; version?: string } | null }
let manifestPromise: Promise<Manifest> | null = null;
const loadManifest = () =>
  (manifestPromise ??= fetch(asset('models/manifest.json'), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { guide: null }))
    .catch(() => ({ guide: null })));

export interface ActorProps {
  state: IntroState;
  send: (e: IntroEvent) => void;
  onReady: () => void;
}

export function Actor(props: ActorProps) {
  const manifest = use(loadManifest());
  return manifest.guide
    ? <GltfActor url={asset(`${manifest.guide.src}?v=${manifest.guide.version ?? ''}`)} {...props} />
    : <ProceduralActor {...props} />;
}

function ProceduralActor(props: ActorProps) {
  const model = useMemo(() => buildProceduralGuide(), []);
  useEffect(() => () => model.dispose(), [model]);
  return <ActorBody model={model} {...props} />;
}

function GltfActor({ url, ...props }: ActorProps & { url: string }) {
  const gltf = useGLTF(url, false, true);
  const model = useMemo<GuideModel>(() => ({ kind: 'gltf', object: gltf.scene, clips: gltf.animations, dispose() {} }), [gltf]);
  return <ActorBody model={model} {...props} />;
}

const FLIGHT_SECONDS = 2.3;
const LANDING_SECONDS = 1.9;
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const smooth = (x: number) => x * x * (3 - 2 * x);

function ActorBody({ model, state, send, onReady }: ActorProps & { model: GuideModel }) {
  const group = useRef<Group>(null!);
  const { camera } = useThree();
  const animator = useMemo(() => new GuideAnimator(model.object, model.clips), [model]);
  useEffect(() => () => animator.stop(), [animator]);
  if (import.meta.env.DEV) (window as unknown as { __guide: unknown }).__guide = { object: model.object, animator };
  const prev = useRef<IntroState>('boot');
  const since = useRef(0);
  const flight = useRef<CatmullRomCurve3 | null>(null);
  const landing = useRef<{ from: Vector3; scale: number; landClipStarted: boolean } | null>(null);
  const passed = useRef(false);
  const ready = useRef(0);
  const perchFallback = !animator.has('perch_idle');
  const nodes = useMemo(() => {
    const get = (n: string) => model.object.getObjectByName(n) as Object3D | undefined;
    return { head: get('head'), handL: get('hand_L'), handR: get('hand_R'), hips: get('hips') };
  }, [model]);

  const playPerch = (fade = 0.6) => animator.play(perchFallback ? 'seated_idle' : 'perch_idle', { fade });

  // Clip-completion events feed the story.
  useEffect(() => {
    animator.onFinished((clip) => {
      if (clip === 'land') { playPerch(0.5); send({ type: 'LANDED' }); return; }
      if (clip === 'wake' || clip === 'acknowledge' || clip === 'rise') send({ type: 'CLIP_DONE', clip });
    });
    return () => animator.onFinished(() => {});
  }, [animator]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each beat of the story picks its clip.
  useEffect(() => {
    const from = prev.current;
    prev.current = state;
    since.current = 0;
    switch (state) {
      case 'boot':
      case 'loading':
      case 'seated':
        if (from === 'done' || from === 'boot') animator.snap('seated_idle');
        else animator.play('seated_idle', { fade: 0.4 });
        break;
      case 'awakening': animator.play('wake', { fade: 0.3 }); break;
      case 'acknowledging': animator.play('acknowledge', { fade: 0.4 }); break;
      case 'beckoning': animator.play('beckon', { fade: 0.6 }); break;
      case 'rising': animator.play('rise', { fade: 0.35 }); break;
      case 'flying': {
        animator.play('fly', { fade: 0.3 });
        const p0 = group.current.position.clone();
        const cz = camera.position.z;
        flight.current = new CatmullRomCurve3([
          p0,
          p0.clone().add(new Vector3(0.05, 0.45, 0.6)),
          new Vector3(0.3, 0.85, 1.6),
          new Vector3(0.55, 1.0, cz - 0.1),
          new Vector3(0.95, 1.2, cz + 2.4),
        ]);
        passed.current = false;
        break;
      }
      case 'revealing':
        if (from === 'flying') {
          // swoop in from above and behind the sun, land on the cloud in the hero
          landing.current = { from: new Vector3(2.4, 2.3, -1.6), scale: 1, landClipStarted: false };
          animator.play('fly', { fade: 0.2 });
        } else {
          landing.current = null;
          playPerch(0.3);
          window.setTimeout(() => send({ type: 'LANDED' }), 700);
        }
        break;
      case 'done':
        if (from === 'boot') animator.snap(perchFallback ? 'seated_idle' : 'perch_idle');
        else if (from !== 'revealing') playPerch();
        landing.current = null;
        break;
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookTarget = useRef(new Vector3());
  const q = useRef(new Quaternion());
  const ahead = useRef(new Vector3());

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    since.current += dt;
    const g = group.current;
    const beat = beats[state];

    // ── where is he? ──
    if (state === 'flying' && flight.current) {
      const u = Math.min(1, since.current / FLIGHT_SECONDS);
      const e = u * u * (2.2 - 1.2 * u);
      g.position.copy(flight.current.getPointAt(e));
      ahead.current.copy(flight.current.getPointAt(Math.min(1, e + 0.02)));
      g.lookAt(ahead.current);
      g.scale.setScalar(1);
      if (!passed.current && (g.position.z > camera.position.z - 0.3 || u >= 1)) {
        passed.current = true;
        send({ type: 'PASSED' });
      }
    } else if (state === 'revealing' && landing.current) {
      const L = landing.current;
      const u = Math.min(1, since.current / LANDING_SECONDS);
      const e = easeOutCubic(u);
      const start = ahead.current.copy(L.from).multiplyScalar(Math.max(home.scale, 0.4)).add(home.pos);
      g.position.lerpVectors(start, home.pos, e);
      g.position.y += Math.sin(Math.PI * u) * 0.35 * home.scale;
      g.scale.setScalar(MathUtils.lerp(L.scale, home.scale, smooth(u)));
      // face the way he travels, then turn to the visitor as he settles
      const travel = new Vector3().subVectors(home.pos, start);
      const yaw = Math.atan2(travel.x, travel.z);
      q.current.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      g.quaternion.copy(q.current).slerp(new Quaternion(), smooth(Math.min(1, u * 1.4)));
      if (!L.landClipStarted && u > 0.42) {
        L.landClipStarted = true;
        if (animator.has('land')) animator.play('land', { fade: 0.35 });
        else animator.play('rise', { fade: 0.35, reverse: true, reportAs: 'land' });
      }
    } else {
      g.position.copy(home.pos);
      if (state === 'rising') g.position.y += smooth(Math.min(1, since.current / 1.7)) * 0.12;
      g.scale.setScalar(home.scale);
      g.quaternion.slerp(q.current.identity(), 1 - Math.exp(-dt * 6));
    }
    g.visible = home.visible || state === 'flying' || state === 'revealing';

    // ── who is he looking at? ──
    if (state === 'done' || state === 'revealing') {
      // the visitor's pointer, projected just in front of the screen
      lookTarget.current.set(pointer.x, pointer.y, 0.6).unproject(camera);
    } else {
      lookTarget.current.copy(camera.position).add(ahead.current.set(pointer.x * 0.8, pointer.y * 0.5, 0));
    }

    animator.update(dt, {
      lookTarget: lookTarget.current,
      lookWeight: beat?.look ?? 0,
      glow: beat?.glow ?? 0,
      eyesOpen: perchFallback && (state === 'done' || state === 'revealing'),
    });

    // ── report positions for the camera and scenery ──
    nodes.head?.getWorldPosition(probe.head);
    nodes.handL?.getWorldPosition(probe.handL);
    nodes.handR?.getWorldPosition(probe.handR);
    nodes.hips?.getWorldPosition(probe.body);
    probe.scale = g.scale.x;

    if (ready.current < 3 && ++ready.current === 3) onReady();
  });

  return (
    <group ref={group}>
      <primitive object={model.object} />
    </group>
  );
}
