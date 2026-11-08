// Where the cocoon is on screen while the guide transforms, shared between the
// 3D layer (which knows) and the page (which shows the painting in his place).
// A plain module: no React or three.js, so the page never loads 3D for it.

export interface ScreenRect {
  /** Centre of the cocoon, CSS pixels from the top left of the viewport. */
  x: number;
  y: number;
  /** Height of the cocoon on screen, CSS pixels. */
  h: number;
}

export const emergence = {
  rect: null as ScreenRect | null,
  setRect(r: ScreenRect | null) {
    this.rect = r;
  },
};
