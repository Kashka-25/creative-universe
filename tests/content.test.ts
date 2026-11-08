import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain JS module shared with the build script
import { slugify, parseDataUri, imageSize, worksFromStarter, placeWorks } from '../scripts/lib/content-core.mjs';
// @ts-expect-error plain JS module shared with the CLI
import { validateGuide, sanitizeName } from '../scripts/lib/guide-validate.mjs';

const pack = JSON.parse(readFileSync(new URL('../content/starter/cassidy-ventures.json', import.meta.url), 'utf8'));
const placement = JSON.parse(readFileSync(new URL('../content/placement.json', import.meta.url), 'utf8'));
const contract = JSON.parse(readFileSync(new URL('../contract/guide-contract.json', import.meta.url), 'utf8'));
const generated = JSON.parse(readFileSync(new URL('../src/content/generated/content.json', import.meta.url), 'utf8'));

describe('content pipeline', () => {
  it('slugifies titles', () => {
    expect(slugify("Chantilly's Tallow")).toBe('chantillys-tallow');
    expect(slugify('Ventures & Brands')).toBe('ventures-and-brands');
    expect(slugify('YOUrigin')).toBe('yourigin');
  });

  it('copies starter-pack fields verbatim, without inventing any', () => {
    const works = worksFromStarter(pack);
    const total = pack.sections.reduce((n: number, s: { projects: unknown[] }) => n + s.projects.length, 0);
    expect(works).toHaveLength(total);
    for (const s of pack.sections) {
      for (const p of s.projects) {
        const w = works.find((x: { title: string }) => x.title === p.title);
        expect(w.collection).toBe(s.heading);
        for (const f of ['category', 'colour', 'status', 'description', 'portfolioDescription', 'link']) expect(w[f]).toBe(p[f]);
      }
    }
  });

  it('places every starter work in a realm and refuses to guess', () => {
    const works = worksFromStarter(pack);
    expect(placeWorks(works, placement, ['digital', 'ventures', 'music', 'books', 'art'])).toEqual([]);
    const orphan = [{ title: 'Mystery', slug: 'mystery', collection: 'Unknown shelf' }];
    expect(placeWorks(orphan, placement, ['digital'])[0]).toMatch(/no realm/);
  });

  it('decodes cover images and reads their size', () => {
    const cover = pack.sections[0].projects[0].cover;
    const parsed = parseDataUri(cover);
    expect(parsed.ext).toBe('webp');
    expect(imageSize(parsed.bytes)).toEqual({ width: 1600, height: 900 });
  });

  it('the generated site content matches the starter pack', () => {
    expect(generated.owner.name).toBe(pack.ownerName);
    expect(generated.owner.intro).toBe(pack.intro);
    expect(generated.works.map((w: { title: string }) => w.title)).toEqual(
      pack.sections.flatMap((s: { projects: { title: string }[] }) => s.projects.map((p) => p.title)),
    );
    expect(generated.realms.map((r: { id: string }) => r.id)).toEqual(['digital', 'ventures', 'music', 'books', 'art', 'about']);
  });
});

describe('guide contract validation', () => {
  const complete = {
    nodes: [...contract.bones.required, ...contract.bones.optional],
    animations: [...contract.clips, ...contract.optionalClips, ...contract.gestures].map((c: { name: string; seconds: number }) => ({ name: c.name, duration: c.seconds })),
    morphs: [...contract.morphs.required, ...contract.morphs.optional],
    materials: Object.keys(contract.materials.optional),
    bytes: 2_000_000,
  };

  it('accepts a complete export', () => {
    expect(validateGuide(contract, complete)).toEqual({ errors: [], warnings: [] });
  });

  it('explains Blender ".L" bone names', () => {
    const nodes = complete.nodes.map((n: string) => n.replace(/_L$/, '.L'));
    const { errors } = validateGuide(contract, { ...complete, nodes });
    expect(errors.some((e: string) => e.includes('"upperarm.L" must be renamed "upperarm_L"'))).toBe(true);
    expect(sanitizeName('upperarm.L')).toBe('upperarmL');
  });

  it('reports missing clips, shape keys and an over-budget file', () => {
    const { errors } = validateGuide(contract, {
      ...complete,
      animations: complete.animations.filter((a: { name: string }) => a.name !== 'beckon'),
      morphs: [],
      bytes: 9_000_000,
    });
    expect(errors.join('\n')).toMatch(/beckon/);
    expect(errors.join('\n')).toMatch(/eyesClosed/);
    expect(errors.join('\n')).toMatch(/budget/);
  });
});
