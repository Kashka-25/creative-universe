// Gives the Blender guide the painting's look on the site: the same banded toon
// shading and hand-inked outline as the stand-in, keeping the GLB's textures.
// Material names come from the contract (third_eye, gold_jewellery) or the
// Blender build (fur, fur_strands, face, skin...), so effects stay attached.

import {
  DataTexture, DoubleSide, Mesh, MeshStandardMaterial, NearestFilter, RedFormat, SkinnedMesh, type Material, type Object3D,
} from 'three';
import { furToonGradient, outlineMaterial, PALETTE, toon } from './toon';

/** Parts that get an inked outline (small details like lashes and eyes don't). */
const OUTLINED = new Set(['fur', 'face', 'skin', 'hat', 'hat_cuff', 'dungarees']);
const OUTLINE_WIDTH = 0.0045;

/** Parts painted from Cassidy's painting (blender/scripts/paint_from_reference.py) are named like `fur__guide_body`. */
const baseName = (name: string) => name.split('__')[0];
const PAINTED = new Set(['face', 'fur', 'fur_strands', 'skin', 'skin_shade', 'hat', 'hat_cuff', 'dungarees']);

let paintedGradient: DataTexture | null = null;
/** The painting already holds its own light and shade, so painted parts get only a gentle lift and fall. */
function gentleGradient() {
  if (paintedGradient) return paintedGradient;
  paintedGradient = new DataTexture(new Uint8Array([185, 222, 248, 255]), 4, 1, RedFormat);
  paintedGradient.minFilter = NearestFilter;
  paintedGradient.magFilter = NearestFilter;
  paintedGradient.generateMipmaps = false;
  paintedGradient.needsUpdate = true;
  return paintedGradient;
}

function toToon(m: Material): Material {
  const src = m as MeshStandardMaterial;
  if (!src.isMeshStandardMaterial) return m;
  const name = baseName(src.name);
  const painted = PAINTED.has(name) && !!src.map;
  const fur = name === 'fur' || name === 'fur_strands';
  const out = toon(src.color, {
    map: src.map ?? null,
    emissive: src.emissive,
    emissiveIntensity: src.emissiveIntensity,
    side: name === 'fur_strands' ? DoubleSide : src.side,
    ...(painted ? { gradientMap: gentleGradient() } : fur ? { gradientMap: furToonGradient() } : {}),
  });
  if (painted) {
    // Show the painting's own colours (emissive), with a little of the stage light on top for form.
    out.color.setScalar(0.34);
    out.emissive.set('#ffffff');
    out.emissiveMap = src.map ?? null;
    out.emissiveIntensity = 0.8;
  }
  if (name === 'gold_jewellery') {
    out.color.set(PALETTE.gold);
    out.emissive.set(PALETTE.goldDeep);
    out.emissiveIntensity = 0.3;
  }
  out.name = name;
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
