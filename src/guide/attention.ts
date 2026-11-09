// What the visitor is doing, as things Coco can notice: pointing at something interesting, moving
// keyboard focus, a new part of the page coming into view as they scroll, a tap on him.
// Plain DOM; the 3D layer takes stimuli from here and decides how he responds. Only what the
// visitor does counts: a page simply appearing (sections already in view) is not a stimulus.

export type Stimulus =
  | { kind: 'hover'; x: number; y: number }      // the visitor points at something (screen 0..1)
  | { kind: 'focus'; x: number; y: number }      // keyboard focus moved to something
  | { kind: 'section'; x: number; y: number }    // a new part of the page came into view (scroll)
  | { kind: 'tap' };                             // the visitor touched him

const queue: Stimulus[] = [];

export const attention = {
  push(s: Stimulus) {
    queue.push(s);
    if (queue.length > 8) queue.shift();
  },
  /** The newest stimulus, if any (older ones are dropped: he responds to what's happening now). */
  take(): Stimulus | null {
    const s = queue.pop() ?? null;
    queue.length = 0;
    return s;
  },
  /** Forget everything queued (nothing from before he was there counts). */
  clear() { queue.length = 0; },
};

const INTERESTING = 'a, button, [data-guide-interest], .work-card, .realm-medallion';
/** Parts of the page that count as "coming into view". The hero is his own place, not news. */
const SECTIONS = 'main section:not(.hero), main article, main .realm-grid';
/** A section counts only if the visitor scrolled within this long (not a page change or a layout shift). */
const SCROLL_WINDOW_MS = 1000;

export interface SectionWatch {
  /** An IntersectionObserver entry for `target`. Returns true when it is a real "came into view". */
  entry(target: object, isIntersecting: boolean, now: number): boolean;
  scrolled(now: number): void;
}

/**
 * Decides which section notifications are the visitor's doing. Pure (tested in node): the first
 * notification for each target only reports where it already is (sections in view when the page
 * appears never count), and later ones count once per section, right after a scroll.
 */
export function createSectionWatch(): SectionWatch {
  const known = new WeakSet<object>();
  const counted = new WeakSet<object>();
  let lastScroll = -Infinity;
  return {
    scrolled(now) { lastScroll = now; },
    entry(target, isIntersecting, now) {
      if (!known.has(target)) {
        known.add(target);
        if (isIntersecting) counted.add(target);    // already there: never news
        return false;
      }
      if (!isIntersecting || counted.has(target) || now - lastScroll > SCROLL_WINDOW_MS) return false;
      counted.add(target);
      return true;
    },
  };
}

/** Starts listening; returns a stop function. Throttled so he isn't twitchy. */
export function listen(): () => void {
  attention.clear();
  let lastHover = 0;
  let lastEl: Element | null = null;
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const centre = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2) / vw(), y: (r.top + r.height / 2) / vh() };
  };

  const notice = (kind: 'hover' | 'focus', target: EventTarget | null) => {
    const el = (target as Element | null)?.closest?.(INTERESTING);
    if (!el || el === lastEl || el.closest('.hero-stage')) return;
    const now = performance.now();
    if (now - lastHover < 1200) return;
    lastHover = now;
    lastEl = el;
    attention.push({ kind, ...centre(el) });
  };
  const over = (e: PointerEvent) => notice('hover', e.target);
  const focus = (e: FocusEvent) => notice('focus', e.target);
  const watch = createSectionWatch();
  const onScroll = () => watch.scrolled(performance.now());
  const io = new IntersectionObserver((entries) => {
    const now = performance.now();
    for (const en of entries) {
      if (watch.entry(en.target, en.isIntersecting, now)) attention.push({ kind: 'section', ...centre(en.target) });
    }
  }, { threshold: 0.35 });
  const watchSections = () => document.querySelectorAll(SECTIONS).forEach((s) => io.observe(s));
  watchSections();
  const mo = new MutationObserver(watchSections);
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pointerover', over, { passive: true });
  window.addEventListener('focusin', focus);
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    window.removeEventListener('pointerover', over);
    window.removeEventListener('focusin', focus);
    window.removeEventListener('scroll', onScroll);
    io.disconnect();
    mo.disconnect();
    attention.clear();
  };
}
