// Asset paths shared by the page (no three.js here: the portfolio bundle must not pull in the 3D chunk).

/** Adult Coco, seated and meditating, with the sun and bolt behind him (Blender export). */
export const ADULT_URL = 'models/characters/coco-sage.glb';
/** Optional still of him (whole emblem, hero framing): the hero shows it while the model loads, and in lite mode it is his small corner companion. */
export const ADULT_POSTER = 'models/characters/coco-sage-poster.webp';

/** The invitation's files (Blender exports). Any of them may be missing: the page falls back. */
export const INVITATION = {
  young: 'models/invitation/little-coco-invite.glb',
  cloud: 'models/invitation/magic-cloud.glb',
  timeline: 'models/invitation/timeline.json',
  veilMatte: 'models/invitation/veil-matte.webp',
  veilCurve: 'models/invitation/veil.json',
  youngStill: 'models/invitation/young-still.webp',
};
