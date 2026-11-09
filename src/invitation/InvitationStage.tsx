// The invitation's 3D take: Adult Coco rides in from stage left on his swirl cloud, meditating with
// his eyes closed, settles under the heading, and breathes and floats there; the magic cloud then
// glows from the cloud in his hands, grows and engulfs him, and his ride cloud swells into it and
// thins away inside it. Every movement is Blender's: his model is home's own (coco-sage.glb), his
// ride the clip 'invite' (coco-invite.glb, the same rig, so it binds by bone name), then that
// model's own 'breathe' loop from its first frame (where 'invite' ends, pose and velocity) with
// 'float' layered on it, as at home; the ride cloud is ride-cloud.glb 'ride' (it follows his root
// bone, see characters/rideCloud.ts); the magic cloud is magic-cloud.glb 'transform'. This file only
// frames it, plays it on ONE clock and reports the timeline's markers as the clock passes them.
//
// The one clock is the master frame (`clock.master`); the take's clips play at its pace through
// their own speed, while crossfades always run in real time. If the trip home has to wait for the
// visitor (see pace.ts), a model with an authored hold loop crossfades into it meanwhile.
//
// Lazy chunk with its own Canvas (three.js arrives only on this route). Everything it creates
// (mixers, cloned materials, listeners) is made in effects and fully cleaned up. Nothing is shown
// until the take starts: shaders are compiled, textures uploaded and one frame drawn (unseen, so
// buffers and morph textures are built) while the canvas is still invisible.
//
// The canvas covers the invitation page itself (not the window), so if the page scrolls (a phone
// held sideways) the browser moves him with it, on the compositor: he never swims behind the page.

import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  Box3, Matrix4, Mesh, SkinnedMesh, Vector3, type Group, type Material, type MeshStandardMaterial, type Object3D,
} from 'three';
import { asset } from '../content';
import { qualityTier, stageDpr } from '../intro/capability';
import { ClipPlayer, smoothstep } from '../characters/ClipPlayer';
import { createModelSource } from '../characters/modelSource';
import {
  boxShows, cheapBox, drawOnce, materialsOf, meshesOf, neverCullSkinned, texturesUnder, uploadGradually,
} from '../characters/sceneUtils';
import { ADULT_URL, INVITATION, RIDE_CLOUD_URL } from '../guide/paths';
import { applyRideLook, createRootFollow, prepareRide, type RideParts } from '../characters/rideCloud';
import {
  clipLocalTime, cloudSpan, markersCrossed, takeStartFrame, waitLimitFrame, type ClipSpan, type MarkerName, type Timeline,
} from './timeline';
import { TAKE_RUNS, type InvitationState } from './invitationMachine';
import { freshPace, HOLD_CLIP, HOLD_FADE_SECONDS, slowsForWait, stepPace } from './pace';
import { CLOUD_DEPTH_ORDER, CLOUD_ORDER, magicCloudDepthLook, magicCloudLook } from './cloudLook';
import { veil } from '../veil/veil';

const CAMERA_Z = 10;
const FOV = 30;
/** He fills about this much of the stage's height (and never more than this much of its width). */
const HEIGHT_SHARE = 0.8;
const WIDTH_SHARE = 0.9;
/** "Come on in": the eased crossfade from wherever he is to the glow. */
const JUMP_SECONDS = 0.9;
/** If the first frame is not fully off-screen at this aspect, the take starts under a short fade. */
const FADE_IN_SECONDS = 0.6;
/** A magic cloud with no authored fade (no ctl_fade) still eases in over this long, never pops. */
const CLOUD_IN_SECONDS = 0.6;
/** Longest step of the clock in one frame (a slow device runs a little slow instead of jumping). */
const MAX_DT = 0.1;
/** Glow values from Blender are 0..1; this is the emissive strength at 1. */
const GLOW_STRENGTH = 1.6;
/** Measuring his pose skins at most this many vertices per mesh (an even spread), never all 70k. */
const POSE_SAMPLES = 4000;
/** His ride in (coco-invite.glb), then his model's own loops, as at home. */
const TAKE_CLIP = 'invite';
const BREATHE = 'breathe';
/** His slow hover, an additive loop over 'breathe' (coco-sage.glb authors it at 30 fps). */
const FLOAT = 'float';
const MODEL_FPS = 30;
/** 'float' eases in over this long once he has arrived (it starts at rest, so it never shows a seam). */
const FLOAT_IN_SECONDS = 1.5;
/** The sun and bolt behind him glow softly, as at home (HomeStage): a material setting, not movement. */
const SUN_BOLT = 'sun_bolt';
const SUN_GLOW = { colour: '#ffd98a', intensity: 0.45 };

/** The take's models, loaded together (in parallel) through their own source, so leaving can stop and free them. */
const TAKE = createModelSource((L, urls) => useLoader.clear(L, urls));
const modelUrls = () => [asset(ADULT_URL), asset(INVITATION.take), asset(INVITATION.cloud), asset(RIDE_CLOUD_URL)];
/** The ride cloud's clip on the master timeline. */
const RIDE_CLIP = 'ride';
/** Draw order of the ride cloud: after him, before the magic cloud. */
const RIDE_ORDER = 1;

export interface InvitationStageProps {
  phase: InvitationState;
  timeline: Timeline | null;
  paused: boolean;
  /** Increments when "Come on in" asks the take to jump to the glow. */
  jump: number;
  /** The box in the page he is framed in. */
  stageEl: RefObject<HTMLElement | null>;
  onLoaded: () => void;
  onWarm: () => void;
  /**
   * A marker was passed. `focus` (where the cloud is on screen, 0..1 of the window from the top
   * left) comes with 'luminous' only, where the veil grows from.
   */
  onMarker: (name: MarkerName, focus?: { x: number; y: number }) => void;
  /** The take cannot play (no 'invite' clip, or the WebGL context was lost). */
  onFail: () => void;
  /** Filled with a way to ask where the cloud is on screen now (for a trip that starts later or early). */
  focusProbe?: MutableRefObject<(() => { x: number; y: number }) | null>;
}

// ── helpers ────────────────────────────────────────────────

/**
 * World-space box of everything drawn under `root`, with skinned meshes measured in their current
 * pose from an even spread of their vertices (at most POSE_SAMPLES each, padded a touch): a few
 * thousand skinned vertices, not every one. Used only while warming up, when nothing is on screen.
 */
function poseBox(root: Object3D, out = new Box3()) {
  root.updateWorldMatrix(true, true);
  out.makeEmpty();
  const v = new Vector3();
  for (const m of meshesOf(root)) {
    if (!m.visible) continue;
    const s = m as SkinnedMesh;
    if (s.isSkinnedMesh) {
      const count = s.geometry.getAttribute('position')?.count ?? 0;
      const stride = Math.max(1, Math.ceil(count / POSE_SAMPLES));
      for (let i = 0; i < count; i += stride) out.expandByPoint(s.getVertexPosition(i, v).applyMatrix4(s.matrixWorld));
    } else {
      out.union(new Box3().setFromObject(m, false));
    }
  }
  if (!out.isEmpty()) out.expandByVector(out.getSize(v).multiplyScalar(0.01));
  return out;
}

interface Parts {
  cloudGlow: Object3D | null;
  cloudFade: Object3D | null;
  /** The bone the cloud in his hands rides on (where the veil grows from if the magic cloud is not up yet). */
  heldBone: Object3D | null;
  /** The sun and bolt's own glowing copies of their materials. */
  sun: MeshStandardMaterial[];
  cloud: MeshStandardMaterial[];
  restore: [Mesh, Material | Material[]][];
  /** The magic cloud's depth-only copies (see cloudLook.ts), removed on cleanup. */
  depth: Mesh[];
}

/**
 * A depth-only copy of one of the magic cloud's meshes: the same geometry, skeleton and morph
 * weights (shared, so it moves exactly with it), drawn just before it (see cloudLook.ts).
 */
function depthCopy(m: Mesh): Mesh {
  const mats = materialsOf(m).map(magicCloudDepthLook);
  const material = Array.isArray(m.material) ? mats : mats[0];
  const s = m as SkinnedMesh;
  let copy: Mesh;
  if (s.isSkinnedMesh) {
    const k = new SkinnedMesh(s.geometry, material);
    k.bindMode = s.bindMode;
    k.bind(s.skeleton, s.bindMatrix);
    copy = k;
  } else {
    copy = new Mesh(m.geometry, material);
  }
  // the same array: the mixer animates the original's morph weights, and the copy reads them
  if (m.morphTargetInfluences) copy.morphTargetInfluences = m.morphTargetInfluences;
  if (m.morphTargetDictionary) copy.morphTargetDictionary = m.morphTargetDictionary;
  copy.name = `${m.name}:depth`;
  copy.renderOrder = CLOUD_DEPTH_ORDER;
  copy.frustumCulled = false;
  m.add(copy);                     // a child at rest: exactly the original's place
  return copy;
}

/** Finds the control empties and gives the glowing parts their own materials (restored on cleanup). */
function prepareParts(coco: Object3D, cloud: Object3D): Parts {
  const restore: Parts['restore'] = [];
  const own = (m: Mesh, setup: (c: MeshStandardMaterial) => void, list: MeshStandardMaterial[]) => {
    restore.push([m, m.material]);
    const copy = (mat: Material) => { const c = mat.clone() as MeshStandardMaterial; setup(c); list.push(c); return c; };
    m.material = Array.isArray(m.material) ? m.material.map(copy) : copy(m.material);
  };
  // the sun and bolt behind him: the same soft, steady glow as at home
  const sun: MeshStandardMaterial[] = [];
  const sunNode = coco.getObjectByName(SUN_BOLT);
  if (sunNode) {
    for (const m of meshesOf(sunNode)) {
      own(m, (c) => {
        if (!c.emissive) return;
        c.emissive.set(SUN_GLOW.colour);
        c.emissiveMap = c.map ?? null;
        c.emissiveIntensity = SUN_GLOW.intensity;
      }, sun);
    }
  }
  // the magic cloud: drawn after him, depth-tested against him, its own depth written just before it
  const cloudMats: MeshStandardMaterial[] = [];
  const magic = meshesOf(cloud);
  for (const m of magic) {
    m.renderOrder = CLOUD_ORDER;
    own(m, magicCloudLook, cloudMats);
  }
  const depth = magic.map(depthCopy);
  neverCullSkinned(coco);
  neverCullSkinned(cloud);
  return {
    cloudGlow: cloud.getObjectByName('ctl_glow') ?? null,
    cloudFade: cloud.getObjectByName('ctl_fade') ?? null,
    heldBone: coco.getObjectByName('cloud') ?? null,
    sun,
    cloud: cloudMats,
    restore,
    depth,
  };
}

const freshClock = () => ({
  started: false,
  /** The one clock: where the take is on the master timeline (seconds). */
  master: 0,
  lastFrame: -Infinity, jumpsApplied: 0,
  cloudStarted: false, cloudStart: 0, cloudIn: 1, cloudInSeconds: 0,
  /** The take's playback pace (1, or slower while the trip home waits). */
  pace: freshPace(),
  /** The furthest master frame it may drift to while waiting (worked out when the take starts). */
  waitLimit: Infinity,
  /** The trip home waited for the visitor: the take stays held to the veil's cover. */
  waited: false,
  /** The models are in (or crossfading into) their hold loops. */
  holding: false,
});

// ── the take ───────────────────────────────────────────────

function Take(props: InvitationStageProps) {
  const [coco, take, cloud, ride] = useLoader(TAKE.Loader, modelUrls());
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const rig = useRef<Group>(null!);
  const live = useRef(props);
  live.current = props;
  const { phase, timeline, jump } = props;

  const players = useRef<{ coco: ClipPlayer; cloud: ClipPlayer; ride: ClipPlayer } | null>(null);
  const parts = useRef<Parts | null>(null);
  const rideParts = useRef<RideParts | null>(null);
  // the ride cloud rides on his root bone (its rest is captured before any clip poses him)
  const follow = useMemo(() => { const f = createRootFollow(coco.scene, ride.scene); f.capture(); return f; }, [coco, ride]);
  // his pose at his spot, and on the take's first frame, measured once in the take's own units (metres)
  const framing = useRef<{ size: Vector3; centre: Vector3 } | null>(null);
  const startBox = useRef<Box3 | null>(null);
  const clock = useRef(freshClock());
  const values = useRef({ glow: 0, fade: 1 });
  const resumed = useRef(false);
  const tmp = useMemo(() => ({ box: new Box3(), v: new Vector3(), m: new Matrix4() }), []);

  const fps = timeline?.fps ?? 60;
  // where each clip sits on the master timeline; the magic cloud starts at the glow unless the file says
  const span = (name: string, p?: ClipPlayer): ClipSpan | undefined =>
    name === 'transform' && timeline && p ? cloudSpan(timeline, p.duration('transform')) : timeline?.clips[name];
  const masterFrame = () => clock.current.master * fps;
  const local = (p: ClipPlayer, clip: string, frame: number) => clipLocalTime(span(clip, p), frame, p.duration(clip), fps);
  /** The master frame his ride ends on ('invite' ends on breathe frame 0): from here he breathes and floats. */
  const arrivedFrame = (p: ClipPlayer) => {
    const s = timeline?.clips[TAKE_CLIP];
    return s ? s.endFrame : (timeline ? takeStartFrame(timeline) : 0) + p.duration(TAKE_CLIP) * fps;
  };

  /**
   * Puts him where the take is at master frame `frame`: his ride in, or (once he has arrived) his
   * model's own 'breathe' loop at the same moment of it, with 'float' layered on. `fade` > 0 eases
   * there from wherever he is (a crossfade, in real time).
   */
  /** The ride cloud where the take is at master frame `frame` (`fade`: a crossfade, in real time). */
  function rideAt(p: ClipPlayer, frame: number, fade = 0) {
    if (p.has(RIDE_CLIP)) p.play(RIDE_CLIP, { loop: false, time: local(p, RIDE_CLIP, frame), fade });
  }

  /** Moves the ride cloud with his root bone and gives it Blender's glow and opacity. */
  function rideLook() {
    follow.follow();
    const rp = rideParts.current;
    ride.scene.visible = !!rp && applyRideLook(rp) > 0.002;
  }

  function playAt(p: ClipPlayer, frame: number, fade = 0) {
    const arrived = arrivedFrame(p);
    if (frame < arrived || !p.has(BREATHE)) {
      p.play(TAKE_CLIP, { loop: false, time: local(p, TAKE_CLIP, frame), fade });
      return;
    }
    const loop = Math.max(1e-3, p.duration(BREATHE));
    p.play(BREATHE, { time: ((frame - arrived) / fps) % loop, fade });
    p.loopLayer(FLOAT, { fadeIn: Math.max(fade, FLOAT_IN_SECONDS) });
  }

  // players and glowing materials: created here, torn down completely
  useEffect(() => {
    // his model's own clips, and his ride from the take's file (the same rig: it binds by bone name)
    const p = {
      coco: new ClipPlayer(coco.scene, [...coco.animations, ...take.animations], { additive: (n) => n === FLOAT, fps: MODEL_FPS }),
      cloud: new ClipPlayer(cloud.scene, cloud.animations),
      ride: new ClipPlayer(ride.scene, ride.animations),
    };
    players.current = p;
    parts.current = prepareParts(coco.scene, cloud.scene);
    rideParts.current = prepareRide(ride.scene, RIDE_ORDER);
    cloud.scene.visible = false;
    rig.current.visible = false;            // nothing is drawn until the take starts
    if (p.coco.has(TAKE_CLIP)) live.current.onLoaded();
    else { console.warn(`[invitation] coco-invite.glb has no "${TAKE_CLIP}" clip`); live.current.onFail(); }
    return () => {
      p.coco.dispose();
      p.cloud.dispose();
      p.ride.dispose();
      rideParts.current?.dispose();
      rideParts.current = null;
      for (const [m, mat] of parts.current?.restore ?? []) m.material = mat;
      parts.current?.sun.forEach((m) => m.dispose());
      parts.current?.cloud.forEach((m) => m.dispose());
      for (const d of parts.current?.depth ?? []) { d.removeFromParent(); materialsOf(d).forEach((m) => m.dispose()); }
      parts.current = null;
      players.current = null;
      clock.current = freshClock();
    };
  }, [coco, take, cloud, ride]);

  // A hidden tab: the clock holds (see useFrame). Coming back, the first step is one frame long,
  // never the whole time away.
  useEffect(() => {
    const onVisibility = () => { if (!document.hidden) resumed.current = true; };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Warming: measure his pose at his spot (for the framing) and on the take's first frame (is it
  // off-screen?), make 'float' additive, compile every shader and upload every texture, unseen,
  // then report. All the heavy work happens here, before anything is on screen.
  useEffect(() => {
    if (phase !== 'warming' || !timeline || !players.current) return;
    const p = players.current;
    let cancelled = false;
    if (p.coco.has(TAKE_CLIP)) {
      rig.current.updateWorldMatrix(true, false);
      const toRig = tmp.m.copy(rig.current.matrixWorld).invert();
      // framed on him at rest at his spot (the end of his ride)
      // (him and the ride cloud under him: the stage keeps room for both)
      const withRide = (frame: number, box: Box3) => {
        if (!p.ride.has(RIDE_CLIP)) return box;
        rideAt(p.ride, frame);
        p.ride.refresh();
        follow.follow();
        ride.scene.updateWorldMatrix(true, true);
        return box.union(cheapBox(ride.scene, new Box3()).applyMatrix4(toRig));
      };
      const arrive = timeline.markers.arrive ?? arrivedFrame(p.coco);
      p.coco.play(TAKE_CLIP, { loop: false, time: local(p.coco, TAKE_CLIP, arrive) });
      p.coco.refresh();
      const box = withRide(arrive, poseBox(coco.scene, new Box3()).applyMatrix4(toRig));
      if (!box.isEmpty()) framing.current = { size: box.getSize(new Vector3()), centre: box.getCenter(new Vector3()) };
      p.coco.play(TAKE_CLIP, { loop: false, time: local(p.coco, TAKE_CLIP, takeStartFrame(timeline)) });
      p.coco.refresh();
      const first = withRide(takeStartFrame(timeline), poseBox(coco.scene, new Box3()).applyMatrix4(toRig));
      startBox.current = first.isEmpty() ? null : first;
    }
    while (p.coco.prepareNext()) { /* 'float' made additive now, not on the frame he arrives */ }
    const textures = new Set([...texturesUnder(coco.scene), ...texturesUnder(cloud.scene), ...texturesUnder(ride.scene)]);
    (async () => {
      try {
        // compiled for the scene's own lights, though nothing is visible yet; both models at once
        if (gl.compileAsync) {
          await Promise.all([gl.compileAsync(coco.scene, camera, scene), gl.compileAsync(cloud.scene, camera, scene), gl.compileAsync(ride.scene, camera, scene)]);
        } else {
          gl.compile(coco.scene, camera, scene);
          gl.compile(cloud.scene, camera, scene);
          gl.compile(ride.scene, camera, scene);
        }
        await uploadGradually(gl, textures, () => cancelled);
        // one frame of everything (him and the magic cloud), drawn while the canvas is
        // still invisible: vertex buffers, morph textures and sort bounds are built now, not on the
        // take's first frame or the frame the magic cloud appears
        if (!cancelled) {
          placeRig();
          drawOnce(gl, scene, camera, [rig.current]);
        }
      } catch (e) {
        console.warn('[invitation] warm-up skipped', e);
      }
      if (!cancelled) live.current.onWarm();
    })();
    return () => { cancelled = true; };
  }, [phase, timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  // The take starts once, as soon as the machine is past warming, whichever state React commits
  // first (a "Come on in" can arrive in the same moment as WARM). A pending jump then applies.
  useEffect(() => {
    const p = players.current;
    const c = clock.current;
    if (!timeline || !p || !TAKE_RUNS.includes(phase)) return;
    if (!c.started) {
      const jumped = jump > c.jumpsApplied;
      c.jumpsApplied = jump;
      startTake(jumped ? Math.max(takeStartFrame(timeline), timeline.markers.glow) : takeStartFrame(timeline), jumped);
      return;
    }
    if (jump > c.jumpsApplied) {
      c.jumpsApplied = jump;
      jumpToGlow();
    }
  }, [phase, timeline, jump]); // eslint-disable-line react-hooks/exhaustive-deps

  function startTake(frame: number, jumped: boolean) {
    const p = players.current!;
    const tl = timeline!;
    const c = clock.current;
    c.started = true;
    c.master = frame / fps;
    c.lastFrame = frame - 1e-3;           // so a marker on the very first frame (floatIn) is reported
    c.cloudStart = span('transform', p.cloud)?.startFrame ?? tl.markers.glow;
    if (!tl.clips.transform) console.warn('[invitation] timeline.json has no "transform" clip: the magic cloud starts at the glow');
    // how far the take may drift if the trip home has to wait: the next beat, or the end of the
    // cloud's clip (he breathes on for as long as it takes)
    const ends: number[] = [];
    if (p.cloud.has('transform')) ends.push(cloudSpan(tl, p.cloud.duration('transform')).endFrame);
    c.waitLimit = waitLimitFrame(tl, ends);
    playAt(p.coco, frame);
    p.coco.refresh();
    rideAt(p.ride, frame);
    p.ride.refresh();
    rideLook();
    if (frame >= c.cloudStart) startCloud(frame);
    placeRig();
    rig.current.visible = true;
    // fully off-screen on the first frame? If not at this aspect (or it starts part-way), fade it in.
    let shows = jumped || !startBox.current;
    if (!shows) {
      rig.current.updateWorldMatrix(true, false);
      shows = boxShows(tmp.box.copy(startBox.current!).applyMatrix4(rig.current.matrixWorld), camera);
    }
    const el = gl.domElement;
    el.style.transition = shows ? `opacity ${FADE_IN_SECONDS}s ease-out` : 'none';
    el.style.opacity = '1';
  }

  // "Come on in": jump the one clock to the glow with an eased crossfade (no snap).
  function jumpToGlow() {
    const p = players.current;
    if (!timeline || !p) return;
    const c = clock.current;
    const glow = timeline.markers.glow;
    const now = masterFrame();
    if (now >= glow) return;
    c.master = glow / fps;
    playAt(p.coco, glow, JUMP_SECONDS);
    rideAt(p.ride, glow, JUMP_SECONDS);
    if (c.cloudStarted) p.cloud.play('transform', { loop: false, time: local(p.cloud, 'transform', glow), fade: JUMP_SECONDS });
    else if (glow >= c.cloudStart) startCloud(glow, JUMP_SECONDS);
    c.lastFrame = glow - 1e-3;            // the skipped beats stay unspoken; the glow is next
  }

  function startCloud(frame: number, fade = 0) {
    const p = players.current;
    if (!p) return;
    const c = clock.current;
    const pa = parts.current;
    c.cloudStarted = true;
    // started by a jump it eases in alongside him; with no authored fade (no ctl_fade) it eases in
    // on its own; otherwise ctl_fade (Blender) brings it in
    c.cloudInSeconds = fade > 0 ? fade : pa && !pa.cloudFade ? CLOUD_IN_SECONDS : 0;
    c.cloudIn = c.cloudInSeconds > 0 ? 0 : 1;
    cloud.scene.visible = true;
    if (p.cloud.has('transform')) {
      p.cloud.play('transform', { loop: false, time: local(p.cloud, 'transform', frame), fade });
      p.cloud.refresh();
    }
    // the glow and fade start from the clip's own values on this frame, not from stale ones
    if (pa) {
      const v = values.current;
      v.glow = pa.cloudGlow?.scale.x ?? 0;
      v.fade = pa.cloudFade?.scale.x ?? 1;
    }
  }

  /**
   * Frames him in the stage box: metres → the stage's scale, centred on his pose at his spot. Both
   * boxes are measured against the canvas (which scrolls with the page), so scrolling never moves
   * him relative to the stage.
   */
  function placeRig() {
    const el = live.current.stageEl.current;
    const cv = gl.domElement.getBoundingClientRect();
    const W = cv.width || window.innerWidth;
    const H = cv.height || window.innerHeight;
    const k = (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360)) / H;
    const r = el?.getBoundingClientRect() ?? { left: cv.left, top: cv.top, width: W, height: H };
    const f = framing.current;
    const g = rig.current;
    if (!f || f.size.y <= 0) { g.scale.setScalar(1); g.position.set(0, 0, 0); return; }
    const s = Math.min((HEIGHT_SHARE * r.height * k) / f.size.y, (WIDTH_SHARE * r.width * k) / Math.max(f.size.x, 1e-3));
    const cx = (r.left - cv.left + r.width / 2 - W / 2) * k;
    const cy = -(r.top - cv.top + r.height / 2 - H / 2) * k;
    g.scale.setScalar(s);
    g.position.set(cx - f.centre.x * s, cy - f.centre.y * s, -f.centre.z * s);
  }

  /**
   * Where the cloud is in the window (0..1 from the top left), for the veil's origin. Cheap: the
   * magic cloud's stored bounds, else the bone of the cloud in his hands, else his framed centre.
   * Never per-vertex.
   */
  function focusAt() {
    const v = tmp.v;
    let found = false;
    if (cloud.scene.visible) {
      const b = cheapBox(cloud.scene, tmp.box);
      if (!b.isEmpty()) { b.getCenter(v); found = true; }
    }
    const bone = parts.current?.heldBone;
    if (!found && bone) { bone.getWorldPosition(v); found = true; }
    if (!found && framing.current) { v.copy(framing.current.centre).applyMatrix4(rig.current.matrixWorld); found = true; }
    if (!found) return { x: 0.5, y: 0.5 };
    v.project(camera);
    // on the canvas, then in the window (the canvas covers the page, which may be scrolled)
    const cv = gl.domElement.getBoundingClientRect();
    const x = cv.left + ((v.x + 1) / 2) * cv.width;
    const y = cv.top + ((1 - v.y) / 2) * cv.height;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { x: clamp(x / Math.max(1, window.innerWidth)), y: clamp(y / Math.max(1, window.innerHeight)) };
  }

  // the page may ask where the cloud is (a trip the safety net starts before 'luminous', or one
  // that waited for the visitor)
  useEffect(() => {
    const probe = live.current.focusProbe;
    if (!probe) return;
    probe.current = () => (players.current ? focusAt() : { x: 0.5, y: 0.5 });
    return () => { probe.current = null; };
  });

  useFrame((_, rawDt) => {
    const p = players.current;
    if (!p) return;
    placeRig();
    const P = live.current;
    if (P.paused || document.hidden) return;          // a hidden tab: the clock holds where it is
    // a frame with no time in it (a coarse timer can report exactly 0): nothing moves, and nothing
    // may divide by it (a NaN speed would freeze the clips for good)
    if (!(rawDt > 0)) return;
    let dt = Math.min(rawDt, MAX_DT);
    if (resumed.current) { resumed.current = false; dt = Math.min(dt, 1 / 60); }
    const c = clock.current;
    if (!c.started) {
      return;
    }
    // the trip home waits for the visitor: models with an authored hold loop crossfade into it,
    // and back to the take (where its clock is then) when the trip carries on; otherwise the take
    // eases down (see pace.ts). Only from luminous: the transformation always plays at full speed.
    const waiting = slowsForWait(P.phase, masterFrame(), timeline?.markers.luminous ?? -Infinity);
    if (waiting) c.waited = true;
    if (waiting !== c.holding) {
      c.holding = waiting;
      if (waiting) {
        if (p.coco.has(HOLD_CLIP)) p.coco.play(HOLD_CLIP, { fade: HOLD_FADE_SECONDS });
        if (c.cloudStarted && p.cloud.has(HOLD_CLIP)) p.cloud.play(HOLD_CLIP, { fade: HOLD_FADE_SECONDS });
      } else {
        const f = masterFrame();
        if (p.coco.current === HOLD_CLIP) playAt(p.coco, f, HOLD_FADE_SECONDS);
        if (p.cloud.current === HOLD_CLIP) p.cloud.play('transform', { loop: false, time: local(p.cloud, 'transform', f), fade: HOLD_FADE_SECONDS });
      }
    }
    // after a wait, the take stays held to the veil until it has covered (see pace.ts)
    let coverLeft: number | null = null;
    if (c.waited && P.phase === 'carrying') {
      const v = veil.snapshot();
      if (v.phase === 'covering') coverLeft = Math.max(0, (v.since + v.length - veil.now()) / 1000);
    }
    // the one clock, at the take's pace: full speed, or slower while the trip home waits
    const room = Number.isFinite(c.waitLimit) ? (c.waitLimit - masterFrame()) / fps : Infinity;
    const holdingAll = waiting && p.coco.has(HOLD_CLIP) && (!c.cloudStarted || p.cloud.has(HOLD_CLIP));
    const step = stepPace(c.pace, { waiting, roomSeconds: room, holding: holdingAll, coverLeft }, dt);
    c.master += step;
    // the take's clips at that pace, every copy of them (one still fading out under a crossfade
    // keeps in step with the clock, never running on past the beat); his breathing, a hold loop and
    // crossfades run in real time
    const speed = step / dt;
    p.coco.setSpeed(TAKE_CLIP, speed);
    p.coco.update(dt);
    p.ride.setSpeed(RIDE_CLIP, speed);
    p.ride.update(dt);
    const frame = masterFrame();
    // he has arrived: his ride ends on breathe frame 0 (pose and velocity), so 'breathe' takes
    // over at once, from the moment the clock is at, and 'float' eases in on top
    if (p.coco.current === TAKE_CLIP && frame >= arrivedFrame(p.coco)) {
      playAt(p.coco, frame);
      p.coco.refresh();
    }
    rideLook();
    if (!c.cloudStarted && frame >= c.cloudStart) startCloud(frame);
    else if (c.cloudStarted) {
      p.cloud.setSpeed('transform', speed);
      p.cloud.update(dt);
    }

    // Blender's control values → materials (glTF cannot animate them in three), eased a touch
    const pa = parts.current;
    if (pa) {
      const e = 1 - Math.exp(-dt * 14);
      const vals = values.current;
      vals.glow += ((pa.cloudGlow?.scale.x ?? 0) - vals.glow) * e;
      vals.fade += ((pa.cloudFade?.scale.x ?? 1) - vals.fade) * e;
      if (c.cloudIn < 1) c.cloudIn = Math.min(1, c.cloudIn + dt / Math.max(1e-3, c.cloudInSeconds));
      const opacity = c.cloudStarted ? Math.min(1, Math.max(0, vals.fade)) * smoothstep(c.cloudIn) : 0;
      for (const m of pa.cloud) { m.emissiveIntensity = Math.max(0, vals.glow) * GLOW_STRENGTH; m.opacity = opacity; }
      cloud.scene.visible = c.cloudStarted && opacity > 0.002;
    }

    if (timeline) {
      const crossed = markersCrossed(timeline, c.lastFrame, frame);
      c.lastFrame = Math.max(c.lastFrame, frame);
      for (const name of crossed) P.onMarker(name, name === 'luminous' ? focusAt() : undefined);
    }
  });

  // hidden from its very first commit (not only from the effect after it): a frame drawn in between
  // would skin him on the CPU to cull him and compile every shader on the spot
  return (
    <group ref={rig} visible={false}>
      <primitive object={coco.scene} />
      <primitive object={ride.scene} />
      <primitive object={cloud.scene} />
    </group>
  );
}

export default function InvitationStage(props: InvitationStageProps) {
  // decided once, before anything is shown: a change of resolution mid-take would show
  // (the canvas covers the page: kept within a pixel budget too, see stageDpr)
  const [dpr] = useState(() => stageDpr(qualityTier(), window.devicePixelRatio, window.innerWidth * window.innerHeight));
  const lost = useRef(props.onFail);
  lost.current = props.onFail;
  const pendingRelease = useRef(0);

  // Leaving the invitation for good (the take finished, or the visitor left while it was still
  // loading): stop any download still running, free whatever loaded, and forget it, so home never
  // carries it and a replay fetches afresh (a failed load is not remembered either). Deferred a
  // tick so React's development double-mount does not throw the models away.
  useEffect(() => {
    window.clearTimeout(pendingRelease.current);
    return () => {
      pendingRelease.current = window.setTimeout(() => TAKE.release(modelUrls()), 0);
    };
  }, []);

  return (
    <Canvas
      className="invitation__canvas"
      flat
      style={{ pointerEvents: 'none' }}
      dpr={[1, dpr]}
      // it never takes pointer events, so it need not track its place while the page scrolls
      resize={{ scroll: false }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: FOV, near: 0.1, far: 60, position: [0, 0, CAMERA_Z] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        // shader status round trips (the info logs) only while developing: they stall a first draw
        gl.debug.checkShaderErrors = import.meta.env.DEV;
        gl.domElement.style.opacity = '0';      // nothing shows until the take starts
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost.current(); });
      }}
      aria-hidden
    >
      <hemisphereLight args={['#fff4e2', '#d9905e', 2.1]} />
      <directionalLight position={[2.5, 3.5, 5]} intensity={2.6} color="#fff0d0" />
      <directionalLight position={[-3, 1.5, 3]} intensity={0.9} color="#d6fbf6" />
      <Suspense fallback={null}>
        <Take {...props} />
      </Suspense>
    </Canvas>
  );
}
