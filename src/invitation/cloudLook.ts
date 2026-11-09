// How the magic cloud is drawn while it grows out of the cloud in his hands (part of Adult Coco's
// own model, drawn exactly as authored). Pure material settings (three's materials work without
// WebGL), shared by InvitationStage and its tests. Code never hides or thins him or his cloud.
//
//   magic cloud  transparent, drawn after him, tested against his depth but not writing its own,
//                pulled a hair towards the camera so where it starts on his cloud's surface it wins
//                cleanly instead of shimmering.
//   its depth    a depth-only copy of the magic cloud (same geometry, skeleton and morphs, same
//                offset) is drawn first, among the opaque things, after him. The magic cloud then
//                shows only its nearest surface at any opacity: its far side never shows through as
//                it fades in (a hollow shell), and a far lump never paints over a near one. He is
//                drawn before it, so it never hides him.

import { MeshBasicMaterial, type Material, type MeshStandardMaterial } from 'three';

/** Draw order: him (0), the magic cloud's depth, then the magic cloud over it (never by a stale sort key). */
export const CLOUD_DEPTH_ORDER = 1.5;
export const CLOUD_ORDER = 2;
/** The magic cloud's glow colour (turquoise → white); its strength comes from Blender's ctl_glow. */
export const CLOUD_GLOW = '#96ebfb';

/** The magic cloud's own copy of its material (see the top). */
export function magicCloudLook(m: MeshStandardMaterial): MeshStandardMaterial {
  if (m.emissive) { m.emissive.set(CLOUD_GLOW); m.emissiveIntensity = 0; }
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  return m;
}

/** The material of the magic cloud's depth-only copy (see the top): writes depth, never colour. */
export function magicCloudDepthLook(visible: Material): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.name = `${visible.name}:depth`;
  m.colorWrite = false;
  m.depthWrite = true;
  m.depthTest = true;
  m.transparent = false;
  m.side = visible.side;
  m.polygonOffset = visible.polygonOffset;
  m.polygonOffsetFactor = visible.polygonOffsetFactor;
  m.polygonOffsetUnits = visible.polygonOffsetUnits;
  return m;
}
