// Adult Coco's living details (9 Nov 2026): the sun and bolt come to life and his third eye blinks wherever he
// is, and on the welcome he wakes, looks at the visitor, closes his eyes again and bows before the cloud.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AnimationClip, Group, Mesh, MeshStandardMaterial, NumberKeyframeTrack, Object3D, PlaneGeometry,
} from 'three';
import { ClipPlayer } from '../src/characters/ClipPlayer';
import { createCocoLife, ctlValue, EYES_ALPHA, EYES_SHUT, eyesCutoff, glowFactor, SUN_GLOW } from '../src/characters/cocoLife';
import { awakenSeconds, awakenStart, AWAKEN_RELEASE_SECONDS } from '../src/invitation/awaken';
import { createNarrator, NARRATION } from '../src/invitation/invitationMachine';
import { BEAT, markersCrossed, MARKERS, parseTimeline, timingFrom, type MarkerName } from '../src/invitation/timeline';

// shaped like the Blender export: he arrives at 120, the heading at 160, he wakes at 185 for 6 s (360 frames)
const RAW = {
  fps: 60,
  markers: {
    floatIn: 0, arrive: 120, welcome: 160, wake: 185, gaze: 308, eyesClose: 392, bow: 425,
    glow: 640, expand: 680, engulf: 720, luminous: 760, dissipate: 820, complete: 880,
  },
  clips: { invite: { file: 'coco-invite.glb', startFrame: 0, endFrame: 120 } },
  coverFrame: 800,
};
const TL = parseTimeline(RAW)!;
const withMarkers = (m: Partial<Record<MarkerName, number | string>>) => parseTimeline({ ...RAW, markers: { ...RAW.markers, ...m } })!;

describe('the awakening on the timeline', () => {
  it('reads the beat between his arrival and the glow, in order', () => {
    expect(BEAT).toEqual(['wake', 'gaze', 'eyesClose', 'bow']);
    const i = (m: MarkerName) => MARKERS.indexOf(m);
    expect(i('welcome')).toBeLessThan(i('wake'));
    expect(i('bow')).toBeLessThan(i('glow'));
    expect(TL.dropped).toEqual([]);
    expect(TL.markers.wake).toBe(185);
    expect(TL.markers.bow).toBe(425);
    // the clock reports them in order, and the glow after them
    expect(markersCrossed(TL, 150, 650)).toEqual(['welcome', 'wake', 'gaze', 'eyesClose', 'bow', 'glow']);
  });

  it('drops a beat marker out of place, never the file; without wake there is no beat', () => {
    const swapped = withMarkers({ gaze: 400, eyesClose: 392 });           // closes before they are open
    expect(swapped.markers.gaze).toBe(400);
    expect(swapped.markers.eyesClose).toBeUndefined();
    expect(swapped.dropped).toEqual(['eyesClose']);
    const late = withMarkers({ bow: 700 });                                // after the glow
    expect(late.markers.bow).toBeUndefined();
    expect(late.markers.glow).toBe(640);
    const early = withMarkers({ wake: 100 });                              // before he has arrived
    expect(early.markers.wake).toBeUndefined();
    expect(early.markers.gaze).toBeUndefined();                            // the rest has no beat to belong to
    expect(early.dropped).toEqual(expect.arrayContaining(['wake', 'gaze', 'eyesClose', 'bow']));
    const none = parseTimeline({ ...RAW, markers: { glow: 640, luminous: 760 } })!;
    expect(none.markers.wake).toBeUndefined();
    expect(awakenSeconds(none)).toBe(0);
    // the required order after the glow is as it was
    expect(parseTimeline({ ...RAW, markers: { ...RAW.markers, luminous: 600 } })).toBeNull();
  });

  it("starts the beat from the moment the clock is at, once, and never after a jump to the glow", () => {
    expect(awakenStart(TL, markersCrossed(TL, 180, 186), 186)).toBeCloseTo(1 / 60);
    expect(awakenStart(TL, markersCrossed(TL, 186, 190), 190)).toBeNull();          // already started
    // "Come on in" before the beat: the clock jumps to the glow, so 'wake' is never crossed
    expect(markersCrossed(TL, 640 - 0.001, 641)).toEqual(['glow']);
    expect(awakenStart(TL, ['glow'], 641)).toBeNull();
  });

  it('gives the take its safety timeout from the longer, authored take', () => {
    const before = parseTimeline({ ...RAW, markers: { floatIn: 0, arrive: 120, welcome: 160, glow: 280, luminous: 400 } })!;
    expect(timingFrom(TL, 0.6).takeMs).toBeGreaterThan(timingFrom(before, 0.6).takeMs);
    expect(timingFrom(TL, 0.6).takeMs).toBeGreaterThan((640 / 60) * 1000);
    expect(awakenSeconds(TL)).toBeCloseTo((640 - 185) / 60);
  });

  it('tells a screen reader what happens, only as it happens', () => {
    expect(NARRATION.wake).toMatch(/opens his eyes/);
    expect(NARRATION.bow).toMatch(/bows his head/);
    const say = createNarrator(TL);
    expect(say('wake')).toBe(NARRATION.wake);
    expect(say('bow')).toBe(NARRATION.bow);
    // a jump to the glow skips them: never spoken
    const jumped = createNarrator(TL);
    jumped.skip();
    expect(jumped('glow')).toBe(NARRATION.glow);
  });

  it('the real timeline.json: the beat sits between the heading and the glow, and the glow moved by its length', () => {
    const file = new URL('../public/models/invitation/timeline.json', import.meta.url);
    const cfgFile = new URL('../blender/characters/coco-sage.json', import.meta.url);
    if (!existsSync(file) || !existsSync(cfgFile)) return;
    const t = parseTimeline(JSON.parse(readFileSync(file, 'utf8')))!;
    const A = JSON.parse(readFileSync(cfgFile, 'utf8')).life.awaken as { seconds: number; closeAt: number; bow: number[] };
    expect(t.dropped).toEqual([]);
    const m = t.markers;
    expect(m.wake).toBeGreaterThan(m.welcome!);
    expect([m.wake!, m.gaze!, m.eyesClose!, m.bow!, m.glow]).toEqual([...[m.wake!, m.gaze!, m.eyesClose!, m.bow!, m.glow]].sort((a, b) => a - b));
    expect(m.eyesClose! - m.wake!).toBe(Math.round(A.closeAt * t.fps));
    expect(m.bow! - m.wake!).toBe(Math.round(A.bow[0] * t.fps));
    // the glow came 157 frames after he arrived before the beat; now that plus the beat's length
    expect(m.glow - m.arrive!).toBe(157 + Math.round(A.seconds * t.fps));
    // the beat is over before the glow
    expect(m.wake! + A.seconds * t.fps).toBeLessThanOrEqual(m.glow);
  });
});

// ── the early click ──────────────────────────────────────────────────────

const track = (name: string, times: number[], values: number[]) => new NumberKeyframeTrack(`bone.${name}`, times, values);

describe('letting the awakening go when "Come on in" comes in the middle of it', () => {
  const setup = () => {
    const root = new Group();
    const bone = new Object3D();
    bone.name = 'bone';
    root.add(bone);
    const breathe = new AnimationClip('breathe', 2, [track('position[x]', [0, 1, 2], [0, 0.1, 0])]);
    // an awakening that lifts the bone and holds it, starting and ending at rest
    const awaken = new AnimationClip('awaken', 6, [track('position[y]', [0, 1, 5, 6], [0, 1, 1, 0])]);
    const p = new ClipPlayer(root, [breathe, awaken], { additive: (n) => n === 'awaken' });
    p.play('breathe');
    return { p, bone };
  };

  it('eases out from wherever it is, smoothly, and ends', () => {
    const { p, bone } = setup();
    expect(p.layer('awaken')).toBe(true);
    for (let i = 0; i < 120; i++) p.update(1 / 60);                       // 2 s in: fully up
    expect(bone.position.y).toBeCloseTo(1, 2);
    expect(p.releaseLayer('awaken', 0.9)).toBe(true);
    expect(p.hasLayer('awaken')).toBe(false);                             // letting go, not playing on
    expect(p.releaseLayer('awaken', 0.9)).toBe(false);                    // once
    const ys: number[] = [];
    for (let i = 0; i < 60; i++) { p.update(1 / 60); ys.push(bone.position.y); }
    // never a jump: each frame moves it a little, always down, and it reaches rest
    const steps = ys.slice(1).map((y, k) => y - ys[k]);
    expect(Math.max(...steps)).toBeLessThanOrEqual(1e-9);
    expect(Math.max(...steps.map(Math.abs))).toBeLessThan(0.05);
    expect(ys.at(-1)).toBeCloseTo(0, 5);
    expect(p.layerCount()).toBe(0);
  });

  it('does nothing when there is nothing to let go', () => {
    const { p } = setup();
    expect(p.releaseLayer('awaken', 0.9)).toBe(false);
    expect(p.layerWeight('awaken')).toBe(0);
    expect(AWAKEN_RELEASE_SECONDS).toBeGreaterThan(0);
  });

  it('ends by itself at its last frame (its own timeout)', () => {
    const { p } = setup();
    p.layer('awaken');
    for (let i = 0; i < 6 * 60 + 2; i++) p.update(1 / 60);
    expect(p.layerCount()).toBe(0);
  });
});

// ── the living details' materials ────────────────────────────────────────

describe("his eyes' cards and the glow controls", () => {
  it('shows nothing while his eyes are shut, then reveals from the lid line outwards', () => {
    expect(eyesCutoff(0)).toBe(EYES_ALPHA.rest);
    expect(eyesCutoff(EYES_SHUT / 2)).toBe(EYES_ALPHA.rest);
    expect(eyesCutoff(Number.NaN)).toBe(EYES_ALPHA.rest);
    expect(EYES_ALPHA.rest).toBeGreaterThan(EYES_ALPHA.max);                // above every texel
    expect(eyesCutoff(1)).toBeCloseTo(EYES_ALPHA.min);
    expect(eyesCutoff(2)).toBeCloseTo(EYES_ALPHA.min);
    // a texel t of the way from his lid line to the eye's outline shows exactly once the opening reaches t
    const texel = (t: number) => EYES_ALPHA.max - (EYES_ALPHA.max - EYES_ALPHA.min) * t;
    for (const o of [0.1, 0.4, 0.75, 1]) {
      expect(texel(o - 0.01) >= eyesCutoff(o)).toBe(true);
      expect(texel(o + 0.01) >= eyesCutoff(o)).toBe(false);
    }
    let last = Infinity;
    for (let o = 0.01; o <= 1; o += 0.01) { const c = eyesCutoff(o); expect(c).toBeLessThan(last); last = c; }
  });

  it('reads control values from the bones and never lets a glow go negative', () => {
    const b = new Object3D();
    b.scale.x = 1.4;
    expect(ctlValue(b)).toBeCloseTo(0.4);
    expect(ctlValue(null)).toBe(0);
    b.scale.x = Number.NaN;
    expect(ctlValue(b)).toBe(0);
    expect(glowFactor(-3)).toBe(0);
    expect(glowFactor(0)).toBe(1);
  });

  const model = () => {
    const scene = new Group();
    const sunBolt = new Group();
    sunBolt.name = 'sun_bolt';
    const mat = (name: string, extra: Partial<MeshStandardMaterial> = {}) => Object.assign(new MeshStandardMaterial(), { name, ...extra });
    const sun = new Mesh(new PlaneGeometry(), mat('sun'));
    const bolt = new Mesh(new PlaneGeometry(), mat('bolt'));
    sunBolt.add(sun, bolt);
    const third = new Mesh(new PlaneGeometry(), mat('third_eye', { emissiveIntensity: 1 }));
    const eyes = new Mesh(new PlaneGeometry(), mat('coco_eyes', { alphaTest: EYES_ALPHA.rest }));
    eyes.name = 'coco-sage_eyes';
    scene.add(sunBolt, third, eyes);
    const ctl: Record<string, Object3D> = {};
    for (const n of ['ctl_sun', 'ctl_bolt', 'ctl_eye', 'ctl_eyes']) { ctl[n] = new Object3D(); ctl[n].name = n; scene.add(ctl[n]); }
    return { scene, sun, bolt, third, eyes, ctl, originals: [sun.material, bolt.material, third.material, eyes.material] };
  };

  it('turns the control bones into the glow of the sun, the bolt and the third eye, and his eyes opening', () => {
    const { scene, sun, bolt, third, eyes, ctl } = model();
    const life = createCocoLife(scene);
    life.update();
    const m = (x: Mesh) => x.material as MeshStandardMaterial;
    // at rest: the steady glow they always had, his eyes shut
    expect(m(sun).emissiveIntensity).toBeCloseTo(SUN_GLOW.intensity);
    expect(m(bolt).emissiveIntensity).toBeCloseTo(SUN_GLOW.intensity);
    expect(m(eyes).alphaTest).toBe(EYES_ALPHA.rest);
    expect(life.open()).toBe(0);
    ctl.ctl_sun.scale.x = 1.3;
    ctl.ctl_bolt.scale.x = 1.9;
    ctl.ctl_eye.scale.x = 0.5;
    ctl.ctl_eyes.scale.x = 2;
    life.update();
    expect(m(sun).emissiveIntensity).toBeCloseTo(SUN_GLOW.intensity * 1.3);
    expect(m(bolt).emissiveIntensity).toBeCloseTo(SUN_GLOW.intensity * 1.9);
    expect(m(third).emissiveIntensity).toBeCloseTo(0.5);
    expect(m(eyes).alphaTest).toBeCloseTo(EYES_ALPHA.min);
    expect(life.open()).toBe(1);
  });

  it('gives back the model exactly as it came', () => {
    const { scene, sun, bolt, third, eyes, originals } = model();
    const life = createCocoLife(scene);
    expect(sun.material).not.toBe(originals[0]);
    life.dispose();
    expect([sun.material, bolt.material, third.material, eyes.material]).toEqual(originals);
  });

  it('an older model without these parts keeps its steady sun glow', () => {
    const scene = new Group();
    const sunBolt = new Mesh(new PlaneGeometry(), Object.assign(new MeshStandardMaterial(), { name: 'sun_bolt' }));
    sunBolt.name = 'sun_bolt';
    scene.add(sunBolt);
    const life = createCocoLife(scene);
    life.update();
    expect((sunBolt.material as MeshStandardMaterial).emissiveIntensity).toBeCloseTo(SUN_GLOW.intensity);
    expect(life.open()).toBe(0);
  });
});
