import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, type Object3D } from 'three';
import { isPlainClick, pageTransitionNames, routeIdent, welcomeClick, welcomeNavigate, type WelcomeNavOptions } from '../src/portfolio/transitions';
import { PIXEL_BUDGET, stageDpr } from '../src/intro/capability';
import { createModelSource } from '../src/characters/modelSource';
import { disposeTree } from '../src/characters/sceneUtils';

// the real disposeTree, watched (to see what a stopped load frees)
vi.mock('../src/characters/sceneUtils', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/characters/sceneUtils')>();
  return { ...real, disposeTree: vi.fn(real.disposeTree) };
});

describe('a change of page', () => {
  it('names each page\'s content and footer for itself, so the old fades out where it was and the new fades in', () => {
    expect(pageTransitionNames('/')).toEqual({ content: 'page-home', footer: 'foot-home' });
    expect(pageTransitionNames('/realm/music')).toEqual({ content: 'page-realm-music', footer: 'foot-realm-music' });
    expect(routeIdent('/work/YOUrigin/')).toBe('work-yourigin');
    const names = ['/', '/about', '/realm/music', '/realm/art', '/work/a', '/work/b'].map((p) => pageTransitionNames(p).content);
    expect(new Set(names).size).toBe(names.length);                       // two pages never share a name
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9-]*$/);         // a valid CSS name
  });

  it('never crossfades Coco, the header, the paper grain or the veil with a frozen copy of themselves', () => {
    const css = (f: string) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');
    const base = css('base.css');
    for (const name of ['root', 'guide', 'site-header', 'grain', 'veil']) {
      expect(base, name).toMatch(new RegExp(`::view-transition-old\\(${name}\\)[^{]*\\{ display: none; \\}`));
      expect(base, name).toMatch(new RegExp(`::view-transition-new\\(${name}\\)[^{]*\\{ animation: none; \\}`));
    }
    expect(css('intro.css')).toMatch(/\.guide-layer \{[^}]*view-transition-name: guide;/);
    expect(css('invitation.css')).toMatch(/\.cloud-veil \{[^}]*view-transition-name: veil;/);
    expect(css('portfolio.css')).toMatch(/\.site-header \{[^}]*view-transition-name: site-header;/);
    expect(base).toMatch(/\.paper-grain \{[^}]*view-transition-name: grain;/);
    expect(base).not.toMatch(/body::after/);                                 // the grain is a real element, so it can stay live
    // stacked as on the page: the grain over the header, the veil over everything
    const z = (name: string) => Number(base.match(new RegExp(`::view-transition-group\\(${name}\\) \\{ z-index: (\\d+)`))?.[1]);
    expect(z('grain')).toBeGreaterThan(z('site-header'));
    expect(z('veil')).toBeGreaterThan(z('grain'));
  });

  it('changes page inside the site without a view transition, so Coco (live over the page) never freezes', () => {
    const src = (f: string) => readFileSync(new URL(`../src/portfolio/${f}`, import.meta.url), 'utf8');
    const layout = src('Layout.tsx');
    expect(layout).toMatch(/<Header \/>/);                                   // the site's own header: no crossfade
    expect(layout).toMatch(/crossfade = false/);
    // the new page fades in instead; main and footer are siblings, so each has a key of its own
    expect(layout).toContain('<main key={`main:${pathname}`} id="main" tabIndex={-1} className={enter}');
    expect(layout).toContain('<Footer key={`foot:${pathname}`} className={enter}');
    expect(readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8')).toMatch(/\.page-enter \{ animation: fade-in [^;]*backwards; \}/);
  });

  it("never uses React Router's own view-transition option: it would replay a transition on every later Back or Forward", () => {
    // the router remembers each navigation made with it and runs a view transition by itself on a
    // later POP between those pages (freezing the live Coco); the welcome starts its own instead
    const files = [
      'main.tsx', 'portfolio/Layout.tsx', 'portfolio/pages.tsx', 'portfolio/components.tsx', 'portfolio/transitions.ts',
      'invitation/InvitationPage.tsx', 'invitation/InvitationPoster.tsx', 'invitation/IllustratedInvitation.tsx',
      'guide/GuideProvider.tsx', 'veil/CloudVeil.tsx',
    ];
    for (const f of files) {
      const code = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
      expect(code, f).not.toMatch(/viewTransition\s*[=:]|\sviewTransition[\s/>]/);    // no prop, no option
    }
    const page = readFileSync(new URL('../src/invitation/InvitationPage.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/welcomeNavigate\(navigateRef\.current, '\/', opts\)/);
    expect(page).toMatch(/<Header replace crossfade \/>/);
    expect(readFileSync(new URL('../src/invitation/InvitationPoster.tsx', import.meta.url), 'utf8')).toMatch(/welcomeNavigate\(navigate, '\/'/);
    expect(src('Layout.tsx')).toMatch(/onClick=\{welcomeClick\(navigate, INVITATION_PATH/);   // Replay the welcome
    function src(f: string) { return readFileSync(new URL(`../src/portfolio/${f}`, import.meta.url), 'utf8'); }
  });

  it('crossfades to and from the welcome with a view transition it starts itself, rendering the new page inside it', async () => {
    const calls: { to: string; opts?: WelcomeNavOptions }[] = [];
    const navigate = (to: string, opts?: WelcomeNavOptions) => { calls.push({ to, opts }); return Promise.resolve(); };
    let update: (() => Promise<void> | void) | null = null;
    welcomeNavigate(navigate, '/', { replace: true, state: { from: 'invitation' } }, { startViewTransition: (fn) => { update = fn; } });
    expect(calls).toEqual([]);                                                     // nothing until the old page is captured
    await update!();
    expect(calls).toEqual([{ to: '/', opts: { replace: true, state: { from: 'invitation' }, flushSync: true } }]);   // the new page, at once
    // no view transitions in this browser: it simply goes
    welcomeNavigate(navigate, '/realm/music', { replace: true }, {});
    expect(calls[1]).toEqual({ to: '/realm/music', opts: { replace: true } });
  });

  it("leaves a click that opens a new tab to the browser, and keeps the welcome's links as real links", () => {
    const click = (o: Partial<{ button: number; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; defaultPrevented: boolean }> = {}) => {
      let prevented = false;
      return { e: { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, ...o, preventDefault: () => { prevented = true; } }, prevented: () => prevented };
    };
    const went: string[] = [];
    const onClick = welcomeClick((to) => { went.push(to); }, '/about', {}, );
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
      const c = click(mod);
      onClick(c.e);
      expect(c.prevented(), JSON.stringify(mod)).toBe(false);
    }
    expect(went).toEqual([]);
    expect(isPlainClick(click().e)).toBe(true);
  });

  it('gives keyboard focus to the new page after a change of page, and closes the mobile menu politely', () => {
    const layout = readFileSync(new URL('../src/portfolio/Layout.tsx', import.meta.url), 'utf8');
    // after a change of page inside the site (not while the veil is up: it focuses the page itself)
    expect(layout).toMatch(/useFocusOnRouteChange\(pathname, moved\.current\)/);
    expect(layout).toMatch(/if \(veil\.phase !== 'idle'\) return;/);
    expect(layout).toMatch(/document\.getElementById\('main'\)\?\.focus\(\{ preventScroll: true \}\)/);
    // Escape gives focus back to the menu button; focus moving on out of the header closes it
    expect(layout).toMatch(/toggle\.current\?\.focus\(\)/);
    expect(layout).toMatch(/onBlur=\{onBlur\}/);
  });

  it("keeps Coco's anchor as a data attribute (React rewrites the layer's class list and would drop a class)", () => {
    const css = readFileSync(new URL('../src/styles/intro.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.guide-layer\[data-attached\] \{ position: absolute; bottom: auto; \}/);
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toContain("layerEl.dataset.attached = ''");
    expect(home).toContain('delete layerEl.dataset.attached');
    expect(home).not.toMatch(/classList/);
  });

  it('never lets Coco measure a hero that has already left the page', () => {
    // registered and cleared in layout effects (the cleanup runs in the same task as the removal),
    // and read through heroRect (a detached or empty box is no hero: see guide.test.ts)
    const components = readFileSync(new URL('../src/portfolio/components.tsx', import.meta.url), 'utf8');
    expect(components).toMatch(/useLayoutEffect\(\(\) => \{\s*stage\.set\(ref\.current\);\s*return \(\) => stage\.set\(null\);\s*\}, \[\]\);/);
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    expect(home).toContain('const r = heroRect(stage.el);');
    expect(home).not.toMatch(/stage\.el\?\.getBoundingClientRect/);
  });

  it('draws Coco only while he can be seen: stepped aside below the edge, his canvas does no GPU work and his clips hold where they are', () => {
    const home = readFileSync(new URL('../src/guide/HomeStage.tsx', import.meta.url), 'utf8');
    // a frame callback with a priority turns R3F's own render off; his draws while he is in view,
    // and once more as he leaves it (so no sliver of him is left on the canvas)
    expect(home).toMatch(/useFrame\(\(state\) => \{\s*const seen = place\.current\.seen;\s*if \(seen \|\| drawnSeen\.current\) state\.gl\.render\(state\.scene, state\.camera\);\s*drawnSeen\.current = seen;\s*\}, 1\);/);
    expect(home).toMatch(/P\.seen = inView;\s*if \(!inView\) \{ attention\.take\(\); return; \}\s*clock\.current \+= dt;/);
  });
});

describe('the 3D stages\' resolution', () => {
  it('is decided once, capped below the screen\'s own density, and never below 1', () => {
    expect(stageDpr('high', 3)).toBe(1.75);
    expect(stageDpr('low', 3)).toBe(1.5);
    expect(stageDpr('high', 1)).toBe(1);
    expect(stageDpr('low', 0)).toBe(1);
  });

  it('keeps a full-window canvas within a pixel budget on large high-density screens, never below 1', () => {
    const big = 2560 * 1300;                                              // a 1440p screen at 150 %
    const dpr = stageDpr('high', 1.5, big);
    expect(dpr * dpr * big).toBeLessThanOrEqual(PIXEL_BUDGET.high + 1);
    expect(dpr).toBeGreaterThanOrEqual(1);
    expect(stageDpr('high', 2, 1440 * 900)).toBe(1.75);                   // a laptop: as before
    expect(stageDpr('low', 3, 390 * 844)).toBe(1.5);                      // a phone: as before
    expect(stageDpr('high', 2, 3840 * 2160)).toBe(1);                     // never below 1
  });
});

describe('loading a model a page can stop and free', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('stops a download in flight: the load reports that it was stopped, and nothing is delivered', async () => {
    let signal: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_res, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
    })) as unknown as typeof fetch;
    const cleared = vi.fn();
    const source = createModelSource(cleared);
    const loader = new source.Loader();
    const onLoad = vi.fn();
    const failed = new Promise<unknown>((resolve) => loader.load('models/x.glb', onLoad, undefined, resolve));
    source.release('models/x.glb');
    const err = await failed;
    expect(signal?.aborted).toBe(true);
    expect((err as DOMException).name).toBe('AbortError');
    expect(onLoad).not.toHaveBeenCalled();
    expect(cleared).toHaveBeenCalledWith(source.Loader, ['models/x.glb']);   // and forgotten: a later visit loads afresh
  });

  it('frees a model that finished parsing after it was stopped, instead of delivering it', async () => {
    const gltf = JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 });
    globalThis.fetch = vi.fn(async () => new Response(gltf, { status: 200 })) as unknown as typeof fetch;
    const source = createModelSource();
    const parse = GLTFLoader.prototype.parse;
    const parsed = vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation(function (this: GLTFLoader, ...args: Parameters<GLTFLoader['parse']>) {
      source.abort();                                     // stopped while it was parsing
      return parse.apply(this, args);
    });
    const freed = vi.mocked(disposeTree);
    freed.mockClear();
    const loader = new source.Loader();
    const onLoad = vi.fn();
    const err = await new Promise<unknown>((resolve) => loader.load('models/p.glb', onLoad, undefined, resolve));
    expect(parsed).toHaveBeenCalledTimes(1);
    expect((err as DOMException).name).toBe('AbortError');
    expect(onLoad).not.toHaveBeenCalled();
    expect(freed).toHaveBeenCalledTimes(1);
    expect((freed.mock.calls[0][0] as Object3D).isObject3D).toBe(true);    // the parsed scene, freed
  });

  it('never delivers a model stopped while its bytes were on their way', async () => {
    let finish!: (r: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })) as unknown as typeof fetch;
    const source = createModelSource();
    const loader = new source.Loader();
    const onLoad = vi.fn();
    const failed = new Promise<unknown>((resolve) => loader.load('models/y.glb', onLoad, undefined, resolve));
    source.abort();                                       // stopped while the bytes were on their way
    const gltf = JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 });
    finish(new Response(gltf, { status: 200 }));          // they arrive anyway (a fetch that ignored the signal)
    await failed;
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('frees the decoded images too when a model is thrown away (ImageBitmaps are not freed by dropping them)', () => {
    const close = vi.fn();
    const texture = new Texture();
    texture.image = { width: 4, height: 4, close };
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture }));
    const root = new Group();
    root.add(mesh);
    disposeTree(root);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('delivers a model normally, and a new load after a stop starts afresh', async () => {
    const gltf = JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 });
    globalThis.fetch = vi.fn(async () => new Response(gltf, { status: 200 })) as unknown as typeof fetch;
    const source = createModelSource();
    source.abort();
    const loader = new source.Loader();
    const scene = await new Promise<unknown>((resolve, reject) => loader.load('models/z.glb', (g) => resolve(g.scene), undefined, reject));
    expect(scene).toBeTruthy();
  });
});
