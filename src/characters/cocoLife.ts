// Adult Coco's living details on the site (coco-sage.glb, blender/scripts/coco_sage_life.py). Every movement is
// Blender's: the sun turns and breathes, the third eye blinks and his lids part on bones, in the clips 'radiance',
// 'thirdeye' and 'awaken'. What glTF cannot animate in three (r187 has no KHR_animation_pointer) travels as the X
// scale of four control bones, value = scale.x - 1, and is turned into material settings here, every frame:
//
//   ctl_sun    the sun's glow       emission × (1 + value)
//   ctl_bolt   the bolt's shimmer   emission × (1 + value)
//   ctl_eye    the third eye        its own emission × (1 + value) (a soft dim, then a glow, round each blink)
//   ctl_eyes   his open eyes        0 closed .. 1 open: the cards' alphaTest (see eyesCutoff)
//
// The sun and bolt keep the steady soft glow they always had (SUN_GLOW) at value 0. A model without these parts
// (an older coco-sage.glb) simply gets that steady glow, as before. Everything cloned here is restored on dispose.

import type { Material, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { meshesOf } from './sceneUtils';

/** The soft, steady glow of the sun and bolt behind him (a material setting; Blender's clip adds to it). */
export const SUN_GLOW = { colour: '#ffd98a', intensity: 0.45 } as const;
/** His living-detail clips (additive): two seamless loops everywhere he is, and the welcome's beat. */
export const LIFE_LOOPS = ['radiance', 'thirdeye'] as const;
export const AWAKEN = 'awaken';
/**
 * His open-eye cards' alpha (blender/scripts/prep_coco_eyes.py): EYES_ALPHA.max on his closed lid line, falling
 * to EYES_ALPHA.min at each eye's outline, 0 outside it. Above `rest` nothing shows.
 */
export const EYES_ALPHA = { max: 0.98, min: 0.05, rest: 0.99 } as const;
/** Below this opening the cards show nothing at all (he is exactly the sculpt's closed-eyed sage). */
export const EYES_SHUT = 0.005;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The cards' alphaTest for an opening `open` (0..1): a texel shows once the lids have parted past it. Shut, it
 * is above every texel. NaN or a missing control counts as shut.
 */
export function eyesCutoff(open: number): number {
  if (!(open > EYES_SHUT)) return EYES_ALPHA.rest;
  return EYES_ALPHA.max - (EYES_ALPHA.max - EYES_ALPHA.min) * clamp01(open);
}

/** A control bone's value (its X scale less 1), 0 when it is missing or not a number. */
export function ctlValue(node: Object3D | null | undefined): number {
  const v = node ? node.scale.x - 1 : 0;
  return Number.isFinite(v) ? v : 0;
}

/** An emission multiplier from a control value: never below 0. */
export const glowFactor = (value: number) => Math.max(0, 1 + value);

export interface CocoLife {
  /** Applies the control bones' values to the materials (call after the clips have posed him). */
  update(): void;
  /** How far his eyes are open now (0..1). */
  open(): number;
  dispose(): void;
}

/** Finds his living parts under `scene` and gives them their own materials (restored on dispose). */
export function createCocoLife(scene: Object3D): CocoLife {
  const restore: [Mesh, Material | Material[]][] = [];
  const made: Material[] = [];
  const own = (m: Mesh, setup: (c: MeshStandardMaterial, name: string) => void) => {
    restore.push([m, m.material]);
    const copy = (mat: Material) => {
      const c = mat.clone() as MeshStandardMaterial;
      setup(c, mat.name);
      made.push(c);
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(copy) : copy(m.material);
  };
  const sun: MeshStandardMaterial[] = [];
  const bolt: MeshStandardMaterial[] = [];
  const third: { mat: MeshStandardMaterial; base: number }[] = [];
  const eyes: MeshStandardMaterial[] = [];

  // the sun and bolt: the steady soft glow they always had (the bolt on its own material when the model has one)
  const sunNode = scene.getObjectByName('sun_bolt');
  if (sunNode) {
    for (const m of meshesOf(sunNode)) {
      own(m, (c, name) => {
        if (!c.emissive) return;
        c.emissive.set(SUN_GLOW.colour);
        c.emissiveMap = c.map ?? null;
        c.emissiveIntensity = SUN_GLOW.intensity;
        (name === 'bolt' ? bolt : sun).push(c);
      });
    }
  }
  // the third eye (its own material on the face) and the open-eye cards
  scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => x?.name === 'third_eye')) {
      own(m, (c, name) => { if (name === 'third_eye') third.push({ mat: c, base: c.emissiveIntensity }); });
    }
    if (mats.some((x) => x?.name === 'coco_eyes')) {
      own(m, (c, name) => {
        if (name !== 'coco_eyes') return;
        c.alphaTest = EYES_ALPHA.rest;
        c.alphaToCoverage = true;          // the parting edge is smoothed by the canvas's multisampling
        c.transparent = false;
        eyes.push(c);
      });
    }
  });
  const ctl = {
    sun: scene.getObjectByName('ctl_sun'),
    bolt: scene.getObjectByName('ctl_bolt'),
    eye: scene.getObjectByName('ctl_eye'),
    eyes: scene.getObjectByName('ctl_eyes'),
  };
  let opened = 0;

  return {
    update() {
      const s = SUN_GLOW.intensity * glowFactor(ctlValue(ctl.sun));
      for (const m of sun) m.emissiveIntensity = s;
      const b = SUN_GLOW.intensity * glowFactor(ctlValue(ctl.bolt));
      for (const m of bolt) m.emissiveIntensity = b;
      const e = glowFactor(ctlValue(ctl.eye));
      for (const t of third) t.mat.emissiveIntensity = t.base * e;
      opened = clamp01(ctlValue(ctl.eyes));
      const cut = eyesCutoff(opened);
      for (const m of eyes) m.alphaTest = cut;
    },
    open: () => opened,
    dispose() {
      for (const [m, mat] of restore) m.material = mat;
      made.forEach((m) => m.dispose());
      restore.length = 0;
      made.length = 0;
    },
  };
}
