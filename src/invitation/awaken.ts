// The welcome's awakening beat (Cassidy, 9 Nov 2026): once Adult Coco has arrived in the middle of the page he
// slowly opens his eyes from his deep slumber, looks at the visitor, closes them again and bows his head in
// honour; then the cloud glows and engulfs him as before. The movement is Blender's clip 'awaken' on his model
// (blender/scripts/coco_sage_life.py), layered on his breathing from the timeline's 'wake' marker; the markers
// 'gaze', 'eyesClose' and 'bow' follow it (build_coco_invite.py). Pure (no three.js), so it is tested in node.

import type { MarkerName, Timeline } from './timeline';

/**
 * If the clock has just passed 'wake' (it is among `crossed`), the time into the beat at master frame `frame`
 * (seconds, never negative): the clip starts from the moment the clock is at. Otherwise null.
 */
export function awakenStart(t: Timeline, crossed: MarkerName[], frame: number): number | null {
  const wake = t.markers.wake;
  if (wake === undefined || !crossed.includes('wake')) return null;
  return Math.max(0, (frame - wake) / t.fps);
}

/** Should the beat still be playing when the glow comes, it eases out over this long (it is authored to end before). */
export const AWAKEN_RELEASE_SECONDS = 0.6;

/** How long the beat lasts on the timeline (wake to glow), or 0 without one. */
export function awakenSeconds(t: Timeline): number {
  const wake = t.markers.wake;
  return wake === undefined ? 0 : Math.max(0, (t.markers.glow - wake) / t.fps);
}
