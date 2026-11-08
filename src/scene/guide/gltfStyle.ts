// Gives the Blender guide the painting's look on the site: the same banded toon
// shading and hand-inked outline as the stand-in, keeping the GLB's textures.
// Material names come from the contract (third_eye, gold_jewellery) or the
// Blender build (fur, fur_strands, face, skin...), so effects stay attached.

import {
  DoubleSide, Mesh, MeshStandardMaterial, SkinnedMesh, type Material, type Object3D,
} from 'three';
import { furToonGradient, outlineMaterial, PALETTE, toon } from './toon';

/** Parts that get an inked outline (small details like lashes and eyes don't). */
const OUTLINED = new Set(['fur', 'face', 'skin', 'hat', 'hat_cuff', 'dungarees']);
const OUTLINE_WIDTH = 0.0045;

function toToon(m: Material): Material {
  const src = m as MeshStandardMaterial;
  if (!src.isMeshStandardMaterial) return m;
  const fur = src.name === 'fur' || src.name === 'fur_strands';
  const out = toon(src.color, {
    map: src.map ?? null,
    emissive: src.emissive,
    emissiveIntensity: src.emissiveIntensity,
    side: src.name === 'fur_strands' ? DoubleSide : src.side,
    ...(fur ? { gradientMap: furToonGradient() } : {}),
  });
  if (src.name === 'gold_jewellery') {
    out.color.set(PALETTE.gold);
    out.emissive.set(PALETTE.goldDeep);
    out.emissiveIntensity = 0.3;
  }
  out.name = src.name;
  return out;
}

/** Converts materials in place and adds outline hulls that follow the skin and face shapes. */
export function stylizeGuide(root: Object3D) {
  const cache = new Map<Material, Material>();
  const hulls: [Object3D, Mesh][] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.userData.isOutline) return;
    const swap = (m: Material) => {
      let t = cache.get(m);
      if (!t) { t = toToon(m); cache.set(m, t); }
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    const name = (mesh.material as Material).name;
    if (!OUTLINED.has(name)) return;
    const skinned = mesh as SkinnedMesh;
    const hull = skinned.isSkinnedMesh
      ? new SkinnedMesh(mesh.geometry, outlineMaterial(OUTLINE_WIDTH))
      : new Mesh(mesh.geometry, outlineMaterial(OUTLINE_WIDTH));
    hull.name = `${mesh.name}__outline`;
    hull.userData.isOutline = true;
    hull.frustumCulled = false;
    if (mesh.morphTargetInfluences) {
      // share the array, so the outline closes its eyes with him
      hull.morphTargetInfluences = mesh.morphTargetInfluences;
      hull.morphTargetDictionary = mesh.morphTargetDictionary;
    }
    hulls.push([mesh, hull]);
  });
  for (const [mesh, hull] of hulls) {
    mesh.parent?.add(hull);
    hull.position.copy(mesh.position);
    hull.quaternion.copy(mesh.quaternion);
    hull.scale.copy(mesh.scale);
    const s = mesh as SkinnedMesh;
    if (s.isSkinnedMesh) (hull as SkinnedMesh).bind(s.skeleton, s.bindMatrix);
  }
  // Skinned meshes move far from their bind box when he flies; never cull him.
  root.traverse((o) => { if ((o as Mesh).isMesh) o.frustumCulled = false; });
  return root;
}
