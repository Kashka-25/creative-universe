import type { AnimationClip, Object3D } from 'three';

/** Whatever drives the intro, stand-in or Blender export, looks like this. */
export interface GuideModel {
  kind: 'procedural' | 'gltf';
  /** Top-level object to add to the scene. Faces +Z, feet/seat at y = 0. */
  object: Object3D;
  clips: AnimationClip[];
  dispose(): void;
}
