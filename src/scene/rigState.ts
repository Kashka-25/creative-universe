// Per-frame shared state inside the 3D scene (three.js types, so scene-only).

import { Vector3 } from 'three';

/**
 * Where the guide's cloud "lives" this frame: the centre of the scene during
 * the intro, the portfolio hero afterwards. Written by the Director, read by
 * the actor and the scenery.
 */
export const home = { pos: new Vector3(), scale: 1, visible: true };

/** World positions of parts of the guide, updated by the actor every frame. */
export const probe = {
  head: new Vector3(0, 0.9, 0),
  handL: new Vector3(0.1, 0.45, 0.2),
  handR: new Vector3(-0.1, 0.45, 0.2),
  body: new Vector3(0, 0.5, 0),
  /** World scale of the guide (1 in the intro, smaller when perched). */
  scale: 1,
};
