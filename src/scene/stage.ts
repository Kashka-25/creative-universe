// Tiny shared store between the DOM portfolio and the 3D scene.
// A plain module (no React state) because the scene reads it every frame.
// No three.js imports here: the portfolio bundle must not pull in the 3D chunk.

/** The element in the portfolio where the guide perches (the hero "stage"). */
export const stage = {
  el: null as HTMLElement | null,
  set(el: HTMLElement | null) {
    this.el = el;
  },
};
