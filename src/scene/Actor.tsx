// The guide himself: loads the Blender GLB if one is registered
// (public/models/manifest.json), otherwise builds the stand-in. Then plays the
// story's clips. During the metamorphosis he settles, is wrapped in the
// cocoon (Metamorphosis.tsx) and gives way to his true form, the painting.

import { use, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import { beats, METAMORPHOSIS_STATES, type IntroEvent, type IntroState } from '../intro/introMachine';
import { COCOON_GROW } from './Metamorphosis';
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

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function ActorBody({ model, state, send, onReady }: ActorProps & { model: GuideModel }) {
  const group = useRef<Group>(null!);
  const { camera } = useThree();
  const animator = useMemo(() => new GuideAnimator(model.object, model.clips), [model]);
  useEffect(() => () => animator.stop(), [animator]);
  if (import.meta.env.DEV) (window as unknown as { __guide: unknown }).__guide = { object: model.object, animator };
  const prev = useRef<IntroState>('boot');
  const since = useRef(0);
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
      if (clip === 'wake' || clip === 'acknowledge') send({ type: 'CLIP_DONE', clip });
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
      // The metamorphosis: he closes his eyes and settles into his lotus pose
      // while the light gathers; the cocoon then hides him (Metamorphosis.tsx).
      case 'gathering': animator.play('seated_idle', { fade: 0.9 }); break;
      case 'revealing': break;
      case 'done':
        if (from === 'boot') animator.snap(perchFallback ? 'seated_idle' : 'perch_idle');
        else if (from !== 'revealing') playPerch();
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
    g.position.copy(home.pos);
    g.scale.setScalar(home.scale);
    g.quaternion.slerp(q.current.identity(), 1 - Math.exp(-dt * 6));
    if (state === 'gathering') g.position.y += smooth(since.current / 2) * 0.06 * home.scale; // lifted a little by the light
    if (state === 'chrysalis') {
      g.position.y += 0.06 * home.scale;
      g.scale.multiplyScalar(1 - 0.08 * smooth(since.current / COCOON_GROW));
    }
    // Inside the cocoon, and from then on, his little form is gone: the painting is his true form.
    const transformed = (state === 'chrysalis' && since.current > COCOON_GROW + 0.1) || METAMORPHOSIS_STATES.slice(2).includes(state)
      || state === 'revealing' || state === 'done';
    g.visible = home.visible && !transformed;

    // ── who is he looking at? ──
    if (state === 'done') {
      // the visitor's pointer, projected just in front of the screen
      lookTarget.current.set(pointer.x, pointer.y, 0.6).unproject(camera);
    } else {
      lookTarget.current.copy(camera.position).add(ahead.current.set(pointer.x * 0.8, pointer.y * 0.5, 0));
    }

    animator.update(dt, {
      lookTarget: lookTarget.current,
      lookWeight: beat?.look ?? 0,
      glow: beat?.glow ?? 0,
      eyesOpen: perchFallback && state === 'done',
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
