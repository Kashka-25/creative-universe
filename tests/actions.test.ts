import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ActionButton, PreviewGallery } from '../src/portfolio/actions';
import { pageAction, type Work } from '../src/content';

// Clearly fake fixtures: real project links are supplied by each project.
const base: Work = { slug: 'fake-work', title: 'Fake Work', realm: 'digital', source: 'test' };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

describe('work action button', () => {
  it.each([
    ['visit', 'Visit'],
    ['demo', 'Try the demo'],
    ['vision', 'See the vision'],
  ] as const)('%s: says "%s" and opens in a new tab', (kind, words) => {
    const work = { ...base, action: { kind, url: 'https://example.test/fake/' } };
    const out = html(createElement(ActionButton, { work, action: work.action, variant: 'card' }));
    expect(out).toContain('href="https://example.test/fake/"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain(`>${words}<`);
    expect(out).toContain('(opens in a new tab)');
    expect(out).toContain('Fake Work');
  });

  it('a site-hosted demo resolves against the site base and still opens in a new tab', () => {
    const work = { ...base, action: { kind: 'demo' as const, url: 'demos/fake-demo/' } };
    const out = html(createElement(ActionButton, { work, action: work.action, variant: 'page' }));
    expect(out).toContain(`href="${import.meta.env.BASE_URL}demos/fake-demo/"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('(opens in a new tab)');
  });

  it('shows nothing without a link', () => {
    expect(html(createElement(ActionButton, { work: base, action: undefined, variant: 'card' }))).toBe('');
    expect(pageAction(base)).toBeUndefined();
  });

  it('a page without an action still shows its starter-pack link as before', () => {
    const work = { ...base, link: 'https://example.test/old/' };
    expect(pageAction(work)).toEqual({ kind: 'visit', url: 'https://example.test/old/' });
    const out = html(createElement(ActionButton, { work, action: pageAction(work), variant: 'page' }));
    expect(out).toBe(
      '<a class="button button--primary" href="https://example.test/old/" data-action="visit" target="_blank" rel="noopener noreferrer">'
      + 'Visit Fake Work <span aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>',
    );
    // An explicit action wins over the plain link.
    expect(pageAction({ ...work, action: { kind: 'vision', url: 'https://example.test/vision/' } })?.kind).toBe('vision');
  });
});

describe('preview gallery', () => {
  const images = [
    { src: 'content/previews/fake-1.webp', alt: 'Fake first screen' },
    { src: 'https://example.test/fake-2.png', alt: 'Fake second screen' },
  ];

  it('shows lazy screenshots with their alt text in a keyboard-focusable strip, and no clip', () => {
    const out = html(createElement(PreviewGallery, { work: base, preview: { images } }));
    expect(out).toContain('alt="Fake first screen"');
    expect(out).toContain('alt="Fake second screen"');
    expect(out).toContain('src="/content/previews/fake-1.webp"');
    expect(out).toContain('src="https://example.test/fake-2.png"');
    expect(out.match(/loading="lazy"/g)).toHaveLength(2);
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('role="region"');
    expect(out).not.toContain('<video');
  });

  it('adds a muted, inline clip with a poster that never autoplays', () => {
    const clip = { src: 'content/previews/fake.mp4', poster: 'content/previews/fake-poster.webp' };
    const out = html(createElement(PreviewGallery, { work: base, preview: { images, clip } }));
    const video = out.match(/<video[^>]*>/)?.[0] ?? '';
    expect(video).toMatch(/\bmuted\b/);
    expect(video).toMatch(/\bplaysinline\b/i);
    expect(video).toContain('poster="/content/previews/fake-poster.webp"');
    expect(video).toContain('controls');
    expect(video).not.toMatch(/autoplay/i);
  });

  it('shows nothing without preview data', () => {
    expect(html(createElement(PreviewGallery, { work: base, preview: undefined }))).toBe('');
    expect(html(createElement(PreviewGallery, { work: base, preview: { images: [] } }))).toBe('');
  });
});
