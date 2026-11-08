// The living painting's movement, as plain numbers over time. Pure, so it is
// tested on its own and the renderer only draws what this decides.
//
//   breath   slow rise and fall of his chest and shoulders (-1..1)
//   tilt     small head tilt about his neck, radians
//   nod      tiny head dip, as a fraction of the painting's height
//   lift     the cloud-offering: his hands raise the cloud a little (0..1)
//   glow     third-eye glow (0..1)
//   sun      the sun breathing (-1..1)

export interface Motion { breath: number; tilt: number; nod: number; lift: number; glow: number; sun: number }

const TAU = Math.PI * 2;
export const BREATH_SECONDS = 4.6;
/** One cloud-offering: rise, hold, settle. */
export const OFFER_SECONDS = 4.2;
/** A quiet offering repeats this often, unless the visitor prompts one sooner. */
export const OFFER_EVERY = 14;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** 0..1..0 envelope of one offering, `s` seconds after it began. */
export function offerEnvelope(s: number) {
  if (s < 0 || s > OFFER_SECONDS) return 0;
  if (s < 1.3) return smooth(s / 1.3);          // rise, unhurried
  if (s < 2.6) return 1;                        // hold: here, this is for you
  return 1 - smooth((s - 2.6) / 1.6);           // settle back
}

/**
 * @param t seconds since the painting came alive
 * @param offeredAt when the latest offering started (seconds, same clock), or null
 */
export function motionAt(t: number, offeredAt: number | null): Motion {
  const breath = Math.sin((TAU * t) / BREATH_SECONDS);
  const tilt = 0.011 * Math.sin((TAU * t) / 7.3) + 0.004 * Math.sin((TAU * t) / 3.1 + 1.3);
  const nod = 0.0018 * Math.sin((TAU * t) / 5.7 + 0.7) + 0.0012 * Math.max(0, breath);
  const lift = offeredAt === null ? 0 : offerEnvelope(t - offeredAt);
  const glow = 0.45 + 0.18 * Math.sin((TAU * t) / 6.2) + 0.45 * lift;
  const sun = Math.sin((TAU * t) / 9);
  return { breath, tilt, nod, lift, glow: Math.min(1, glow), sun };
}

/** When the next offering is due: the first a moment after he appears, then every OFFER_EVERY seconds. */
export function nextOffer(t: number, last: number | null) {
  if (last === null) return t >= 1.2;
  return t - last >= OFFER_EVERY;
}
