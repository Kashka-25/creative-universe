// Asset paths shared by the page (no three.js here: the portfolio bundle must not pull in the 3D chunk).

/** Adult Coco, seated and meditating, with the sun and bolt behind him (Blender export). */
export const ADULT_URL = 'models/characters/coco-sage.glb';
/** Optional still of him (whole emblem, hero framing): the hero shows it while the model loads, and in lite mode it is his small corner companion. */
export const ADULT_POSTER = 'models/characters/coco-sage-poster.webp';

/** The swirl cloud he rides on (Blender export: the welcome's ride, a resting loop and the flight to a new space). */
export const RIDE_CLOUD_URL = 'models/clouds/ride-cloud.glb';

/** The invitation's files (Blender exports). Any of them may be missing: the page falls back. */
export const INVITATION = {
  /** Adult Coco's take: his skeleton and the clip 'invite' only, played on ADULT_URL (the same rig). */
  take: 'models/invitation/coco-invite.glb',
  cloud: 'models/invitation/magic-cloud.glb',
  timeline: 'models/invitation/timeline.json',
  veilMatte: 'models/invitation/veil-matte.webp',
  veilCurve: 'models/invitation/veil.json',
};
