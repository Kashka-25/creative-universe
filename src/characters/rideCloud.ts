// Coco's ride cloud (blender/scripts/build_ride_cloud.py → models/clouds/ride-cloud.glb): the swirl
// cloud he rides in on, on the welcome and on every page. Shared by InvitationStage and HomeStage.
//
// - It follows his root bone: the code copies the bone's movement (from its rest pose) onto the cloud,
//   so his own Blender motion (the welcome's ride, his float) carries it; its own clips only move the
//   cloud itself (its swirl, the merge into the magic cloud, the flight's path values).
// - Glow, opacity and the flight's path come from Blender as the X scale of control empties (three
//   cannot play material animation), offset by FLOOR so they are never 0.
// - Drawn in the magic cloud's colours: its ramp as base colour and emissive map, the glow colour as
//   the emissive tint, the strength from ctl_glow (at rest as soft as the section clouds). Always
//   transparent but writing depth, so a fade never needs a new shader.

import { Matrix4, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { CLOUD_GLOW } from '../invitation/cloudLook';
import { meshesOf } from './sceneUtils';

/** Control values are stored as FLOOR + value (never 0). */
export const RIDE_FLOOR = 2 ** -10;
/** Glow values from Blender are 0..1; this is the emissive strength at 1 (the magic cloud's). */
export const RIDE_GLOW_STRENGTH = 1.6;
/** The bone that carries him (and so the cloud). */
export const ROOT_BONE = 'root';

/** A control empty's value (its X scale less FLOOR), or `fallback` without one. */
export const ctlValue = (o: Object3D | null | undefined, fallback = 0) => (o ? Math.max(0, o.scale.x - RIDE_FLOOR) : fallback);

export interface RideParts {
  glow: Object3D | null;
  fade: Object3D | null;
  progress: Object3D | null;
  lift: Object3D | null;
  bank: Object3D | null;
  materials: MeshStandardMaterial[];
  /** Puts his materials back and frees the copies. */
  dispose(): void;
}

/** Gives the cloud its own materials (see the top) and finds its control empties. */
export function prepareRide(scene: Object3D, order = 0): RideParts {
  const restore: [Mesh, Material | Material[]][] = [];
  const materials: MeshStandardMaterial[] = [];
  for (const m of meshesOf(scene)) {
    restore.push([m, m.material]);
    const own = (mat: Material) => {
      const c = mat.clone() as MeshStandardMaterial;
      if (c.emissive) { c.emissive.set(CLOUD_GLOW); c.emissiveIntensity = 0.32; }
      c.transparent = true;
      c.depthWrite = true;
      materials.push(c);
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
    m.renderOrder = order;
    m.frustumCulled = false;
  }
  const find = (n: string) => scene.getObjectByName(n) ?? null;
  return {
    glow: find('ctl_glow'), fade: find('ctl_fade'), progress: find('ctl_progress'), lift: find('ctl_lift'), bank: find('ctl_bank'),
    materials,
    dispose() {
      for (const [m, mat] of restore) m.material = mat;
      materials.forEach((m) => m.dispose());
    },
  };
}

/** Blender's glow and opacity onto the cloud's materials; `opacity` scales the authored one. Returns the opacity used. */
export function applyRideLook(p: RideParts, opacity = 1): number {
  const o = Math.min(1, Math.max(0, ctlValue(p.fade, 1) * opacity));
  const glow = ctlValue(p.glow, 0.2) * RIDE_GLOW_STRENGTH;
  for (const m of p.materials) { m.opacity = o; m.emissiveIntensity = glow; }
  return o;
}

/**
 * Makes `cloud` (a sibling of `coco` under the same parent) follow Coco's root bone: call capture()
 * while he is in his rest pose (before any clip has posed him), then follow() every frame after his
 * clips have been applied.
 */
export function createRootFollow(coco: Object3D, cloud: Object3D) {
  const bone = coco.getObjectByName(ROOT_BONE) ?? null;
  const restInv = new Matrix4();
  const now = new Matrix4();
  const toCoco = new Matrix4();
  let captured = false;
  cloud.matrixAutoUpdate = false;
  const relative = (out: Matrix4) => {
    coco.updateWorldMatrix(true, false);
    bone!.updateWorldMatrix(true, false);
    toCoco.copy(coco.matrixWorld).invert();
    return out.multiplyMatrices(toCoco, bone!.matrixWorld);
  };
  return {
    bone,
    capture() {
      if (!bone) return;
      restInv.copy(relative(new Matrix4())).invert();
      captured = true;
    },
    /** The bone's rest (in Coco's own space), measured earlier, before any clip posed him. */
    captureFrom(rest: Matrix4) {
      if (!bone) return;
      restInv.copy(rest).invert();
      captured = true;
    },
    follow() {
      if (!bone || !captured) { cloud.matrix.copy(coco.matrix); cloud.matrixWorldNeedsUpdate = true; return; }
      relative(now).multiply(restInv);                  // the bone's movement from rest, in Coco's own space
      cloud.matrix.multiplyMatrices(coco.matrix, now);  // ... carried into the shared parent's space
      cloud.matrixWorldNeedsUpdate = true;
    },
  };
}
