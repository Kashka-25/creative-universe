// The camera operator. Frames each beat of the story, and after the intro
// pins the guide's "home" to the portfolio hero so he stays glued to the page
// while it scrolls.

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { beats, type IntroState, type ShotName } from '../intro/introMachine';
import { pointer, stage } from './stage';
import { home } from './rigState';

interface Shot { pos: [number, number, number]; target: [number, number, number] }

const SHOTS: Record<ShotName, Shot> = {
  establish: { pos: [0, 0.85, 5.2], target: [0, 0.62, 0] },
  approach: { pos: [0.35, 0.95, 3.7], target: [0, 0.72, 0] },
  portrait: { pos: [0.15, 0.92, 2.6], target: [0, 0.78, 0] },
  cocoon: { pos: [0, 0.78, 4.1], target: [0, 0.66, 0] },
  perch: { pos: [0, 0.9, 6.5], target: [0, 0.9, 0] },
};

/** Height and centre of the emblem composition (cloud base to sun rays), in guide units. */
const FRAME_H = 1.85;
const FRAME_W = 1.75;
const FRAME_CY = 0.76;

const _v = new Vector3();
const _d = new Vector3();

/** Where a DOM rect sits in the world, on the z = 0 plane, as seen by this camera. */
export function rectToWorld(camera: PerspectiveCamera, rect: DOMRect, vw: number, vh: number) {
  const ndcX = ((rect.left + rect.width / 2) / vw) * 2 - 1;
  const ndcY = -(((rect.top + rect.height / 2) / vh) * 2 - 1);
  _v.set(ndcX, ndcY, 0.5).unproject(camera);
  _d.copy(_v).sub(camera.position).normalize();
  const t = -camera.position.z / _d.z;
  const point = camera.position.clone().addScaledVector(_d, t);
  const dist = camera.position.distanceTo(point);
  const visH = 2 * dist * Math.tan(MathUtils.degToRad(camera.fov / 2));
  const visW = visH * camera.aspect;
  const scale = Math.min(((rect.height / vh) * visH) / FRAME_H, ((rect.width / vw) * visW) / FRAME_W);
  point.y -= FRAME_CY * scale;
  return { pos: point, scale };
}

export function Director({ state }: { state: IntroState }) {
  const { camera, size } = useThree();
  const look = useRef(new Vector3(0, 0.62, 0));
  const homeTarget = useRef({ pos: new Vector3(), scale: 1 });
  const first = useRef(true);

  useFrame((_, dt) => {
    const cam = camera as PerspectiveCamera;
    const shotName = beats[state]?.shot ?? 'establish';
    const shot = SHOTS[shotName];
    const perch = shotName === 'perch';

    // Narrow (portrait phone) screens: step back so he stays in frame.
    const aspect = size.width / size.height;
    const back = perch ? 1 : MathUtils.clamp(0.95 / aspect, 1, 1.9);
    const tgt = new Vector3(...shot.target);
    const pos = new Vector3(...shot.pos).sub(tgt).multiplyScalar(back).add(tgt);
    if (!perch) {
      pos.x += pointer.x * 0.15;
      pos.y += pointer.y * 0.08;
    }

    const snap = first.current;
    const k = snap ? 1 : 1 - Math.exp(-dt * 1.6);
    cam.position.lerp(pos, k);
    look.current.lerp(tgt, k);
    cam.lookAt(look.current);
    cam.updateMatrixWorld();

    // Home: centre of the scene in the intro, the hero stage afterwards.
    const h = homeTarget.current;
    if (perch && stage.el) {
      const r = stage.el.getBoundingClientRect();
      const w = rectToWorld(cam, r, size.width, size.height);
      h.pos.copy(w.pos);
      h.scale = w.scale;
      home.visible = r.bottom > 0 && r.top < size.height;
    } else {
      h.pos.set(0, 0, 0);
      h.scale = 1;
      home.visible = !perch;
    }
    // Glide while the story moves; stick exactly once settled, so scrolling feels attached.
    const settle = state === 'done' || snap ? 1 : 1 - Math.exp(-dt * 2.2);
    home.pos.lerp(h.pos, settle);
    home.scale += (h.scale - home.scale) * settle;
    first.current = false;
  });

  return null;
}
