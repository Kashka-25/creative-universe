// Small three.js helpers shared by the invitation's take and home's Adult Coco. Only the 3D chunks
// import this (it pulls in three). Nothing here does per-vertex work on skinned meshes: measuring
// a posed skinned mesh walks every vertex on the CPU (tens of ms on a 70k-vertex character), so
// boxes come from the geometry's stored bounds (the bind pose) or from bone positions instead.

import { Box3, Vector3, type Camera, type Material, type Mesh, type Object3D, type SkinnedMesh, type Texture, type WebGLRenderer } from 'three';

export const meshesOf = (root: Object3D) => {
  const out: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
  return out;
};

export const materialsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

export const texturesOf = (m: Material) =>
  Object.values(m as unknown as Record<string, unknown>).filter((v): v is Texture => !!v && (v as Texture).isTexture === true);

/** Every texture used under `root`. */
export function texturesUnder(root: Object3D): Set<Texture> {
  const out = new Set<Texture>();
  for (const m of meshesOf(root)) materialsOf(m).forEach((mat) => texturesOf(mat).forEach((t) => out.add(t)));
  return out;
}

/**
 * Skinned meshes are never culled. three measures a skinned mesh's bounding sphere once, in
 * whatever pose it is in when first drawn, and never again; with root motion (he floats in from
 * off-screen) that stale sphere would hide him.
 *
 * Not culling does not stop three measuring it: it still wants the sphere to sort the mesh, and
 * measuring a posed skinned mesh skins every vertex on the CPU. So each one is given its bind-pose
 * sphere now (from the stored positions, no skinning). It is only a sort key; transparent parts
 * that must draw in a set order get an explicit renderOrder instead.
 */
export function neverCullSkinned(root: Object3D) {
  root.traverse((o) => {
    const s = o as SkinnedMesh;
    if (!s.isSkinnedMesh) return;
    s.frustumCulled = false;
    if (!s.boundingSphere) {
      if (!s.geometry.boundingSphere) s.geometry.computeBoundingSphere();
      if (s.geometry.boundingSphere) s.boundingSphere = s.geometry.boundingSphere.clone();
    }
  });
}

/**
 * Draws everything under `roots` once, unseen (call it only while the canvas is invisible), so the
 * costs of a first draw land now and not on a moving frame: vertex and index buffer uploads, morph
 * target textures, sort bounds. Every object is shown and never culled for that one frame, then
 * put back exactly as it was.
 */
export function drawOnce(gl: WebGLRenderer, scene: Object3D, camera: Camera, roots: Object3D[]) {
  const saved: [Object3D, boolean, boolean][] = [];
  for (const root of roots) {
    root.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
  }
  try {
    gl.render(scene, camera);
  } finally {
    for (const [o, visible, culled] of saved) { o.visible = visible; o.frustumCulled = culled; }
  }
}

const _box = new Box3();
const _v = new Vector3();

/**
 * A cheap world-space box of one mesh: plain meshes from their stored geometry bounds, skinned
 * meshes from where their bones are now (no per-vertex skinning).
 */
export function cheapMeshBox(m: Mesh, out: Box3): Box3 {
  const s = m as SkinnedMesh;
  if (s.isSkinnedMesh && s.skeleton?.bones.length) {
    for (const b of s.skeleton.bones) out.expandByPoint(b.getWorldPosition(_v));
    return out;
  }
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  if (m.geometry.boundingBox) out.union(_box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld));
  return out;
}

/** Cheap world-space box of everything visible under `root` (see cheapMeshBox). */
export function cheapBox(root: Object3D, out = new Box3()): Box3 {
  root.updateWorldMatrix(true, true);
  out.makeEmpty();
  root.traverseVisible((o) => { if ((o as Mesh).isMesh) cheapMeshBox(o as Mesh, out); });
  return out;
}

/**
 * World-space box of `root` in its REST pose: each mesh's stored geometry bounds (for a skinned
 * mesh that is its bind pose) placed by its world matrix. A linear pass over positions at most
 * once per geometry, never skinning. `skip` leaves out a subtree (e.g. the sun behind him).
 */
export function restBox(root: Object3D, out = new Box3(), skip?: Object3D | null): Box3 {
  root.updateWorldMatrix(true, true);
  out.makeEmpty();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (skip) for (let p: Object3D | null = m; p; p = p.parent) if (p === skip) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox) out.union(_box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld));
  });
  return out;
}

/** Whether any part of a world box shows in the camera's view. Pure (tested in node). */
export function boxShows(box: Box3, camera: Camera): boolean {
  if (box.isEmpty()) return false;
  camera.updateMatrixWorld();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let behind = 0;
  const v = new Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    if (v.clone().applyMatrix4(camera.matrixWorldInverse).z > 0) behind++;
    v.project(camera);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  if (behind === 8) return false;
  return maxX > -1 && minX < 1 && maxY > -1 && minY < 1;
}

/**
 * Frees everything under `root` for good (geometries, materials, textures): the GPU side, and the
 * decoded images too. GLTFLoader decodes textures into ImageBitmaps, which are not freed by
 * dropping them (three's GLTFLoader notes this): each is closed. Only for models being thrown away.
 */
export function disposeTree(root: Object3D) {
  const closeImage = (t: Texture) => {
    const img = (t.source?.data ?? t.image) as { close?: () => void } | null | undefined;
    if (img && typeof img.close === 'function') img.close();
  };
  for (const m of meshesOf(root)) {
    m.geometry.dispose();
    materialsOf(m).forEach((mat) => { texturesOf(mat).forEach((t) => { t.dispose(); closeImage(t); }); mat.dispose(); });
  }
}

/**
 * Uploads textures to the GPU one per animation frame (a 2048² upload can take a frame on its
 * own), so warming up never freezes the page. Resolves when all are up, or at once if cancelled.
 * While `hold()` is true nothing is uploaded (something on screen must not be interrupted).
 */
export function uploadGradually(gl: WebGLRenderer, textures: Iterable<Texture>, cancelled: () => boolean, hold: () => boolean = () => false): Promise<void> {
  const queue = [...textures];
  return new Promise((resolve) => {
    const step = () => {
      if (cancelled()) { resolve(); return; }
      if (hold()) { requestAnimationFrame(step); return; }
      const t = queue.shift();
      if (!t) { resolve(); return; }
      try { gl.initTexture(t); } catch { /* an unusable texture only costs a hitch later */ }
      requestAnimationFrame(step);
    };
    step();
  });
}
