// The cloud veil's timing curve, authored in Blender and sampled into
// public/models/invitation/veil.json: { "fps": 60, "cover": [0 … 1], "reveal": [ … ] }.
// "cover" is how much of the screen the cloud has reached at each frame. "reveal" runs the
// other way; it may be written as coverage (1 → 0) or as the share revealed (0 → 1), and both
// read the same here. The curve is made for the Blender matte, so it shapes the cloud only when the
// matte is in use; otherwise an eased default stands in. Pure, tested in node.
//
// The ends are pinned: the cover always arrives at exactly 1 (the controller holds 1 once covered)
// and the reveal runs from exactly 1 to exactly 0 (nothing pops at either end). The cover's start is
// kept as authored, since it was timed to match the 3D cloud on the matte.

export interface VeilCurve {
  fps: number;
  /** Coverage while the cloud fills the screen, ending at exactly 1. */
  cover: number[];
  /** Coverage while it clears, from exactly 1 to exactly 0. */
  reveal: number[];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const isSamples = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** A falling curve rescaled to run from exactly 1 to exactly 0; null if it does not fall. */
function pinFall(samples: number[]): number[] | null {
  const a = samples[0], b = samples[samples.length - 1];
  return a > b ? samples.map((v) => clamp01((v - b) / (a - b))) : null;
}

export function parseVeilCurve(raw: unknown): VeilCurve | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const fps = typeof r.fps === 'number' && r.fps > 0 ? r.fps : null;
  if (!fps || !isSamples(r.cover)) return null;
  let cover = r.cover.map(clamp01);
  if (cover[0] > cover[cover.length - 1]) cover = cover.map((v) => 1 - v);       // written as "share still clear"
  const c0 = cover[0], cN = cover[cover.length - 1];
  if (!(cN > c0)) return null;                                                    // flat: it would never cover
  // the start as authored, the end pinned to 1
  cover = cover.map((v) => clamp01(c0 + ((v - c0) * (1 - c0)) / (cN - c0)));
  let reveal = isSamples(r.reveal) ? r.reveal.map(clamp01) : [...cover].reverse();
  if (reveal[0] < reveal[reveal.length - 1]) reveal = reveal.map((v) => 1 - v);  // written as "share revealed"
  // from exactly 1 to exactly 0 (a flat reveal is no reveal: the cover, backwards, stands in)
  return { fps, cover, reveal: pinFall(reveal) ?? pinFall([...cover].reverse())! };
}

export const curveSeconds = (samples: number[], fps: number) => (samples.length - 1) / fps;

/** Linear sampling of a curve at u in 0..1 of its length. */
export function sampleCurve(samples: number[], u: number): number {
  if (samples.length === 0) return 0;
  const x = clamp01(u) * (samples.length - 1);
  const i = Math.floor(x);
  if (i >= samples.length - 1) return samples[samples.length - 1];
  const f = x - i;
  return samples[i] + (samples[i + 1] - samples[i]) * f;
}

/** The default curve: a gentle ease in and out, with no hard start or stop. */
export const easeInOut = (u: number) => {
  const x = clamp01(u);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
};

/** Default lengths when neither veil.json nor the timeline says. */
export const DEFAULT_COVER_SECONDS = 0.9;
export const DEFAULT_REVEAL_SECONDS = 1.1;
