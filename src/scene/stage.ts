// Tiny shared stores between the DOM portfolio and the 3D scene.
// Plain modules (no React state) because the scene reads them every frame.
// No three.js imports here: the portfolio bundle must not pull in the 3D chunk.

type Listener = () => void;

/** The element in the portfolio where the guide perches (the hero "stage"). */
export const stage = {
  el: null as HTMLElement | null,
  listeners: new Set<Listener>(),
  set(el: HTMLElement | null) {
    if (this.el === el) return;
    this.el = el;
    this.listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  },
};

/** Visitor's pointer in normalised device coordinates (-1..1), tracked on the window. */
export const pointer = { x: 0, y: 0, moved: false };
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    pointer.moved = true;
  }, { passive: true });
}

