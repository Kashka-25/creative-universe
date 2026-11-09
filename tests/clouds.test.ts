import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloudEnvelope, cloudPath, cloudSizes, hashSeed, overlaps, placeClouds, readCloudList, type Rect } from '../src/portfolio/cloudPlacement';

const FILES = [
  { width: 440, height: 262 }, { width: 440, height: 288 }, { width: 421, height: 440 },
  { width: 440, height: 336 }, { width: 440, height: 351 }, { width: 440, height: 309 },
];
const R = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

/** Some section layouts (the layer's px: the window's width, the section's height). */
const LAYOUTS: Record<string, { area: Rect; content: Rect[]; W: number }> = {
  // home hero at 1280: the words on the left, Coco's space on the right, a vine at the bottom left
  hero1280: { W: 1280, area: R(0, 0, 1265, 690), content: [
    R(64, 120, 620, 150), R(64, 160, 620, 240), R(64, 250, 600, 300), R(64, 310, 560, 420), R(64, 440, 250, 490), R(270, 440, 450, 490),
    R(660, 60, 1200, 650), R(30, 560, 250, 690),
  ] },
  // the realms at 1280: a heading, a line, and a two-column list of cards
  realms1280: { W: 1280, area: R(0, 0, 1265, 1400), content: [
    R(500, 40, 765, 90), R(470, 100, 795, 130),
    ...Array.from({ length: 6 }, (_, i) => R(i % 2 ? 640 : 64, 200 + Math.floor(i / 2) * 380, i % 2 ? 1200 : 620, 540 + Math.floor(i / 2) * 380)),
  ] },
  // a work page at 1920: one 980 px column in the middle
  work1920: { W: 1920, area: R(0, 0, 1905, 2200), content: [
    R(462, 20, 900, 44), R(462, 80, 1262, 300), R(462, 330, 1442, 900), R(462, 940, 1142, 1600), R(462, 1660, 1442, 1720),
  ] },
  // a phone: content from gutter to gutter, a gap between blocks
  phone390: { W: 390, area: R(0, 0, 390, 1800), content: [
    R(16, 0, 374, 300), R(16, 320, 374, 700), R(16, 900, 374, 1300), R(16, 1320, 374, 1800),
  ] },
  // no room anywhere
  full: { W: 1280, area: R(0, 0, 1280, 600), content: [R(0, 0, 1280, 600)] },
};

describe("Coco's swirl clouds in the sections", () => {
  const run = (seed: string, key: string, count = 3) => {
    const L = LAYOUTS[key];
    return placeClouds(seed, FILES, count, L.area, L.content, cloudSizes(L.W));
  };

  it('never sit behind content, at any point of their drift, and stay in their room', () => {
    for (const key of Object.keys(LAYOUTS)) {
      for (const seed of ['home:hero', 'home:realms', 'home:works', 'realm:music', 'realm:art', 'work:yourigin', 'work:you']) {
        const L = LAYOUTS[key];
        const pad = cloudSizes(L.W).pad;
        const p = run(seed, key);
        for (const c of p) {
          const e = cloudEnvelope(c);
          for (const r of L.content) expect(overlaps(e, { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad })).toBe(false);
          expect(e.left).toBeGreaterThanOrEqual(L.area.left);
          expect(e.right).toBeLessThanOrEqual(L.area.right);
          expect(e.top).toBeGreaterThanOrEqual(L.area.top);
          expect(e.bottom).toBeLessThanOrEqual(L.area.bottom);
        }
        for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(overlaps(cloudEnvelope(p[i]), cloudEnvelope(p[j]))).toBe(false);
      }
    }
  });

  it('show none where a section has no room', () => {
    expect(run('home:realms', 'full')).toEqual([]);
    expect(placeClouds('x', FILES, 3, R(0, 0, 60, 60), [], cloudSizes(1280))).toEqual([]);
  });

  it('find the room there is: the side gutters of a wide page, the gaps between blocks on a phone', () => {
    const wide = run('work:yourigin', 'work1920');
    expect(wide.length).toBe(3);
    for (const c of wide) expect(c.left + c.width <= 462 || c.left >= 1442).toBe(true);
    const phone = run('realm:music', 'phone390');
    expect(phone.length).toBeGreaterThan(0);
    for (const c of phone) {
      expect(c.width).toBeLessThanOrEqual(140);
      expect(c.top >= 700 && c.top + c.height <= 900).toBe(true);
    }
  });

  it('sit in the same places on every visit (seeded by the page and section), and differ between sections', () => {
    expect(run('home:realms', 'realms1280')).toEqual(run('home:realms', 'realms1280'));
    expect(hashSeed('home:realms')).toBe(hashSeed('home:realms'));
    const seeds = ['home:hero', 'home:realms', 'home:works', 'realm:music', 'realm:art', 'work:yourigin', 'about'];
    const firsts = new Set(seeds.map((s) => JSON.stringify(run(s, 'work1920')[0])));
    expect(firsts.size).toBe(seeds.length);
  });

  it('are a few, spread down the section, each a different still, at calm sizes, on a slow drift', () => {
    for (const seed of ['home:realms', 'realm:books', 'work:a', 'about']) {
      const p = run(seed, 'work1920');
      expect(p).toHaveLength(3);
      expect(new Set(p.map((c) => c.index)).size).toBe(3);
      const tops = p.map((c) => c.top + c.height / 2);
      expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(2200 / 3);   // spread, not bunched
      for (const c of p) {
        expect(c.width).toBeGreaterThanOrEqual(100);
        expect(c.width).toBeLessThanOrEqual(230);
        expect(c.duration).toBeGreaterThanOrEqual(22);                     // a very slow drift
        expect(c.delay).toBeLessThanOrEqual(0);                            // staggered, never waiting to start
        expect(Math.abs(c.dx)).toBeLessThanOrEqual(18);
        expect(Math.abs(c.dy)).toBeLessThanOrEqual(12);
        expect(Math.abs(c.tilt)).toBeLessThanOrEqual(3.5);
        expect(c.alpha).toBeLessThanOrEqual(0.8);
      }
    }
    expect(placeClouds('x', FILES.slice(0, 2), 3, LAYOUTS.work1920.area, [], cloudSizes(1920)).map((c) => c.index).every((i) => i >= 0 && i < 2)).toBe(true);
  });

  it('show nothing without stills (a missing or broken list)', () => {
    expect(placeClouds('home:realms', [], 2, LAYOUTS.work1920.area, [], cloudSizes(1920))).toEqual([]);
    expect(readCloudList(null)).toEqual([]);
    expect(readCloudList({ file: 'x' })).toEqual([]);
    expect(readCloudList([{ file: 'cloud-1.webp', width: 800, height: 500, kind: 'swirl' }, { file: '', width: 1, height: 1 }, { width: 2 }]))
      .toEqual([{ file: 'cloud-1.webp', width: 800, height: 500, kind: 'swirl' }]);
    expect(cloudPath('cloud-2.webp')).toBe('models/clouds/cloud-2.webp');
    expect(cloudPath('/models/clouds/cloud-2.webp')).toBe('models/clouds/cloud-2.webp');
  });

  it('are decorative backdrops: hidden from assistive technology, lazy, behind the content, no clicks, still under reduced motion', () => {
    const tsx = readFileSync(new URL('../src/portfolio/SkyClouds.tsx', import.meta.url), 'utf8');
    expect(tsx).toMatch(/className="sky-clouds" data-backdrop aria-hidden/);
    expect(tsx).toMatch(/alt=""/);
    expect(tsx).toMatch(/loading="lazy"/);
    expect(tsx).toMatch(/decoding="async"/);
    expect(tsx).toMatch(/onError=\{\(\) => setState\('missing'\)\}/);
    // placed from the section's measured content, again whenever the section or the window changes size
    expect(tsx).toMatch(/new ResizeObserver\(place\)/);
    expect(tsx).toMatch(/addEventListener\('resize', place\)/);
    expect(tsx).toMatch(/'\[data-guide-space\]'/);
    const css = readFileSync(new URL('../src/styles/portfolio.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.has-clouds \{ position: relative; isolation: isolate; \}/);
    expect(css).toMatch(/\.sky-clouds \{[^}]*z-index: -1;[^}]*pointer-events: none;/);
    expect(css).toMatch(/@keyframes cloud-drift \{[^}]*translate3d[^}]*\}[^}]*translate3d[^}]*rotate/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.sky-cloud \{ animation: none; \}/);
  });
});
