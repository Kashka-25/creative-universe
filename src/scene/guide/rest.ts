// The guide's rest pose: each bone's position relative to its parent, standing,
// in the character's own axes (+X his left, +Y up, +Z towards the camera).
// Shared by the stand-in (proceduralGuide.ts), the clip baker
// (proceduralClips.ts) and the Blender build (scripts/export-guide-clips.ts ->
// blender/scripts/build_guide.py), so every version of him has the same bones.

type V3 = [number, number, number];

/**
 * Rest positions relative to the parent bone (standing pose), metres. Eyes are placed on the face below.
 * Proportions follow the painting: a small head on a long, heavy body with big limbs (8 Nov 2026 fit).
 */
export const REST: Record<string, V3> = {
  root: [0, 0, 0],
  hips: [0, 0.6, 0],
  spine: [0, 0.15, 0],
  chest: [0, 0.27, 0],
  neck: [0, 0.1, 0.01],
  head: [0, 0.04, 0],
  eye_L: [0.08, 0.176, 0.17],
  eye_R: [-0.08, 0.176, 0.17],
  beanie: [0, 0.41, -0.01],
  upperarm_L: [0.25, 0.04, 0],
  forearm_L: [0, -0.25, 0],
  hand_L: [0, -0.23, 0],
  fingers_L: [0, -0.08, 0],
  thumb_L: [0, -0.03, 0.04],
  upperarm_R: [-0.25, 0.04, 0],
  forearm_R: [0, -0.25, 0],
  hand_R: [0, -0.23, 0],
  fingers_R: [0, -0.08, 0],
  thumb_R: [0, -0.03, 0.04],
  thigh_L: [0.11, -0.03, 0],
  shin_L: [0, -0.27, 0],
  foot_L: [0, -0.23, 0],
  thigh_R: [-0.11, -0.03, 0],
  shin_R: [0, -0.27, 0],
  foot_R: [0, -0.23, 0],
};
