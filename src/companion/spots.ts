// Spots: places in the page where the guide may be. Pages declare them with
// <GuideSpot>. Each is a box the layout keeps clear of text and buttons, so
// wherever the guide goes he never covers content.

export type SpotMode = 'sit' | 'stand' | 'hover';

export interface SpotOptions {
  id: string;
  /** How he waits there: on his cloud, standing, or floating. */
  mode: SpotMode;
  /** Higher wins when a page has several visible spots. */
  priority?: number;
  /** Show the sun and lightning bolt behind him (the hero emblem). */
  backdrop?: boolean;
  /** Gesture on arrival (contract gesture name). */
  emote?: string;
  /** Short line for the speech bubble on arrival (once per visit). */
  intro?: string;
}

export interface Spot extends SpotOptions {
  el: HTMLElement;
  /** Share of the box currently in the viewport, 0..1. */
  visible: number;
}

type Listener = () => void;

class SpotRegistry {
  readonly map = new Map<string, Spot>();
  private listeners = new Set<Listener>();
  private io: IntersectionObserver | null = null;

  private observer() {
    if (this.io || typeof IntersectionObserver === 'undefined') return this.io;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.spot;
        const spot = id ? this.map.get(id) : undefined;
        if (spot) spot.visible = e.isIntersecting ? e.intersectionRatio : 0;
      }
      this.emit();
    }, { threshold: [0, 0.15, 0.35, 0.6, 0.85, 1] });
    return this.io;
  }

  register(el: HTMLElement, opts: SpotOptions) {
    el.dataset.spot = opts.id;
    const spot: Spot = { ...opts, el, visible: 0 };
    this.map.set(opts.id, spot);
    this.observer()?.observe(el);
    this.emit();
    return () => {
      this.observer()?.unobserve(el);
      if (this.map.get(opts.id)?.el === el) this.map.delete(opts.id);
      this.emit();
    };
  }

  get(id: string | null | undefined) {
    return id ? this.map.get(id) : undefined;
  }

  /** Spots that are laid out (not display:none, e.g. hidden on phones). */
  laidOut() {
    return [...this.map.values()].filter((s) => s.el.offsetWidth > 0 && s.el.offsetHeight > 0);
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

export const spots = new SpotRegistry();

/** Centre of a spot on screen, in CSS pixels. */
export function spotCentre(s: Spot) {
  const r = s.el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
