// Drives a guide model (stand-in or Blender GLB) through its clips, and layers
// live behaviour on top of the authored animation:
//   - look-at: head and eyes turn towards the visitor
//   - blinking on top of the eyesClosed shape key
//   - third-eye glow
// Overlays are applied after the mixer each frame and removed before the next,
// so they never accumulate into the animation.

import {
  AnimationMixer, LoopOnce, LoopRepeat, Quaternion, Euler, Vector3, MathUtils,
  type AnimationAction, type AnimationClip, type Material, type Mesh, type Object3D,
} from 'three';
import { guideContract, type ClipName } from './contract';

type Name = ClipName | 'perch_idle' | 'land';

export interface FrameContext {
  /** World-space point to look at, or null. */
  lookTarget: Vector3 | null;
  /** 0..1 how strongly head/eyes follow the look target. */
  lookWeight: number;
  /** 0..1 third-eye glow. */
  glow: number;
  /** Hold eyes open regardless of the clip (perch fallback). */
  eyesOpen?: boolean;
}

const LOOPING = new Set<string>([
  ...guideContract.clips.filter((c) => c.loop).map((c) => c.name),
  'perch_idle',
]);

export class GuideAnimator {
  readonly mixer: AnimationMixer;
  private actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  private currentName: Name | null = null;
  private onDone: ((clip: Name) => void) | null = null;
  private reportAs = new WeakMap<AnimationAction, Name>();

  private head?: Object3D;
  private eyes: Object3D[] = [];
  private eyeMeshes: { mesh: Mesh; index: number; base: number }[] = [];
  private overlaid: { node: Object3D; base: Quaternion }[] = [];
  private glowMats: Material[] = [];
  private glowSprites: Mesh[] = [];

  private yaw = 0;
  private pitch = 0;
  private blinkT = 0;
  private nextBlink = 2.5;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private q = new Quaternion();
  private e = new Euler();

  constructor(private root: Object3D, clips: AnimationClip[]) {
    this.mixer = new AnimationMixer(root);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.mixer.addEventListener('finished', (ev) => {
      const name = (ev.action as AnimationAction).getClip().name as Name;
      const reported = this.reportAs.get(ev.action as AnimationAction);
      this.onDone?.(reported ?? name);
    });

    this.head = root.getObjectByName('head');
    this.eyes = ['eye_L', 'eye_R'].map((n) => root.getObjectByName(n)).filter(Boolean) as Object3D[];
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary && 'eyesClosed' in mesh.morphTargetDictionary && !o.userData.isOutline) {
        const index = mesh.morphTargetDictionary.eyesClosed;
        this.eyeMeshes.push({ mesh, index, base: mesh.morphTargetInfluences?.[index] ?? 0 });
      }
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) if (m?.name === 'third_eye' && !this.glowMats.includes(m)) this.glowMats.push(m);
      }
      if (o.name === 'third_eye_glow') this.glowSprites.push(o as Mesh);
    });
  }

  has(name: string) { return this.actions.has(name); }
  get playing() { return this.currentName; }

  onFinished(cb: (clip: Name) => void) { this.onDone = cb; }

  /**
   * Cross-fades to a clip. Looping is taken from the contract.
   * `reverse` plays a one-shot backwards (used for landing when there is no land clip).
   */
  play(name: Name, { fade = 0.5, reverse = false, reportAs }: { fade?: number; reverse?: boolean; reportAs?: Name } = {}) {
    const next = this.actions.get(name);
    if (!next) {
      // Missing clip: report it done straight away so the story keeps moving.
      queueMicrotask(() => this.onDone?.(reportAs ?? name));
      return false;
    }
    if (this.current === next && this.currentName === (reportAs ?? name) && !reverse) return true;
    const loop = LOOPING.has(name) && !reverse;
    next.reset();
    if (reportAs) this.reportAs.set(next, reportAs); else this.reportAs.delete(next);
    next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.timeScale = reverse ? -1 : 1;
    if (reverse) next.time = next.getClip().duration;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentName = reportAs ?? name;
    return true;
  }

  /** Jump straight to a clip's first frame with no blend (used when snapping to a state). */
  snap(name: Name) {
    this.mixer.stopAllAction();
    this.current = null;
    this.play(name, { fade: 0 });
    this.mixer.update(0);
    this.syncBaselines();
  }

  /**
   * The mixer only writes a property when its value changes, so after writing
   * values outside update() (a snap), record them as the overlay baselines;
   * otherwise a stale baseline would be restored and never corrected.
   */
  private syncBaselines() {
    this.overlaid.length = 0;
    for (const e of this.eyeMeshes) e.base = e.mesh.morphTargetInfluences![e.index];
  }

  update(dt: number, ctx: FrameContext) {
    // 1. take last frame's overlays off
    for (const o of this.overlaid) o.node.quaternion.copy(o.base);
    for (const e of this.eyeMeshes) e.mesh.morphTargetInfluences![e.index] = e.base;

    // 2. authored animation
    this.mixer.update(dt);

    // 3. overlays
    this.overlaid.length = 0;
    this.applyLook(dt, ctx);
    this.applyBlink(dt, ctx);
    this.applyGlow(dt, ctx.glow);
  }

  private remember(node: Object3D) {
    this.overlaid.push({ node, base: node.quaternion.clone() });
  }

  private applyLook(dt: number, ctx: FrameContext) {
    if (!this.head) return;
    let yaw = 0, pitch = 0;
    if (ctx.lookTarget && ctx.lookWeight > 0) {
      const target = this.root.worldToLocal(this.tmp.copy(ctx.lookTarget));
      const from = this.root.worldToLocal(this.head.getWorldPosition(this.tmp2));
      const d = target.sub(from);
      yaw = MathUtils.clamp(Math.atan2(d.x, d.z), -0.9, 0.9) * ctx.lookWeight;
      pitch = MathUtils.clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)), -0.5, 0.45) * ctx.lookWeight;
    }
    const k = 1 - Math.exp(-dt * 5);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    if (Math.abs(this.yaw) + Math.abs(this.pitch) < 1e-4) return;

    this.remember(this.head);
    this.head.quaternion.multiply(this.q.setFromEuler(this.e.set(this.pitch * 0.55, this.yaw * 0.6, 0)));
    for (const eye of this.eyes) {
      this.remember(eye);
      eye.quaternion.multiply(this.q.setFromEuler(this.e.set(this.pitch * 0.45, this.yaw * 0.4, 0)));
    }
  }

  private applyBlink(dt: number, ctx: FrameContext) {
    this.blinkT += dt;
    let blink = 0;
    if (this.blinkT > this.nextBlink) {
      const p = (this.blinkT - this.nextBlink) / 0.16;
      blink = p < 1 ? Math.sin(p * Math.PI) : 0;
      if (p >= 1) {
        this.blinkT = 0;
        this.nextBlink = 2 + Math.random() * 3.5 + (Math.random() < 0.15 ? -1.8 : 0); // sometimes a double blink
      }
    }
    for (const e of this.eyeMeshes) {
      const inf = e.mesh.morphTargetInfluences!;
      e.base = inf[e.index];
      const animated = ctx.eyesOpen ? 0 : e.base;
      inf[e.index] = Math.max(animated, blink);
    }
  }

  private glowNow = 0;
  private applyGlow(dt: number, target: number) {
    this.glowNow += (target - this.glowNow) * (1 - Math.exp(-dt * 2.5));
    const pulse = this.glowNow * (0.85 + 0.15 * Math.sin(performance.now() / 600));
    for (const m of this.glowMats) {
      const em = m as Material & { emissiveIntensity?: number; color?: { setScalar(v: number): void } };
      if (em.emissiveIntensity !== undefined) em.emissiveIntensity = 0.2 + pulse * 2;
    }
    for (const s of this.glowSprites) (s.material as Material & { opacity: number }).opacity = pulse * 0.9;
  }

  /** Stops playback. Safe to call more than once (React StrictMode mounts effects twice). */
  stop() {
    this.mixer.stopAllAction();
    this.current = null;
    this.currentName = null;
  }
}
