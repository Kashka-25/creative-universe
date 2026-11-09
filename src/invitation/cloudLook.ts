// How the two clouds are drawn while the magic cloud grows out of the one he holds. Pure material
// settings (three's materials work without WebGL), shared by InvitationStage and its tests.
//
//   held cloud   his own small cloud, exactly as authored (opaque, writing depth), drawn after him.
//                Code never hides or thins it: under the magic cloud at full opacity it cannot be
//                seen anyway, and wherever it pokes out of the magic cloud it has to stay. If it
//                must vanish, Blender hides it in the take once the magic cloud contains it.
//   magic cloud  transparent, drawn after both, tested against their depth but not writing its own,
//                pulled a hair towards the camera so where it starts on the held cloud's surface it
//                wins cleanly instead of shimmering.
//   its depth    a depth-only copy of the magic cloud (same geometry, skeleton and morphs, same
//                offset) is drawn first, among the opaque things, after him and the held cloud. The
//                magic cloud then shows only its nearest surface at any opacity: its far side never
//                shows through as it fades in (a hollow shell), and a far lump never paints over a
//                near one. Him and the held cloud are drawn before it, so it never hides them.

import { MeshBasicMaterial, type Material, type MeshStandardMaterial } from 'three';

/** Draw order: him (0), the held cloud, the magic cloud's depth, then the magic cloud over it (never by a stale sort key). */
export const HELD_ORDER = 1;
export const CLOUD_DEPTH_ORDER = 1.5;
export const CLOUD_ORDER = 2;
/** The clouds' glow colour (turquoise → white); its strength comes from Blender's ctl_glow. */
export const CLOUD_GLOW = '#96ebfb';

/** The held cloud's own copy of its material: as authored, plus the glow colour (dark until it glows). */
export function heldCloudLook(m: MeshStandardMaterial): MeshStandardMaterial {
  if (m.emissive) { m.emissive.set(CLOUD_GLOW); m.emissiveIntensity = 0; }
  return m;
}

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
