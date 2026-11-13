import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain JS module shared with the build script
import { checkRegistry, applyRegistry } from '../scripts/lib/registry.mjs';

type Entry = { id: string; name: string; demo?: string | null; portfolio: { works: string[]; show?: boolean } };
type Work = { slug: string; title: string; project?: string; action?: { url: string } };

const registry = JSON.parse(readFileSync(new URL('../registry/projects.json', import.meta.url), 'utf8'));
const generated = JSON.parse(readFileSync(new URL('../src/content/generated/content.json', import.meta.url), 'utf8'));
const works: Work[] = generated.works;

const minimal = () => ({
  projects: [{ id: 'alpha', name: 'Alpha', repo: { url: 'https://github.com/x/alpha', branch: 'main' }, stage: 'beta', portfolio: { works: ['alpha'], integration: 'card-only' } }],
  otherProjects: { entries: [{ id: 'old', name: 'Old', kind: 'unsorted', portfolio: { works: ['old'], show: false } }] },
});

describe('project registry', () => {
  it('is sound', () => {
    expect(checkRegistry(registry)).toEqual([]);
  });

  it('lists the ten core projects (13 Nov 2026)', () => {
    expect(registry.projects.map((p: Entry) => p.name)).toEqual([
      'YOUrigin', 'YOU', 'Wandering', 'IntoTheLighthouse', 'Empatherapy', 'CommYOUnity', 'Atlantean Gardens', 'FreeTheDream', 'Kronk', 'Kronk Booth',
    ]);
    expect(registry.projects.find((p: Entry) => p.id === 'intothelighthouse').formerly).toBe('HOPEIUM');
  });

  it('keeps the excluded projects off the site', () => {
    const slugs = works.map((w) => w.slug);
    for (const slug of ['sweet-vital-nectar', 'wachuneed', 'my-living-youlogy']) expect(slugs).not.toContain(slug);
    const other = registry.otherProjects.entries.map((o: Entry) => o.id);
    for (const id of ['sweet-vital-nectar', 'kronk-marketplace', 'living-youlogy', 'rhythm-relics', 'creative-wellness']) expect(other).toContain(id);
  });

  it('gives every card on the site its owning project', () => {
    const ids = new Set([...registry.projects, ...registry.otherProjects.entries].map((e: Entry) => e.id));
    for (const w of works) expect(ids.has(w.project ?? '')).toBe(true);
    for (const p of registry.projects as Entry[]) for (const slug of p.portfolio.works) expect(works.find((w) => w.slug === slug)?.project).toBe(p.id);
  });

  it("agrees with each card's demo button, so the two cannot drift apart", () => {
    for (const p of registry.projects as Entry[]) {
      const work = works.find((w) => w.slug === p.portfolio.works[0]);
      if (!p.demo || !work?.action) continue;
      expect(work.action.url.startsWith(p.demo), `${p.name}: card button ${work.action.url} vs registry demo ${p.demo}`).toBe(true);
    }
  });

  it('refuses an unregistered card, and hides cards of hidden entries', () => {
    const out = applyRegistry([{ slug: 'alpha', title: 'Alpha' }, { slug: 'old', title: 'Old' }, { slug: 'stray', title: 'Stray' }], minimal());
    expect(out.works).toEqual([{ slug: 'alpha', title: 'Alpha', project: 'alpha' }]);
    expect(out.hidden.map((w: Work) => w.slug)).toEqual(['old']);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toMatch(/Stray.*not in registry/);
  });

  it('reports a card claimed twice, a bad stage and a hidden core project', () => {
    const reg = minimal();
    reg.otherProjects.entries[0].portfolio.works = ['alpha'];
    (reg.projects[0] as { stage: string }).stage = 'done';
    (reg.projects[0].portfolio as { show?: boolean }).show = false;
    const problems = checkRegistry(reg).join('\n');
    expect(problems).toMatch(/"alpha" is claimed by both/);
    expect(problems).toMatch(/"stage" must be one of/);
    expect(problems).toMatch(/always shown/);
  });
});
