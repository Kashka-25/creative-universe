// Coco's swirl clouds, scattered through the pages' sections: where each one sits, how large, and
// how it drifts. Pure and seeded by the section (tested in node): the same section laid out the same
// way always shows its clouds in the same places, visit after visit. The stills are Blender renders
// listed in public/models/clouds/clouds.json; any that is missing is simply not shown. Each may have a
// spinning loop of the same shape (anim), shown in its place unless the visitor prefers reduced motion.
//
// Clouds only ever sit in empty room: SkyClouds measures the section's content (text, headings,
// images, cards, controls) after layout, and placeClouds keeps each cloud's whole box, across its
// whole drift, clear of all of it by a little air. Where a section has no room for a cloud at the
// smallest size, that cloud is simply not shown.

/**
 * A cloud's spinning loop (an animated AVIF rendered from Blender, render_section_clouds.py --loops): its curls
 * turn about their faces as the ride cloud's do at rest. The same shape as its still, so it fills the same box.
 */
export interface CloudAnim { file: string; width: number; height: number; fps?: number; frames?: number }

export interface CloudFile { file: string; width: number; height: number; kind?: string; anim?: CloudAnim }

export interface Rect { left: number; top: number; right: number; bottom: number }

export interface CloudPlace {
  /** Which of the available stills. */
  index: number;
  /** Its box at rest (px, in the area's coordinates). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Its drift: one slow sway (s), started part-way through (negative delay, s), how far (px) and how much it turns (deg). */
  duration: number;
  delay: number;
  dx: number;
  dy: number;
  tilt: number;
  /** How strongly it shows (0 ... 1): always a backdrop. */
  alpha: number;
}

export interface CloudOptions {
  /** The smallest and largest a cloud is drawn (px wide). */
  minW: number;
  maxW: number;
  /** Air kept between a cloud (across its drift) and any content, and between clouds (px). */
  pad: number;
  /** Spacing of the positions tried (px). */
  step: number;
}

/** Cloud sizes for a window `W` px wide: smaller on a phone. */
export function cloudSizes(W: number): CloudOptions {
  const phone = W < 700;
  return phone
    ? { minW: 72, maxW: 140, pad: 12, step: 12 }
    : { minW: 100, maxW: Math.min(230, Math.round(W * 0.16)), pad: 20, step: 16 };
}

/** A 32-bit hash of the seed (FNV-1a). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded random source (mulberry32): the same seed, the same numbers. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Everything a cloud covers at any moment of its drift (its box swept by the sway, with room for the
 * turn), in the area's coordinates.
 */
export function cloudEnvelope(c: Pick<CloudPlace, 'left' | 'top' | 'width' | 'height' | 'dx' | 'dy' | 'tilt'>): Rect {
  // a turn of `tilt` degrees about the centre moves the corners by at most this much on each axis
  const t = (Math.abs(c.tilt) * Math.PI) / 180;
  const turn = Math.ceil(Math.sin(t) * Math.max(c.width, c.height) / 2 + (1 - Math.cos(t)) * Math.max(c.width, c.height) / 2);
  return {
    left: c.left + Math.min(0, c.dx) - turn,
    top: c.top + Math.min(0, c.dy) - turn,
    right: c.left + c.width + Math.max(0, c.dx) + turn,
    bottom: c.top + c.height + Math.max(0, c.dy) + turn,
  };
}

/**
 * Where up to `count` clouds sit in the section named `seed`, chosen from the `files` stills: inside
 * `area` (the room the section's cloud layer has), clear of every `content` rect and of each other
 * across their whole drift. Spread down the section (each aims for a band of its own, on alternate
 * sides), each a different still where there are enough, at varied sizes, each drifting on its own
 * slow, staggered sway. A cloud with no room even at `minW` is left out.
 */
export function placeClouds(
  seed: string,
  files: readonly Pick<CloudFile, 'width' | 'height'>[],
  count: number,
  area: Rect,
  content: readonly Rect[],
  o: CloudOptions,
): CloudPlace[] {
  const W = area.right - area.left, H = area.bottom - area.top;
  if (!files.length || count <= 0 || !(W > 0) || !(H > 0)) return [];
  const r = random(hashSeed(seed));
  const first = r() < 0.5 ? 0 : 1;
  const offset = Math.floor(r() * files.length);
  const step = Math.max(4, o.step);
  const out: CloudPlace[] = [];
  const taken: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const index = (offset + i) % files.length;
    const f = files[index];
    const ratio = f.height / f.width;
    // the sway and look, drawn whether or not it fits, so each cloud keeps its own whatever the layout
    const drift = {
      duration: Math.round(22 + r() * 16),
      delay: -Math.round(r() * 30),
      dx: Math.round((r() < 0.5 ? -1 : 1) * (8 + r() * 10)),
      dy: Math.round((r() < 0.5 ? -1 : 1) * (5 + r() * 7)),
      tilt: Math.round((r() < 0.5 ? -1 : 1) * (1 + r() * 2.5) * 10) / 10,
      alpha: Math.round((0.55 + r() * 0.25) * 100) / 100,
    };
    const wish = Math.round(o.minW + r() * Math.max(0, o.maxW - o.minW));
    const jitter = r();
    // where it would most like to be: its own band down the section, against alternate sides
    const band = H / count;
    const aimY = area.top + band * i + band * (0.25 + jitter * 0.5);
    const aimX = (i + first) % 2 === 0 ? area.left + W * 0.12 : area.right - W * 0.12;
    const blocked = [...content.map((c) => grow(c, o.pad)), ...taken];
    let found: CloudPlace | null = null;
    // the size it wishes for, or smaller, down to the smallest
    for (let w = Math.min(wish, o.maxW); w >= o.minW && !found; w = w > o.minW ? Math.max(o.minW, Math.floor(w * 0.85)) : o.minW - 1) {
      const h = Math.round(w * ratio);
      const probe = cloudEnvelope({ left: 0, top: 0, width: w, height: h, ...drift });
      // the envelope's reach beyond the box at rest
      const ex0 = -probe.left, ey0 = -probe.top, ex1 = probe.right - w, ey1 = probe.bottom - h;
      let best = Infinity;
      for (let top = area.top + ey0; top + h + ey1 <= area.bottom; top += step) {
        const env = { top: top - ey0, bottom: top + h + ey1 };
        const row = blocked.filter((b) => b.top < env.bottom && b.bottom > env.top);
        for (let left = area.left + ex0; left + w + ex1 <= area.right; left += step) {
          const e = { left: left - ex0, right: left + w + ex1, ...env };
          if (row.some((b) => overlaps(b, e))) continue;
          const score = Math.abs(top + h / 2 - aimY) / H + 0.6 * Math.abs(left + w / 2 - aimX) / W;
          if (score < best) { best = score; found = { index, left: Math.round(left), top: Math.round(top), width: w, height: h, ...drift }; }
        }
      }
    }
    if (!found) continue;
    out.push(found);
    taken.push(grow(cloudEnvelope(found), o.pad));
  }
  return out;
}

const grow = (r: Rect, by: number): Rect => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });

const isPicture = (c: unknown): c is { file: string; width: number; height: number } =>
  !!c && typeof c === 'object' && typeof (c as CloudFile).file === 'string' && (c as CloudFile).file.length > 0
  && (c as CloudFile).width > 0 && (c as CloudFile).height > 0;

/**
 * clouds.json's entries that can be shown (anything else is dropped). A loop that is unusable (no file, no size,
 * or a different shape from its still, which would not fill the still's box) is dropped and the still is kept.
 */
export function readCloudList(json: unknown): CloudFile[] {
  if (!Array.isArray(json)) return [];
  return json.filter(isPicture).map((c) => {
    const { anim, ...still } = c as CloudFile;
    const same = isPicture(anim) && Math.abs(anim.height / anim.width - still.height / still.width) < 0.02;
    return same ? { ...still, anim } : still;
  });
}

/** A still's path under public/: as listed, or beside clouds.json when it is a bare file name. */
export const cloudPath = (file: string) => (file.includes('/') ? file.replace(/^\/+/, '') : `models/clouds/${file}`);
