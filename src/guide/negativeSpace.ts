// Measures the page for space.ts: the content blocks in the window (obstacles), the spaces the page
// keeps for him (hints: [data-guide-space]), and the window below the sticky header. The section
// swirl clouds (SkyClouds: .sky-cloud) count as content too, over the whole of their slow drift
// (cloudRect); the rest of a backdrop ([data-backdrop]) is empty space. No three.js here: the poster
// companion uses it too. createLayoutCache measures the page only when it changes (a resize, a
// change in the DOM, a new page), in page coordinates, so a look while scrolling costs no layout.

import { controlInCorner, cornerBox } from './companion';
import { findSpace, pathClear, spaceSizes, stillClear, roamStep, visibleShare, type Rect, type Roam, type RoamMove, type Spot } from './space';

/** What counts as content: text, images, media, controls, cards, the open menu and the footer. */
const CONTENT = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd', 'blockquote', 'pre', 'table', 'figure',
  'img', 'picture', 'video', 'audio', 'iframe', 'canvas', 'svg', 'a', 'button', 'input', 'select', 'textarea',
  '.work-card', '.realm-card', '.chip', '.medallion', '.crumbs', '[data-guide-obstacle]',
].map((s) => `main ${s}`).concat('.site-nav.is-open', '.site-footer > *').join(',');

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/** The section swirl clouds (SkyClouds), shown. */
const CLOUD = '.sky-cloud.is-loaded';
/** Room kept round a cloud for its slow tilt (px). */
const CLOUD_TILT_PX = 6;

/**
 * A swirl cloud's box (window px) over the whole of its drift: it sways by (--dx, --dy) and back
 * (portfolio.css cloud-drift), so wherever it is in its sway now, the box covers every place it goes.
 */
export function cloudRect(r: Rect, dx: number, dy: number, tilt = CLOUD_TILT_PX): Rect {
  const ax = Math.abs(dx) + tilt, ay = Math.abs(dy) + tilt;
  return { left: r.left - ax, top: r.top - ay, right: r.right + ax, bottom: r.bottom + ay };
}

function cloudRects(W: number, H: number, band = 200): Rect[] {
  const out: Rect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(CLOUD)) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4 || r.bottom < -band || r.top > H + band || r.right < 0 || r.left > W) continue;
    const num = (v: string) => Number.parseFloat(el.style.getPropertyValue(v)) || 0;
    out.push(cloudRect(toRect(r), num('--dx'), num('--dy')));
  }
  return out;
}

export interface Measured { view: Rect; obstacles: Rect[]; hints: Rect[] }

/** `band`: how far (px) above and below the window content is measured (the cache measures a wide band). */
export function measurePage(W = window.innerWidth, H = window.innerHeight, band = 40): Measured {
  // the sticky header is the window's top edge: the page scrolls under it, and so does he, with his
  // space (he is drawn below it), so it counts as the edge of the view rather than as content
  const header = document.querySelector('.site-header')?.getBoundingClientRect();
  const view: Rect = { left: 0, top: header && header.bottom > 0 && header.top <= 1 ? Math.min(header.bottom, H / 2) : 0, right: W, bottom: H };
  const obstacles: Rect[] = [];
  for (const el of document.querySelectorAll<HTMLElement | SVGElement>(CONTENT)) {
    if (el.closest('[data-guide-space], [data-backdrop], .visually-hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4 || r.bottom < -band || r.top > H + band || r.right < 0 || r.left > W) continue;
    obstacles.push(toRect(r));
  }
  obstacles.push(...cloudRects(W, H, band));
  const hints = [...document.querySelectorAll('[data-guide-space]')].map((el) => toRect(el.getBoundingClientRect())).filter((r) => r.right > r.left);
  return { view, obstacles: dropContained(obstacles), hints };
}

/** Obstacles inside another add nothing: dropped, so the finder has less to do. */
function dropContained(list: Rect[]): Rect[] {
  const sorted = [...list].sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top));
  const kept: Rect[] = [];
  for (const r of sorted) {
    if (!kept.some((k) => r.left >= k.left && r.right <= k.right && r.top >= k.top && r.bottom <= k.bottom)) kept.push(r);
  }
  return kept;
}

export interface LookOptions {
  aspect: number;
  now: number;
  scrollIdle: boolean;
  /** Where he is now, in the window (null: not seen). */
  near: { cx: number; cy: number } | null;
  /** Take the best space at once (arriving, a change of page, coming back from About). */
  force?: boolean;
}

/**
 * The way from where he is to his new space (both window px) crosses no content on the page as it is
 * now (space.ts pathClear). Content is not grown here: only his box itself must stay off it.
 */
export function wayClear(from: Spot, to: Spot, aspect: number): boolean {
  return pathClear(from, to, measurePage().obstacles, aspect);
}

/** His box (window px) is on some of the page's content now. */
export function onContent(at: Spot, aspect: number): boolean {
  return !pathClear(at, at, measurePage().obstacles, aspect);
}

/** One look at the page: updates his space (document px) by space.ts's rules. */
export function lookAround(R: Roam, o: LookOptions): RoamMove {
  const W = window.innerWidth, H = window.innerHeight, sy = window.scrollY;
  const { view, obstacles, hints } = measurePage(W, H);
  const opts = { ...spaceSizes(W, H), aspect: o.aspect };
  const best = findSpace(view, obstacles, opts, { near: o.near, hints });
  const bestDoc: Spot | null = best && { ...best, cy: best.cy + sy };
  if (o.force) {
    R.spot = bestDoc;
    R.betterSince = NaN;
    R.openSince = NaN;
    return bestDoc ? 'move' : 'none';
  }
  const mine = R.spot && { ...R.spot, cy: R.spot.cy - sy };
  return roamStep(R, {
    now: o.now,
    scrollIdle: o.scrollIdle,
    best: bestDoc,
    clear: mine ? stillClear(mine, obstacles, o.aspect, opts.pad) : true,
    visible: mine ? visibleShare(mine, o.aspect, view) : 0,
  });
}

/** What counts as a control the visitor can use (under his corner peek he keeps out of its way). */
const CONTROL = 'a[href], button, input, select, textarea, summary, [role="button"], [tabindex]';

/** Fixed to the window (it would always be under his corner), or sticky. */
function pinned(el: Element): boolean {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    const p = getComputedStyle(e).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

/**
 * His corner peek at `s` (window px) is free: no control focused by keyboard under it, and no
 * control fixed to the window there (an open menu, a floating button). companion.ts controlInCorner.
 */
export function cornerFree(s: Spot, aspect: number): boolean {
  const H = window.innerHeight;
  const area = cornerBox(s, aspect, H);
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) {
    let shown = true;
    try { shown = el.matches(':focus-visible'); } catch { /* older browsers: treat focus as visible */ }
    if (shown && controlInCorner(el.getBoundingClientRect(), el.tabIndex, H, area)) return false;
  }
  if (typeof document.elementsFromPoint !== 'function') return true;
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.2, 0.55, 0.9]) {
      const x = area.left + (area.right - area.left) * fx, y = area.top + (area.bottom - area.top) * fy;
      for (const hit of document.elementsFromPoint(x, y)) {
        const c = hit.closest<HTMLElement>(CONTROL);
        if (c && pinned(c) && controlInCorner(c.getBoundingClientRect(), c.tabIndex, H, area)) return false;
      }
    }
  }
  return true;
}

// ── the page's layout, measured only when it changes ───────

/** The open menu is fixed to the window: measured on every look (one element), never cached. */
const FIXED = '.site-nav.is-open';

export interface LayoutCache {
  /** The page measured now (window px), from the cache: no layout unless the page has changed. */
  get(W?: number, H?: number): Measured;
  /** The page has changed (a resize, a new page): measured afresh on the next get. */
  invalidate(): void;
  dispose(): void;
}

/**
 * The page's content in PAGE coordinates (window px + scroll), measured again only after a resize,
 * a change in the DOM (outside his own layer), a change of page or every `refreshS` seconds (a lazy
 * image settling without a DOM change). Reading it while the page scrolls is a shift, not a layout.
 */
export function createLayoutCache(refreshS = 2): LayoutCache {
  let doc: { view: Rect; obstacles: Rect[]; hints: Rect[]; sy: number; W: number; H: number } | null = null;
  let measuredAt = -Infinity;
  const invalidate = () => { doc = null; };
  const ownLayer = (n: Node | null) => !!(n instanceof Element ? n : n?.parentElement)?.closest('.guide-layer, .guide-poster');
  const mo = typeof MutationObserver !== 'undefined'
    ? new MutationObserver((list) => { if (list.some((m) => !ownLayer(m.target))) invalidate(); })
    : null;
  mo?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'src'] });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null;
  ro?.observe(document.documentElement);
  const main = document.querySelector('main');
  if (main) ro?.observe(main);
  window.addEventListener('resize', invalidate);
  window.addEventListener('hashchange', invalidate);
  return {
    get(W = window.innerWidth, H = window.innerHeight) {
      const sy = window.scrollY;
      const now = performance.now() / 1000;
      // measured over a band of three windows each way; scrolled further, measured again
      if (!doc || doc.W !== W || doc.H !== H || now - measuredAt >= refreshS || Math.abs(sy - doc.sy) > 2 * H) {
        const m = measurePage(W, H, 3 * H);
        doc = { ...m, sy, W, H };
        measuredAt = now;
        return { view: m.view, obstacles: m.obstacles.filter((o) => o.bottom > -200 && o.top < H + 200), hints: m.hints };
      }
      const d = sy - doc.sy;
      const shift = (r: Rect): Rect => ({ left: r.left, right: r.right, top: r.top - d, bottom: r.bottom - d });
      const obstacles = doc.obstacles.map(shift).filter((r) => r.bottom > -200 && r.top < H + 200);
      for (const el of document.querySelectorAll(FIXED)) obstacles.push(toRect(el.getBoundingClientRect()));
      // the header is sticky: the view's top edge stays where it was measured
      return { view: doc.view, obstacles, hints: doc.hints.map(shift) };
    },
    invalidate,
    dispose() {
      mo?.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('hashchange', invalidate);
    },
  };
}

/**
 * The home page's stops for Coco's journey (tour.ts), by their hooks ([data-coco-stop]), in window
 * px. A heading is measured by its text (its own box spans the column), so "stage right" of it is the
 * room beside the words.
 */
export function stopAnchors(): { name: 'realms' | 'works' | 'bottom'; rect: Rect }[] {
  const out: { name: 'realms' | 'works' | 'bottom'; rect: Rect }[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-coco-stop]')) {
    const name = el.dataset.cocoStop;
    if (name !== 'realms' && name !== 'works' && name !== 'bottom') continue;
    let r = el.getBoundingClientRect();
    if (name !== 'bottom' && typeof document.createRange === 'function') {
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      if (t.width > 0 && t.height > 0) r = t;
    }
    if (r.width > 0 && r.height > 0) out.push({ name, rect: toRect(r) });
  }
  return out;
}
