// The invitation's timing, as authored in Blender and exported to public/models/invitation/timeline.json:
//
//   { "fps": 60,
//     "markers": { floatIn, arrive, turn, smile, offer, lookDown, glow, expand, engulf, luminous, dissipate, complete },
//     "clips":   { "<clip>": { "file", "startFrame", "endFrame" } },
//     "swapFrame": <frame>, "adultBox": … }
//
// Markers are frames on one master timeline. Nothing here is hand-timed: every beat's safety
// timeout is the authored length of that beat plus a margin. Pure (no DOM, no three.js), so it
// is tested in node, including missing and malformed files.

export const MARKERS = [
  'floatIn', 'arrive', 'turn', 'smile', 'offer', 'lookDown', 'glow', 'expand', 'engulf', 'luminous', 'dissipate', 'complete',
] as const;
export type MarkerName = (typeof MARKERS)[number];

/** The beats the site cannot do without. The others only add narration and the heading's timing. */
const REQUIRED: MarkerName[] = ['glow', 'luminous'];
/** What the take tells: in any order (he turns while he is still arriving), but all before the glow. */
const STORY: MarkerName[] = ['floatIn', 'arrive', 'turn', 'smile', 'offer', 'lookDown'];
/** The transformation and the trip home: these must run forwards, as the machine and the veil follow them. */
const CHAIN: MarkerName[] = ['glow', 'expand', 'engulf', 'luminous', 'dissipate', 'complete'];

export interface ClipSpan { file: string; startFrame: number; endFrame: number }

export interface Timeline {
  fps: number;
  /** Master frame of each marker present in the file. */
  markers: Partial<Record<MarkerName, number>> & { glow: number; luminous: number };
  clips: Record<string, ClipSpan>;
  swapFrame: number | null;
  adultBox: unknown;
  /** Markers left out because they were out of place (reported, never fatal). */
  dropped: MarkerName[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A validated timeline, or null when the file is missing or malformed, or the beats the site
 * depends on are out of order (the take must start no later than the glow, and the glow must come
 * no later than luminous). Order is checked only where the site depends on it: the story beats may
 * come in any order (Blender has him turn before he has fully arrived) but not after the glow, and
 * the beats after the glow must run forwards. An optional marker that is out of place is dropped,
 * not fatal.
 */
export function parseTimeline(raw: unknown): Timeline | null {
  if (!isObj(raw) || !isNum(raw.fps) || raw.fps <= 0 || !isObj(raw.markers)) return null;
  const found: Partial<Record<MarkerName, number>> = {};
  const dropped: MarkerName[] = [];
  for (const name of MARKERS) {
    const f = raw.markers[name];
    if (f === undefined) continue;
    if (!isNum(f) || f < 0) {
      if (REQUIRED.includes(name)) return null;
      dropped.push(name);
      continue;
    }
    found[name] = f;
  }
  if (REQUIRED.some((n) => found[n] === undefined)) return null;
  const glow = found.glow!, luminous = found.luminous!;
  if (luminous < glow) return null;

  const clips: Record<string, ClipSpan> = {};
  if (isObj(raw.clips)) {
    for (const [name, c] of Object.entries(raw.clips)) {
      if (isObj(c) && isNum(c.startFrame) && isNum(c.endFrame) && c.endFrame >= c.startFrame) {
        clips[name] = { file: typeof c.file === 'string' ? c.file : '', startFrame: c.startFrame, endFrame: c.endFrame };
      }
    }
  }
  if ((clips.invite?.startFrame ?? 0) > glow) return null;

  const markers: Partial<Record<MarkerName, number>> = {};
  for (const name of STORY) {
    const f = found[name];
    if (f === undefined) continue;
    if (f <= glow) markers[name] = f; else dropped.push(name);
  }
  // the chain: glow and luminous are fixed; each optional beat must sit between its neighbours
  let last = -Infinity;
  for (const name of CHAIN) {
    const f = found[name];
    if (f === undefined) continue;
    const required = REQUIRED.includes(name);
    const ceiling = CHAIN.indexOf(name) < CHAIN.indexOf('luminous') ? luminous : Infinity;
    if (required || (f >= last && f <= ceiling)) { markers[name] = f; last = f; } else dropped.push(name);
  }
  return {
    fps: raw.fps,
    markers: markers as Timeline['markers'],
    clips,
    swapFrame: isNum(raw.swapFrame) ? raw.swapFrame : null,
    adultBox: raw.adultBox ?? null,
    dropped,
  };
}

/** Fetches and parses a JSON file; null for anything that is not one (404, an HTML fallback page, bad JSON). */
export async function loadJson(url: string, fetchFn: typeof fetch = fetch): Promise<unknown | null> {
  try {
    const res = await fetchFn(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*</.test(text)) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The timeline, and why there is none: the file is missing (or not JSON), or it was rejected. */
export async function readTimeline(url: string, fetchFn: typeof fetch = fetch): Promise<{ timeline: Timeline | null; problem: 'missing' | 'rejected' | null }> {
  const raw = await loadJson(url, fetchFn);
  if (raw === null) return { timeline: null, problem: 'missing' };
  const timeline = parseTimeline(raw);
  return { timeline, problem: timeline ? null : 'rejected' };
}

// ── timing ─────────────────────────────────────────────────

/** Extra time a beat may take before the safety net moves on (slow devices run the clock a little slow). */
export const MARGIN = { seconds: 1.5, share: 0.25 };

/** Safety timeout for a beat that is authored to last `seconds`. */
export const beatTimeoutMs = (seconds: number) => Math.round((Math.max(0, seconds) * (1 + MARGIN.share) + MARGIN.seconds) * 1000);

/** The master frame at which the take begins (the invite clip's first frame). */
export function takeStartFrame(t: Timeline): number {
  return t.clips.invite?.startFrame ?? t.markers.floatIn ?? 0;
}

export const seconds = (t: Timeline, fromFrame: number, toFrame: number) => Math.max(0, (toFrame - fromFrame) / t.fps);

/**
 * How long the cloud takes to cover the screen and to clear again, from the authored beats:
 * cover = luminous → swapFrame (or → dissipate), reveal = dissipate → complete. Null when the
 * timeline does not say; the veil then uses its own curve file or its default.
 */
export function veilSecondsFrom(t: Timeline): { cover: number | null; reveal: number | null } {
  const { luminous, dissipate, complete } = t.markers;
  const coverEnd = t.swapFrame !== null && t.swapFrame > luminous ? t.swapFrame : dissipate !== undefined && dissipate > luminous ? dissipate : null;
  const cover = coverEnd === null ? null : seconds(t, luminous, coverEnd);
  const reveal = dissipate !== undefined && complete !== undefined && complete > dissipate ? seconds(t, dissipate, complete) : null;
  return { cover, reveal };
}

export interface InvitationTiming {
  /** take: from the first frame to the glow marker */
  takeMs: number;
  /** transforming: glow → luminous */
  transformMs: number;
  /** carrying: the cloud covering the screen */
  carryMs: number;
}

export function timingFrom(t: Timeline, coverSeconds: number): InvitationTiming {
  return {
    takeMs: beatTimeoutMs(seconds(t, takeStartFrame(t), t.markers.glow)),
    transformMs: beatTimeoutMs(seconds(t, t.markers.glow, t.markers.luminous)),
    carryMs: beatTimeoutMs(coverSeconds),
  };
}

// ── the one clock ──────────────────────────────────────────

/**
 * Markers passed when the master clock moves from `prevFrame` (exclusive) to `nowFrame` (inclusive),
 * in the order the clock reaches them (by frame, whatever order the file lists them in).
 */
export function markersCrossed(t: Timeline, prevFrame: number, nowFrame: number): MarkerName[] {
  if (!(nowFrame > prevFrame)) return [];
  return MARKERS
    .filter((m) => {
      const f = t.markers[m];
      return f !== undefined && f > prevFrame && f <= nowFrame;
    })
    .sort((a, b) => t.markers[a]! - t.markers[b]! || MARKERS.indexOf(a) - MARKERS.indexOf(b));
}

/**
 * The first frame of `beats` present in the timeline (e.g. the heading arrives with the smile or
 * the offer, whichever Blender puts first), else the glow.
 */
export function firstFrameOf(t: Timeline, beats: MarkerName[]): number {
  const frames = beats.map((m) => t.markers[m]).filter((f): f is number => f !== undefined);
  return frames.length ? Math.min(...frames) : t.markers.glow;
}

/**
 * Where the magic cloud's 'transform' clip sits on the master timeline: its entry in
 * timeline.json, else starting at the glow (never at the take's first frame), as long as the clip.
 */
export function cloudSpan(t: Timeline, clipSeconds: number): ClipSpan {
  const s = t.clips.transform;
  if (s) return s;
  const start = t.markers.glow;
  return { file: '', startFrame: start, endFrame: start + Math.max(0, clipSeconds) * t.fps };
}

/**
 * The furthest master frame the take may drift to while the trip home waits at 'luminous' (see
 * pace.ts): the next authored beat (the swap under the veil, or the cloud dissipating), else the
 * end of its clips (`clipEndFrames`, master frames). Never earlier than luminous itself.
 */
export function waitLimitFrame(t: Timeline, clipEndFrames: number[]): number {
  const L = t.markers.luminous;
  const later = [t.swapFrame, t.markers.dissipate, ...clipEndFrames]
    .filter((f): f is number => typeof f === 'number' && Number.isFinite(f) && f > L);
  return later.length ? Math.min(...later) : L;
}

/**
 * A clip's own time at a master frame. Blender may export a clip from 0 (slid to zero) or keep
 * absolute frame times; this tells them apart from the clip's length and the span in the timeline.
 */
export function clipLocalTime(span: ClipSpan | undefined, masterFrame: number, clipDuration: number, fps: number): number {
  let local: number;
  if (!span) local = masterFrame / fps;
  else {
    const spanSeconds = (span.endFrame - span.startFrame) / fps;
    const absolute = span.startFrame > 0
      && Math.abs(clipDuration - span.endFrame / fps) <= 2 / fps
      && Math.abs(clipDuration - spanSeconds) > 2 / fps;
    local = absolute ? masterFrame / fps : (masterFrame - span.startFrame) / fps;
  }
  return Math.min(Math.max(local, 0), Math.max(0, clipDuration));
}
