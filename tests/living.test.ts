import { describe, expect, it } from 'vitest';
import { motionAt, nextOffer, offerEnvelope, OFFER_EVERY, OFFER_SECONDS } from '../src/living/motion';
import layout from '../public/art/living/layers.json';

describe('living painting motion', () => {
  it('stays subtle: the head tilts less than a degree and a half', () => {
    let maxTilt = 0;
    for (let t = 0; t < 60; t += 0.05) maxTilt = Math.max(maxTilt, Math.abs(motionAt(t, null).tilt));
    expect(maxTilt).toBeLessThan((1.5 * Math.PI) / 180);
  });

  it('breathes, and the cloud offering rises, holds and settles back to rest', () => {
    const breaths = [0, 1, 2, 3].map((t) => motionAt(t, null).breath);
    expect(Math.max(...breaths) - Math.min(...breaths)).toBeGreaterThan(1);
    expect(offerEnvelope(0)).toBe(0);
    expect(offerEnvelope(2)).toBe(1);
    expect(offerEnvelope(OFFER_SECONDS)).toBeCloseTo(0, 5);
    expect(offerEnvelope(OFFER_SECONDS + 1)).toBe(0);
    expect(motionAt(10, 8).lift).toBe(1);
  });

  it('offers soon after he appears, then only now and then', () => {
    expect(nextOffer(0.5, null)).toBe(false);
    expect(nextOffer(1.3, null)).toBe(true);
    expect(nextOffer(5, 1.3)).toBe(false);
    expect(nextOffer(1.3 + OFFER_EVERY, 1.3)).toBe(true);
  });

  it('keeps the third-eye glow within range', () => {
    for (let t = 0; t < 30; t += 0.1) {
      const g = motionAt(t, t > 10 ? 10 : null).glow;
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it('has the painting landmarks the warp needs, inside the painting', () => {
    for (const p of [layout.thirdEye, layout.neck, layout.sun, layout.head.c, layout.chest.c, layout.hands.c]) {
      expect(p[0]).toBeGreaterThan(0); expect(p[0]).toBeLessThan(1);
      expect(p[1]).toBeGreaterThan(0); expect(p[1]).toBeLessThan(1);
    }
    // his head is above his chest, his hands below
    expect(layout.head.c[1]).toBeLessThan(layout.chest.c[1]);
    expect(layout.hands.c[1]).toBeGreaterThan(layout.chest.c[1]);
  });
});
