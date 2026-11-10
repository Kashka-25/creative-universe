import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error plain JS module shared with the build script
import { slugify, parseDataUri, imageSize, worksFromStarter, placeWorks, siteDemoFile } from '../scripts/lib/content-core.mjs';
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

  it('lists a work in other realms too with "alsoIn", and refuses unknown realms', () => {
    const realmIds = ['digital', 'music', 'art'];
    const w = [{ title: 'Two Homes', slug: 'two-homes', realm: 'digital', alsoIn: ['music', 'digital', 'music'] }];
    expect(placeWorks(w, {}, realmIds)).toEqual([]);
    expect(w[0].alsoIn).toEqual(['music']);
    const same = [{ title: 'One Home', slug: 'one-home', realm: 'digital', alsoIn: ['digital'] }];
    expect(placeWorks(same, {}, realmIds)).toEqual([]);
    expect(same[0]).not.toHaveProperty('alsoIn');
    const bad = [{ title: 'Lost', slug: 'lost', realm: 'digital', alsoIn: ['about'] }];
    expect(placeWorks(bad, {}, realmIds)[0]).toMatch(/unknown realm/);
  });

  it('the generated content lists Kronk in Digital and in Music', () => {
    const kronk = generated.works.find((x: { slug: string }) => x.slug === 'kronk');
    expect(kronk.realm).toBe('digital');
    expect(kronk.alsoIn).toEqual(['music']);
    expect(kronk.category).toBe('Collaboration');
  });

  it('places every starter work in a realm and refuses to guess', () => {
    const works = worksFromStarter(pack);
    expect(placeWorks(works, placement, ['digital', 'ventures', 'music', 'books', 'art'])).toEqual([]);
    const orphan = [{ title: 'Mystery', slug: 'mystery', collection: 'Unknown shelf' }];
    expect(placeWorks(orphan, placement, ['digital'])[0]).toMatch(/no realm/);
  });

  describe("YOUrigin's export: optional realm, slug and change notes", () => {
    const quiet = () => {};
    const exported = (extra: Record<string, unknown>[], top: Record<string, unknown> = {}) => ({
      format: 'yourigin-starter-portfolio',
      key: 'test-v1',
      source: 'yourigin',
      exportedAt: '2026-11-09T10:00:00.000Z',
      ...top,
      sections: [{ heading: 'Apps', projects: [
        { title: 'First One', description: 'One.', ...extra[0] },
        { title: 'Second One', description: 'Two.', ...extra[1] },
      ] }],
    });
    const collect = () => { const msgs: string[] = []; return { msgs, warn: (m: string) => msgs.push(m) }; };

    it('a pack without them imports exactly as before, with no warnings', () => {
      const { msgs, warn } = collect();
      const inPublic = (rel: string) => existsSync(new URL(`../public/${rel}`, import.meta.url));
      const plain = worksFromStarter(pack, warn, inPublic);
      expect(msgs).toEqual([]);
      for (const w of plain) {
        expect(w).not.toHaveProperty('realm');
        expect(w).not.toHaveProperty('changes');
        expect(w.slug).toBe(slugify(w.title));
      }
      // Adding the top-level export markers changes nothing.
      expect(worksFromStarter({ ...pack, source: 'yourigin', exportedAt: '2026-11-09T10:00:00.000Z' }, warn, inPublic)).toEqual(plain);
      expect(msgs).toEqual([]);
    });

    it('takes a valid realm, and placeWorks prefers it over the section', () => {
      const works = worksFromStarter(exported([{ realm: 'music' }, {}]), quiet);
      expect(works[0].realm).toBe('music');
      expect(works[1]).not.toHaveProperty('realm');
      expect(placeWorks(works, { bySection: { Apps: 'digital' } }, ['digital', 'music'])).toEqual([]);
      expect(works.map((w: { realm: string }) => w.realm)).toEqual(['music', 'digital']);
    });

    it('ignores an unknown realm with a warning and places by section', () => {
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([{ realm: 'about' }, { realm: 42 }]), warn);
      expect(works[0]).not.toHaveProperty('realm');
      expect(works[1]).not.toHaveProperty('realm');
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toMatch(/First One.*realm "about"/);
      placeWorks(works, { bySection: { Apps: 'digital' } }, ['digital']);
      expect(works[0].realm).toBe('digital');
    });

    it('takes a valid slug override', () => {
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([{ slug: 'the-first' }, { slug: 'second-one' }]), warn);
      expect(works.map((w: { slug: string }) => w.slug)).toEqual(['the-first', 'second-one']);
      expect(msgs).toEqual([]);
    });

    it('ignores a badly formed or colliding slug with a warning', () => {
      for (const bad of ['First One', 'first--one', '-first', 'Ünïcode', '', 7]) {
        const { msgs, warn } = collect();
        const works = worksFromStarter(exported([{ slug: bad }, {}]), warn);
        expect(works[0].slug).toBe('first-one');
        expect(msgs).toHaveLength(1);
      }
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([{ slug: 'second-one' }, {}]), warn);
      expect(works.map((w: { slug: string }) => w.slug)).toEqual(['first-one', 'second-one']);
      expect(msgs[0]).toMatch(/already used by "Second One"/);
    });

    it('keeps valid change notes verbatim, newest first', () => {
      const changes = [
        { date: '2026-10-01', text: 'Older note.' },
        { date: '2026-11-08', text: '  New home page, with *stars*.  ' },
        { date: '2026-11-08', text: 'Same day, second.' },
      ];
      const works = worksFromStarter(exported([{ changes }, {}]), quiet);
      expect(works[0].changes).toEqual([
        { date: '2026-11-08', text: '  New home page, with *stars*.  ' },
        { date: '2026-11-08', text: 'Same day, second.' },
        { date: '2026-10-01', text: 'Older note.' },
      ]);
      expect(works[1]).not.toHaveProperty('changes');
    });

    it('drops invalid change notes with a warning', () => {
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([{ changes: [
        { date: '2026-11-08', text: 'Kept.', extra: 'not copied' },
        { date: '8 Nov 2026', text: 'Bad date.' },
        { date: '2026-02-30', text: 'No such day.' },
        { date: '2026-11-07', text: '   ' },
        { date: '2026-11-07' },
        null,
      ] }, { changes: [{ date: 'soon', text: 'x' }] }]), warn);
      expect(works[0].changes).toEqual([{ date: '2026-11-08', text: 'Kept.' }]);
      expect(works[1]).not.toHaveProperty('changes');
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toMatch(/ignored 5 change note/);

      const notList = worksFromStarter(exported([{ changes: 'yesterday' }, {}]), warn);
      expect(notList[0]).not.toHaveProperty('changes');
    });

    // Clearly fake addresses only: real project links are supplied by each project.
    it('takes each kind of action', () => {
      for (const kind of ['visit', 'demo', 'vision']) {
        const { msgs, warn } = collect();
        const works = worksFromStarter(exported([{ action: { kind, url: 'https://example.test/app/', extra: 'dropped' } }, {}]), warn);
        expect(works[0].action).toEqual({ kind, url: 'https://example.test/app/' });
        expect(works[1]).not.toHaveProperty('action');
        expect(msgs).toEqual([]);
      }
    });

    it('a work with no action gets no button data', () => {
      const plain = worksFromStarter(exported([{ link: 'https://example.test/' }, {}]), quiet);
      for (const w of plain) {
        expect(w).not.toHaveProperty('action');
        expect(w).not.toHaveProperty('preview');
      }
    });

    it('rejects unknown kinds and non-http(s) URLs with a warning', () => {
      const bad = [
        { kind: 'buy', url: 'https://example.test/' },
        { kind: 'Visit', url: 'https://example.test/' },
        { kind: 'visit', url: 'javascript:alert(1)' },
        { kind: 'demo', url: 'ftp://example.test/file' },
        { kind: 'vision', url: '/work/local-page' },
        { kind: 'visit', url: 'https://' },
        { kind: 'visit' },
        'https://example.test/',
      ];
      for (const action of bad) {
        const { msgs, warn } = collect();
        const works = worksFromStarter(exported([{ action }, {}]), warn);
        expect(works[0]).not.toHaveProperty('action');
        expect(msgs).toHaveLength(1);
      }
    });

    it('takes a site-hosted demo under demos/ only when its file is in public/', () => {
      const files = new Set(['demos/fake-demo/index.html', 'demos/fake-demo/other.html']);
      const exists = (rel: string) => files.has(rel);
      expect(siteDemoFile('demos/fake-demo/')).toBe('demos/fake-demo/index.html');
      expect(siteDemoFile('demos/fake-demo/other.html')).toBe('demos/fake-demo/other.html');
      for (const url of ['demos/fake-demo/', 'demos/fake-demo/other.html']) {
        const { msgs, warn } = collect();
        const works = worksFromStarter(exported([{ action: { kind: 'demo', url } }, {}]), warn, exists);
        expect(works[0].action).toEqual({ kind: 'demo', url });
        expect(msgs).toEqual([]);
      }
      const refused = [
        'demos/missing-demo/', // no file in public/
        'demos/fake-demo', // a directory needs its trailing slash
        '/demos/fake-demo/',
        './demos/fake-demo/',
        'demos/../secrets/',
        'demos/fake-demo/../../x.html',
        'demos/fake-demo/.hidden',
        'demos/Fake Demo/',
        'demos/fake-demo/?q=1',
        'content/previews/fake.webp',
      ];
      for (const url of refused) {
        const { msgs, warn } = collect();
        const works = worksFromStarter(exported([{ action: { kind: 'demo', url } }, {}]), warn, exists);
        expect(works[0], url).not.toHaveProperty('action');
        expect(msgs).toHaveLength(1);
      }
      // Without a way to check public/, a site demo is refused rather than trusted.
      expect(worksFromStarter(exported([{ action: { kind: 'demo', url: 'demos/fake-demo/' } }, {}]), quiet)[0]).not.toHaveProperty('action');
    });

    it('takes the tour and idea kinds, including site-hosted pages', () => {
      const exists = (rel: string) => rel === 'demos/fake-tour/index.html';
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([
        { action: { kind: 'tour', url: 'demos/fake-tour/' } },
        { action: { kind: 'idea', url: 'https://example.test/idea/' } },
      ]), warn, exists);
      expect(works.map((w: { action: unknown }) => w.action)).toEqual([
        { kind: 'tour', url: 'demos/fake-tour/' },
        { kind: 'idea', url: 'https://example.test/idea/' },
      ]);
      expect(msgs).toEqual([]);
    });

    it('takes a short status label as written, and refuses long or multi-line ones', () => {
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([{ status: 'In construction' }, { status: 'building' }]), warn);
      expect(works.map((w: { status: string }) => w.status)).toEqual(['In construction', 'building']);
      expect(msgs).toEqual([]);
      for (const status of ['x'.repeat(33), 'Two\nlines', 42, '   ']) {
        const c = collect();
        const [w] = worksFromStarter(exported([{ status }, {}]), c.warn);
        expect(w).not.toHaveProperty('status');
        expect(c.msgs).toHaveLength(1);
      }
    });

    it('takes an invite only as mailto: to Cassidy\'s public address', () => {
      const ok = worksFromStarter(exported([{ invite: 'mailto:YourOwnUniverse.life@gmail.com' }, {}]), quiet);
      expect(ok[0].invite).toBe('mailto:YourOwnUniverse.life@gmail.com');
      expect(ok[1]).not.toHaveProperty('invite');
      for (const invite of ['mailto:someone@example.test', 'https://example.test/', 'YourOwnUniverse.life@gmail.com', 'mailto:YourOwnUniverse.life@gmail.com?bcc=x@example.test', true]) {
        const c = collect();
        const [w] = worksFromStarter(exported([{ invite }, {}]), c.warn);
        expect(w, String(invite)).not.toHaveProperty('invite');
        expect(c.msgs).toHaveLength(1);
      }
    });

    it('takes a preview gallery with and without a clip', () => {
      const images = [
        { src: 'content/previews/fake-1.webp', alt: 'Fake home screen' },
        { src: '/content/previews/fake-2.webp', alt: 'Fake settings' },
        { src: 'https://example.test/shot.png', alt: 'Fake web shot' },
      ];
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([
        { preview: { images } },
        { preview: { images: images.slice(0, 1), clip: { src: 'content/previews/fake.mp4', poster: 'content/previews/fake-poster.webp' } } },
      ]), warn);
      expect(msgs).toEqual([]);
      expect(works[0].preview).toEqual({ images: [
        { src: 'content/previews/fake-1.webp', alt: 'Fake home screen' },
        { src: 'content/previews/fake-2.webp', alt: 'Fake settings' },
        { src: 'https://example.test/shot.png', alt: 'Fake web shot' },
      ] });
      expect(works[0].preview).not.toHaveProperty('clip');
      expect(works[1].preview.clip).toEqual({ src: 'content/previews/fake.mp4', poster: 'content/previews/fake-poster.webp' });
    });

    it('keeps preview files under public/ and needs alt text and a poster', () => {
      const { msgs, warn } = collect();
      const works = worksFromStarter(exported([
        { preview: { images: [
          { src: '../secrets/shot.webp', alt: 'Escapes public/' },
          { src: 'C:\\shots\\a.webp', alt: 'Windows path' },
          { src: 'file:///shots/a.webp', alt: 'File URL' },
          { src: '//example.test/a.webp', alt: 'Protocol-relative' },
          { src: 'content/previews/no-alt.webp' },
          { src: 'content/previews/ok.webp', alt: 'Kept' },
        ], clip: { src: 'content/previews/fake.mp4' } } },
        { preview: { images: [{ src: '../x.webp', alt: 'x' }], clip: { src: 'javascript:x', poster: 'p.webp' } } },
      ]), warn);
      expect(works[0].preview).toEqual({ images: [{ src: 'content/previews/ok.webp', alt: 'Kept' }] });
      expect(works[1]).not.toHaveProperty('preview');
      expect(msgs.some((m) => /ignored 5 preview image/.test(m))).toBe(true);
      expect(msgs.some((m) => /clip needs/.test(m))).toBe(true);
    });
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
    const fromPack = generated.works.filter((w: { source: string }) => w.source.startsWith('starter:'));
    expect(fromPack.map((w: { title: string }) => w.title)).toEqual(
      pack.sections.flatMap((s: { projects: { title: string }[] }) => s.projects.map((p) => p.title)),
    );
    expect(generated.realms.map((r: { id: string }) => r.id)).toEqual(['digital', 'ventures', 'music', 'books', 'art', 'about']);
  });

  it('credits the artist of Coco’s portrait on About (Cassidy, 10 Nov 2026)', () => {
    expect(generated.about.portraitCredit).toEqual({ lead: 'Artwork by', label: '@starzillaa_', href: 'https://www.instagram.com/starzillaa_/' });
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
