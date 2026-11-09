// Plays a character's Blender clips: one AnimationMixer per character. Every movement is authored
// in Blender; this only sequences clips and blends between them.
//
//   main     one clip at a time (a loop such as 'breathe', or a long take such as 'invite'), with
//            eased crossfades, and an intro that hands over to a loop at its exact first frame
//            ('settle' → 'breathe', no seam). A clip fading out keeps playing (never frozen), and
//            the full-body clips' weights always add up to 1, so a crossfade that starts while
//            another is still under way never lets three's bind pose show through.
//   layers   additive one-shots on top (drifts, a face flutter, small reactions), made additive
//            in three from clips that Blender exports as absolute poses (start and end at rest)
//   loops    additive loops on top for as long as he is shown (his slow 'float' hover), eased in
//
// The pure helpers at the top are tested without WebGL.

import {
  AnimationMixer, AnimationUtils, LoopOnce, LoopRepeat, type AnimationAction, type AnimationClip, type Object3D,
} from 'three';

// ── pure helpers ───────────────────────────────────────────

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smooth 0 → 1 with zero slope at both ends (no visible start or stop). */
export const smoothstep = (u: number) => { const x = clamp01(u); return x * x * (3 - 2 * x); };

/** Weight of an additive one-shot at time t: eased in, eased out, 1 in between. */
export function envelope(t: number, duration: number, fadeIn: number, fadeOut: number): number {
  const a = fadeIn > 0 ? smoothstep(t / fadeIn) : 1;
  const b = fadeOut > 0 ? smoothstep((duration - t) / fadeOut) : 1;
  return Math.min(a, b);
}

/** A looping clip passed its first frame between two readings of its time. */
export const loopWrapped = (prevTime: number, nowTime: number) => nowTime + 1e-6 < prevTime;

/** An additive copy of a clip, relative to its own frame 0 (the rest pose it starts and ends on). */
export function makeAdditive(clip: AnimationClip, fps = 30): AnimationClip {
  return AnimationUtils.makeClipAdditive(clip.clone(), 0, undefined, fps);
}

// ── the player ─────────────────────────────────────────────

export interface ClipPlayerOptions {
  /** Which clips are layered additively on top of the main clip. */
  additive?: (name: string) => boolean;
  /** Frame rate the clips were authored at (for the additive reference frame). */
  fps?: number;
}

interface Fade { action: AnimationAction; from: number; to: number; t: number; seconds: number; done?: () => void }
interface Layer { name: string; action: AnimationAction; fadeIn: number; fadeOut: number }
interface Loop { name: string; action: AnimationAction; t: number; fadeIn: number }

export interface UpdateResult {
  /** The main loop passed its first frame during this update (a loop boundary). */
  wrapped: boolean;
  /** The main clip's time after the update. */
  mainTime: number;
}

export class ClipPlayer {
  readonly mixer: AnimationMixer;
  /** Clips ready to play. */
  private clips = new Map<string, AnimationClip>();
  /** Layered clips not yet made additive (that is a CPU pass over every key: done one at a time, see prepareNext). */
  private pending = new Map<string, AnimationClip>();
  private readonly fps: number;
  private main: AnimationAction | null = null;
  private mainName: string | null = null;
  private intro: { action: AnimationAction; then: string } | null = null;
  /** Which clip each full-body action plays (copies included), for setSpeed. */
  private names = new Map<AnimationAction, string>();
  private fades: Fade[] = [];
  private layers: Layer[] = [];
  private loops: Loop[] = [];
  private disposed = false;

  constructor(readonly root: Object3D, clips: AnimationClip[], opts: ClipPlayerOptions = {}) {
    this.mixer = new AnimationMixer(root);
    this.fps = opts.fps ?? 30;
    for (const clip of clips) {
      if (opts.additive?.(clip.name)) this.pending.set(clip.name, clip);
      else this.clips.set(clip.name, clip);
    }
  }

  /**
   * Makes the next layered clip additive now. Returns whether any are left. A warm-up calls it once
   * per frame, so no single frame carries them all; a clip still pending when it is first layered
   * is made then.
   */
  prepareNext(): boolean {
    const next = this.pending.keys().next();
    if (!next.done) this.ready(next.value);
    return this.pending.size > 0;
  }

  private ready(name: string): AnimationClip | undefined {
    const raw = this.pending.get(name);
    if (raw) {
      this.clips.set(name, makeAdditive(raw, this.fps));
      this.pending.delete(name);
    }
    return this.clips.get(name);
  }

  has(name: string) { return this.clips.has(name) || this.pending.has(name); }
  /**
   * The main clip's playback speed (its own time per second of update). Crossfades and one-shot
   * layers always run in real time, whatever the main clip's speed.
   */
  setMainSpeed(speed: number) { if (this.main) this.main.timeScale = speed; }
  /**
   * The speed of every full-body copy of clip `name`: the main one, and any still fading out under a
   * crossfade (so a take that is slowing keeps slowing under the fade, never running on ahead).
   */
  setSpeed(name: string, speed: number) {
    if (!Number.isFinite(speed)) return;   // a NaN time scale would turn the action's time to NaN for good
    if (this.main && this.names.get(this.main) === name) this.main.timeScale = speed;
    for (const f of this.fades) if (this.names.get(f.action) === name) f.action.timeScale = speed;
  }
  duration(name: string) { return (this.clips.get(name) ?? this.pending.get(name))?.duration ?? 0; }
  get current() { return this.mainName; }

  private action(name: string) {
    const clip = this.ready(name);
    return clip ? this.mixer.clipAction(clip) : null;
  }

  /**
   * Make `name` the main clip. With `fade` > 0 the previous main clip plays on as it fades out while
   * the new one fades in (an eased crossfade); otherwise it switches at once.
   */
  play(name: string, opts: { loop?: boolean; time?: number; fade?: number } = {}): boolean {
    let next = this.action(name);
    if (!next || this.disposed) return false;
    const prev = this.main;
    const fade = opts.fade ?? 0;
    if (prev === next && fade <= 0) { next.time = opts.time ?? next.time; return true; }
    const fadingOut = this.fades.some((f) => f.action === next);
    if (fade > 0 && (prev === next || fadingOut)) {
      // the same clip at another time, or one still fading out from an earlier crossfade: a fresh
      // copy fades in, and the other copy keeps its weight and finishes its own fade (taking it
      // over would drop its weight to 0 in one frame)
      next = this.mixer.clipAction(this.clips.get(name)!.clone());
    }
    this.intro = null;
    next.reset();
    next.setLoop(opts.loop === false ? LoopOnce : LoopRepeat, Infinity);
    next.clampWhenFinished = opts.loop === false;
    next.time = opts.time ?? 0;
    next.play();
    this.names.set(next, name);
    if (prev && fade > 0) {
      // the outgoing clip plays on while it fades away (frozen, its motion would stop dead)
      next.setEffectiveWeight(0);
      this.fade(next, 0, 1, fade);
      this.fade(prev, prev.getEffectiveWeight(), 0, fade, () => this.retire(prev));
    } else {
      // at once: everything else goes, copies still fading out from earlier crossfades included
      for (const f of this.fades) if (f.action !== next) this.retire(f.action);
      this.fades = [];
      next.setEffectiveWeight(1);
      if (prev && prev !== next) this.retire(prev);
    }
    this.main = next;
    this.mainName = name;
    return true;
  }

  /** Play `intro` once, then `loop` from its first frame, carrying over the exact overshoot (no seam). */
  introThenLoop(intro: string, loop: string): boolean {
    const a = this.action(intro);
    if (!a || !this.clips.has(loop)) return this.play(loop);
    this.play(intro, { loop: false });
    this.intro = { action: a, then: loop };
    return true;
  }

  /** Start an additive one-shot on top. Returns false if the clip is missing or already playing. */
  layer(name: string, opts: { fadeIn?: number; fadeOut?: number; startTime?: number } = {}): boolean {
    const a = this.action(name);
    if (!a || this.disposed || this.layers.some((l) => l.name === name)) return false;
    a.reset();
    a.setLoop(LoopOnce, 1);
    a.clampWhenFinished = false;
    a.time = Math.max(0, opts.startTime ?? 0);
    const layer: Layer = { name, action: a, fadeIn: opts.fadeIn ?? 0, fadeOut: opts.fadeOut ?? 0 };
    a.setEffectiveWeight(envelope(a.time, this.duration(name), layer.fadeIn, layer.fadeOut));
    a.play();
    this.layers.push(layer);
    return true;
  }

  layerCount() { return this.layers.length; }

  /**
   * Loop an additive clip on top of everything for good (his 'float' hover over 'breathe'), eased
   * in over `fadeIn` seconds. Returns false if the clip is missing or already looping.
   */
  loopLayer(name: string, opts: { fadeIn?: number } = {}): boolean {
    const a = this.action(name);
    if (!a || this.disposed || this.loops.some((l) => l.name === name)) return false;
    a.reset();
    a.setLoop(LoopRepeat, Infinity);
    const fadeIn = opts.fadeIn ?? 0;
    a.setEffectiveWeight(fadeIn > 0 ? 0 : 1);
    a.play();
    this.loops.push({ name, action: a, t: 0, fadeIn });
    return true;
  }

  /** The weight of a looping layer now (0 if it is not looping). */
  loopWeight(name: string) { return this.loops.find((l) => l.name === name)?.action.getEffectiveWeight() ?? 0; }

  /** Advance every clip by dt seconds. */
  update(dt: number): UpdateResult {
    if (this.disposed) return { wrapped: false, mainTime: 0 };
    const before = this.main?.time ?? 0;
    // the intro hands over to its loop at the exact time it ends
    let handover = -1;
    if (this.intro) {
      const a = this.intro.action;
      const over = a.time + dt * a.getEffectiveTimeScale() - a.getClip().duration;
      if (over >= 0) handover = over;
    }

    for (const f of this.fades) {
      f.t += dt;
      f.action.setEffectiveWeight(f.from + (f.to - f.from) * smoothstep(f.t / f.seconds));
    }
    this.balance();
    for (const l of this.loops) {
      l.t += dt;
      l.action.setEffectiveWeight(l.fadeIn > 0 ? smoothstep(l.t / l.fadeIn) : 1);
    }
    this.mixer.update(dt);

    let refresh = false;
    if (handover >= 0 && this.intro) {
      const loop = this.intro.then;
      this.play(loop);
      this.main!.time = handover;
      refresh = true;
    }
    for (const f of this.fades.filter((x) => x.t >= x.seconds)) f.done?.();
    this.fades = this.fades.filter((x) => x.t < x.seconds);

    for (const l of [...this.layers]) {
      const d = l.action.getClip().duration;
      if (!l.action.enabled || l.action.time >= d - 1e-6) {
        l.action.stop();
        this.layers.splice(this.layers.indexOf(l), 1);
        refresh = true;
      } else {
        l.action.setEffectiveWeight(envelope(l.action.time, d, l.fadeIn, l.fadeOut));
      }
    }
    if (refresh) this.mixer.update(0);
    const after = this.main?.time ?? 0;
    const looping = this.main?.loop === LoopRepeat;
    return { wrapped: looping && handover < 0 && loopWrapped(before, after), mainTime: after };
  }

  /** Re-evaluate the pose at the current times (after changing a time by hand). */
  refresh() { if (!this.disposed) this.mixer.update(0); }

  /** The full-body weights in play now (the main clip and any fading out), for tests: they add up to 1. */
  mainWeights(): number[] {
    const acts = this.fades.map((f) => f.action);
    if (this.main && !acts.includes(this.main)) acts.push(this.main);
    return acts.map((a) => a.getEffectiveWeight());
  }

  /**
   * The full-body clips' weights add up to exactly 1. three blends whatever is missing with the
   * bind pose, so crossfades that overlap (one starts while another is still fading) would pull him
   * part-way towards it; scaled to 1, the pose is always a blend of his authored clips only.
   */
  private balance() {
    if (!this.fades.length) return;
    const acts = this.fades.map((f) => f.action);
    if (this.main && !acts.includes(this.main)) acts.push(this.main);
    let sum = 0;
    for (const a of acts) sum += a.getEffectiveWeight();
    if (!(sum > 1e-4) || Math.abs(sum - 1) < 1e-9) return;
    for (const a of acts) a.setEffectiveWeight(a.getEffectiveWeight() / sum);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    for (const clip of this.clips.values()) this.mixer.uncacheClip(clip);
    this.mixer.uncacheRoot(this.root);
    this.fades = [];
    this.layers = [];
    this.loops = [];
    this.names.clear();
    this.main = null;
    this.intro = null;
  }

  private fade(action: AnimationAction, from: number, to: number, seconds: number, done?: () => void) {
    this.fades = this.fades.filter((f) => f.action !== action);
    this.fades.push({ action, from, to, t: 0, seconds: Math.max(1e-3, seconds), done });
  }

  private retire(action: AnimationAction) {
    action.stop();
    action.paused = false;
    this.names.delete(action);
    const clip = action.getClip();
    if (![...this.clips.values()].includes(clip)) this.mixer.uncacheClip(clip);   // a temporary copy
  }
}
