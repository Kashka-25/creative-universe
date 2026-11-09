// Adult Coco, the visitor's companion: a closed-eyed sage seated on his cloud, the sun and lightning
// bolt behind him. One transparent layer fixed over the window, above the page's content and below
// the header, the menu, dialogs and the cloud veil (pointer-events: none: he never blocks a click).
//
// Where he is (companion.ts decides, space.ts finds the empty space):
// - At the top of home he is the hero's Coco: big (HERO.grow times his calm size), in the hero's own
//   space ([data-guide-space]), scrolling with it. While the hero is on screen there is no other Coco.
// - Everywhere else (every page but About, and home once the hero has scrolled away) he is the
//   companion, smaller (COMPANION_SCALE of his calm size), riding his swirl cloud like a magic carpet
//   (Cassidy, 9 Nov 2026): he travels with the visitor in the window as they scroll, drifting towards
//   the best empty space on the screen (ride.ts: a speed-capped, critically damped drift with a gentle
//   lean, hysteresis on his aim, content seen a moment early as the page carries it). The page is
//   measured only when it changes (negativeSpace.ts createLayoutCache); the section swirl clouds count
//   as content. A way to a new space that would cross content: he waits where he is while that is
//   clear, otherwise he fades out quickly and in at the new space. His first entrance (the page opens,
//   the hero scrolls away) is Blender's 'flyin' clip from the nearer side of the window, with a soft
//   shimmer as he lands; then the cloud idles under him ('rest').
//   Where no empty space fits him (phones, tablets, pages full of cards) he does not leave the
//   visitor ("Keep him with me"): he flies in to peek from a bottom corner of the window, small and
//   fixed to it, the one place he may sit over content; a control under that corner (focused by
//   keyboard, or fixed to the window) keeps him out of it (companion.ts cornerSpot, controlInCorner).
//   Back to the hero (scrolling up to it), the companion fades out quietly and the hero's Coco fades in.
// Every movement is a Blender clip from coco-sage.glb, played by ClipPlayer: 'breathe' loops, with
// 'float' (a slow hover) layered on it when the model has it; arriving from the invitation he plays
// 'settle' first (once the cloud starts to clear, so it is seen) and joins 'breathe' at its first
// frame; rare drifts start on a breath's loop boundary; a face flutter now and then; small
// reactions to the visitor. His ride cloud follows his root bone (characters/rideCloud.ts).
// Loads coco-sage.glb through his own loader: if home gives up on him (too slow, a lost context, an
// error) the download stops and whatever loaded is freed. The ride cloud (ride-cloud.glb, small) is
// loaded only once he first becomes the companion, after the page is drawn, and kept (one copy).
// Lazy chunk (with three.js); the page never waits for it. Nothing is shown until his shaders are
// compiled, his textures uploaded and one frame drawn unseen (buffers, morph textures), so he
// appears without a hitch. The resolution is decided once, before he is shown, and never changes
// while he is on screen.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Box3, Matrix4, Vector3, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { asset } from '../content';
import { prefersReducedMotion, qualityTier, stageDpr } from '../intro/capability';
import { ClipPlayer } from '../characters/ClipPlayer';
import { createModelSource } from '../characters/modelSource';
import { drawOnce, neverCullSkinned, restBox, texturesUnder, uploadGradually } from '../characters/sceneUtils';

/** A box's height. */
const shapeH = (b: Box3) => Math.max(1e-6, b.max.y - b.min.y);
import { veil } from '../veil/veil';
import { attention, listen } from './attention';
import { createIdleScheduler, DRIFTS, REACTIONS, type IdleScheduler } from './idle';
import { applyRideLook, createRootFollow, ctlValue, prepareRide, type RideParts } from '../characters/rideCloud';
import { cornerSpot, EDGE_MARGIN, flightAt, flightBank, flightTimeout, heroMode, heroSpot } from './companion';
import { cornerFree, createLayoutCache, stopAnchors, type LayoutCache } from './negativeSpace';
import { aimStep, createAim, createRider, followStep, moveKind, overlapArea, placeRider, RIDE as RIDING, sweep, type Rider } from './ride';
import { createStopHold, holdStop, restSpot, stopFor, tourOn, type StopName } from './tour';
import { findSpace, pathClear, ROAM, spaceSizes, spotBox, stillClear, SWAY, visibleShare, type Spot } from './space';
import { ADULT_URL, RIDE_CLOUD_URL } from './paths';

const CAMERA_Z = 10;
const FOV = 30;
/** coco-sage's clips are authored at 30 fps. */
const FPS = 30;
/** His slow hover, an additive loop over 'breathe' (if the model has it). */
const FLOAT = 'float';
const ADDITIVE = new Set<string>([...DRIFTS, 'flutter', ...REACTIONS, FLOAT]);
const SUN_BOLT = 'sun_bolt';
/** On pages he is this much smaller than his calm size (Cassidy: a smaller character riding his cloud). */
export const COMPANION_SCALE = 0.65;
/** How far ahead (s, px at most) his own box looks for content the scroll is carrying to him. */
const GUARD = { ...RIDING, sweepS: 0.12, sweepMax: 60 };
/** A space must hold this long (s) before he leaves his corner peek for it. */
const OPEN_S = ROAM.openS;
/** Development only, with ?cocotrace in the address: one line per frame of where he is (for measuring). */
const TRACE = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('cocotrace');
/** Leaving for About, his layer fades out (intro.css); after this long (s) he is no longer drawn. */
const AWAY_S = 0.8;
/** With no room he fades out (intro.css, --coco-fade); after this long (s) he is unseen. */
const FADE_S = 0.8;
/** How often (s) he checks that the page's content has not come under him. */
const CHECK_S = 0.1;
/** The ride cloud's clips (ride-cloud.glb). */
const FLY = 'flyin';
const REST = 'rest';
/** Drawn after him. */
const RIDE_ORDER = 1;
/** If his ride cloud has not arrived this long (s) after he first needs it, he appears without it (no flight). */
const RIDE_WAIT_S = 3;

/** His ride cloud, through a loader of its own (one copy for the visit; freed with him). */
const RIDE = createModelSource();
const rideUrl = () => asset(RIDE_CLOUD_URL);

/**
 * His model, through a loader of his own (never shared with the invitation's). Bytes that arrive
 * while the cloud veil is clearing wait for it to finish before they are parsed, so the parse never
 * lands in the middle of the clearing.
 */
const ADULT = createModelSource((L, urls) => useLoader.clear(L, urls), { hold: () => veil.phase === 'revealing' });
const adultUrl = () => asset(ADULT_URL);

/**
 * His bounding box in the model's own space, in his rest pose, with the sun and bolt. From the
 * stored geometry bounds: no per-vertex skinning (65k vertices) on the way in.
 */
function measure(scene: Object3D): Box3 {
  scene.updateWorldMatrix(true, true);
  const toLocal = scene.parent ? new Matrix4().copy(scene.parent.matrixWorld).invert() : new Matrix4();
  return restBox(scene).applyMatrix4(toLocal);
}

interface AdultProps { arriving: boolean; away: boolean; onReady: () => void }

/** His entrance to a space (window px), on Blender's 'flyin' clip. */
interface Flight { from: Spot; to: Spot; t: number; wall0: number; corner: Corner }
/** Peeking from a bottom corner of the window (no empty space fits him), or not. */
type Corner = 'right' | 'left' | null;

const freshPlace = () => ({
  init: false,
  /** Where he is drawn, in his layer's CSS px (centre, height), and his lean (rad). */
  x: 0, y: 0, h: 1, bank: 0,
  /** The hero's Coco (top of home) or the companion. */
  mode: 'companion' as 'hero' | 'companion' | 'tour',
  /** In the hero: his place (document px; it scrolls with the hero). */
  spot: null as Spot | null,
  /** Riding with the visitor: where he is and his drift (window px), what he drifts towards, his aim. */
  rider: null as Rider | null,
  target: null as Spot | null,
  aim: createAim(),
  /** He has made his entrance since he became the companion (later moves are drifts or fades). */
  entered: false,
  /** The page's scroll speed (px/s, smoothed) and where it was last frame. */
  vs: 0, lastSy: NaN,
  /** In his corner peek: since when a space has been open for him (s). */
  openSince: NaN,
  /** He is meant to be shown (faded in) at his spot. */
  shown: false,
  /** On his way to a new space. */
  flight: null as Flight | null,
  /** Peeking from this bottom corner of the window (fixed to it, not to the page). */
  corner: null as Corner,
  /** Seated on his ride cloud (the companion, once it has arrived). */
  riding: false,
  /** Some of him was in the window on the last frame (he is drawn only then). */
  seen: true,
  /** Shown (1) or faded out (0), and since when (s). */
  fade: 1 as 0 | 1, fadeAt: -Infinity,
  /** When he last looked around and checked his corner (s); the page he is on. */
  lookedAt: -Infinity, checkedAt: -Infinity, page: '',
  /** When he first needed his ride cloud (s). */
  rideWanted: NaN,
  /** He is away (on About), and since when (s). */
  away: false, awaySince: 0,
  /** He has just been placed, unseen, in a new space: his layer fades in from the next frame. */
  appear: false,
  /** His float loop has been started (or the model has none). */
  floating: false,
  /** The home journey (tour.ts): the stop he is going to (held), its resting place (document px, checked
   * now and then), whether his drift is in the page or in the window (the corner), his cloud's opacity
   * (none at rest in the hero), and whether he fades in at his first stop. */
  hold: createStopHold(),
  stop: null as StopName | null,
  stopSpot: null as Spot | null, stopCheckedAt: -Infinity,
  tourFrame: 'doc' as 'doc' | 'win',
  cushion: 0,
  tourAppear: false,
});

/** His ride cloud, once loaded and warm. */
interface Ride { gltf: GLTF; player: ClipPlayer; parts: RideParts; follow: ReturnType<typeof createRootFollow>; box: Box3; warm: boolean }

function Adult({ arriving, away, onReady }: AdultProps) {
  const gltf = useLoader(ADULT.Loader, adultUrl());
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const group = useRef<Group>(null!);
  const frame = useMemo(() => measure(gltf.scene), [gltf]);
  /** His width as a share of his height (the whole emblem, sun and bolt included). */
  const aspect = useMemo(() => {
    const w = frame.max.x - frame.min.x, h = frame.max.y - frame.min.y;
    return h > 0 && w > 0 ? w / h : 0.9;
  }, [frame]);
  const player = useRef<ClipPlayer | null>(null);
  const idle = useRef<IdleScheduler | null>(null);
  const clock = useRef(0);
  const warm = useRef(false);
  const shownFrames = useRef(0);
  const readySent = useRef(false);
  /** Arriving: 'settle' waits on its first frame until the cloud starts to clear. */
  const holding = useRef(false);
  /** He responds to the visitor only once he is visible and has settled. */
  const attentive = useRef(false);
  const resumed = useRef(false);
  const awayNow = useRef(away);
  awayNow.current = away;
  const place = useRef(freshPlace());
  /** The page's layout, measured only when it changes. */
  const layout = useRef<LayoutCache | null>(null);
  useEffect(() => { const c = createLayoutCache(); layout.current = c; return () => { c.dispose(); layout.current = null; }; }, []);
  const ride = useRef<Ride | null>(null);
  const rideHolder = useRef<Group>(null!);
  const rideLoading = useRef(false);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const tmp = useMemo(() => ({ c: new Vector3(), screen: new Vector3(), box: new Box3(), box2: new Box3(), cB: new Vector3(), cU: new Vector3() }), []);
  // his root bone's rest, before any clip poses him (his ride cloud follows its movement from there)
  const restRoot = useMemo(() => {
    const m = new Matrix4();
    const bone = gltf.scene.getObjectByName('root');
    if (bone) { gltf.scene.updateWorldMatrix(true, true); m.copy(gltf.scene.matrixWorld).invert().multiply(bone.matrixWorld); }
    return m;
  }, [gltf]);

  // His clips: one mixer, created here and torn down completely (StrictMode-safe).
  useEffect(() => {
    neverCullSkinned(gltf.scene);
    const p = new ClipPlayer(gltf.scene, gltf.animations, { additive: (n) => ADDITIVE.has(n), fps: FPS });
    holding.current = false;
    place.current.floating = false;
    if (arriving && p.has('settle')) {
      p.introThenLoop('settle', 'breathe');
      p.refresh();                          // posed on settle's first frame, and held there
      holding.current = true;
    } else p.play('breathe');
    player.current = p;
    idle.current = createIdleScheduler(Math.floor(Math.random() * 1e6) + 1, clock.current, {
      drifts: DRIFTS.filter((d) => p.has(d)),
      has: (c) => p.has(c),
      length: (c) => p.duration(c),
    });
    return () => { p.dispose(); player.current = null; idle.current = null; };
  }, [gltf, arriving]);

  // The sun and bolt behind him: a steady, soft glow (a material setting, not movement).
  useEffect(() => {
    const node = gltf.scene.getObjectByName(SUN_BOLT) ?? null;
    const restore: [Mesh, Material | Material[]][] = [];
    const mats: MeshStandardMaterial[] = [];
    const glow = (mat: Material) => {
      const c = mat.clone() as MeshStandardMaterial;
      if (c.emissive) {
        c.emissive.set('#ffd98a');
        c.emissiveMap = c.map ?? null;
        c.emissiveIntensity = 0.45;
      }
      mats.push(c);
      return c;
    };
    node?.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      restore.push([m, m.material]);
      m.material = Array.isArray(m.material) ? m.material.map(glow) : glow(m.material);
    });
    return () => {
      for (const [m, mat] of restore) m.material = mat;
      mats.forEach((m) => m.dispose());
    };
  }, [gltf]);

  // Warm-up, while he is hidden: compile his shaders (in parallel where the browser can) for this
  // scene's lights, make his layered clips additive and upload his textures, one per frame. Only
  // then is he drawn. Arriving under the cloud veil, the cloud waits for him a little longer
  // (bounded, asked as soon as home mounts: see GuideProvider) so it clears on him; if it has
  // started to clear anyway, nothing heavy is done until it has (the shader compile included), so
  // the clearing never stutters (he then fades in after it).
  useEffect(() => {
    let cancelled = false;
    warm.current = false;
    const clearing = () => veil.phase === 'revealing';
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    const quiet = async () => { while (!cancelled && clearing()) await nextFrame(); };
    veil.extendHold();
    (async () => {
      try {
        await quiet();
        if (cancelled) return;
        if (gl.compileAsync) await gl.compileAsync(gltf.scene, camera, scene);
        else gl.compile(gltf.scene, camera, scene);
        for (;;) {
          await quiet();
          if (cancelled || !player.current?.prepareNext()) break;
          await nextFrame();
        }
        await uploadGradually(gl, texturesUnder(gltf.scene), () => cancelled, clearing);
        await quiet();
        // one unseen frame (the layer is still transparent): buffers and his face's morph texture
        if (!cancelled && group.current) drawOnce(gl, scene, camera, [group.current]);
      } catch (e) {
        console.warn('[guide] warm-up skipped', e);
      }
      if (!cancelled) warm.current = true;
    })();
    return () => { cancelled = true; };
  }, [gltf, gl, scene, camera]);

  // A hidden tab: everything holds still. Coming back, the first step is one frame long.
  useEffect(() => {
    const onVisibility = () => { if (!document.hidden) resumed.current = true; };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Leaving, he starts afresh if he returns.
  useEffect(() => () => {
    const el = gl.domElement.closest<HTMLElement>('.guide-layer');
    if (el) { delete el.dataset.appear; delete el.dataset.quick; delete el.dataset.fly; }
    el?.style.removeProperty('--coco-fade');
    place.current = freshPlace();
  }, [gl]);

  // His ride cloud: loaded the first time he needs it (he has become the companion), warmed unseen,
  // and kept for the visit. Freed with him.
  function loadRide() {
    if (rideLoading.current) return;
    rideLoading.current = true;
    let cancelled = false;
    new RIDE.Loader().loadAsync(rideUrl()).then(async (g) => {
      if (cancelled || !rideHolder.current) return;
      const player = new ClipPlayer(g.scene, g.animations);
      const parts = prepareRide(g.scene, RIDE_ORDER);
      const follow = createRootFollow(gltf.scene, g.scene);
      follow.captureFrom(restRoot);
      player.play(REST);
      player.refresh();
      g.scene.updateWorldMatrix(true, true);
      const box = restBox(g.scene, new Box3());
      g.scene.visible = false;
      rideHolder.current.add(g.scene);
      const r: Ride = { gltf: g, player, parts, follow, box, warm: false };
      ride.current = r;
      try {
        if (gl.compileAsync) await gl.compileAsync(g.scene, camera, scene); else gl.compile(g.scene, camera, scene);
        await uploadGradually(gl, texturesUnder(g.scene), () => cancelled);
      } catch (e) {
        console.warn('[guide] ride cloud warm-up skipped', e);
      }
      r.warm = true;
    }).catch((e) => console.warn('[guide] no ride cloud; he appears without it', e));
    rideCancel.current = () => { cancelled = true; };
  }
  const rideCancel = useRef<() => void>(() => undefined);
  useEffect(() => () => {
    rideCancel.current();
    const r = ride.current;
    if (r) { r.player.dispose(); r.parts.dispose(); r.gltf.scene.removeFromParent(); }
    ride.current = null;
    rideLoading.current = false;
    RIDE.release(rideUrl());
  }, [gltf]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, rawDt) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    let dt = Math.min(rawDt, 0.1);
    if (resumed.current) { resumed.current = false; dt = Math.min(dt, 1 / 60); }
    const { width: W, height: H } = state.size;
    const P = place.current;
    const g = group.current;
    const layerEl = gl.domElement.closest<HTMLElement>('.guide-layer');
    const L = layerEl?.getBoundingClientRect() ?? { top: 0, left: 0 };   // his layer, in the window
    const vw = window.innerWidth, vh = window.innerHeight;
    const wall = performance.now() / 1000;

    // ── where he is ──
    // placed unseen in a new space last frame: his layer fades back in now
    if (P.appear && layerEl) { P.appear = false; delete layerEl.dataset.appear; }
    const sy = window.scrollY;
    const fade = (v: 0 | 1, quick = false) => {
      if (P.fade === v) return;
      P.fade = v;
      P.fadeAt = wall;
      // content has come under him (a new page, a layout change): he leaves quickly, so he is never
      // seen over it for long (intro.css [data-quick]); otherwise he fades in and out slowly
      if (layerEl) { if (quick) layerEl.dataset.quick = ''; else delete layerEl.dataset.quick; }
      layerEl?.style.setProperty('--coco-fade', String(v));
    };
    const gone = () => P.fade === 0 && wall - P.fadeAt >= FADE_S;
    const r = ride.current;
    const rideOk = !!r?.warm;
    const box = () => (P.riding && r ? tmp.box.copy(frame).union(r.box) : frame);
    const shapeOf = (b: Box3) => { const w = b.max.x - b.min.x, h = b.max.y - b.min.y; return h > 0 && w > 0 ? w / h : aspect; };
    // the companion's shape: him on his ride cloud (once it has arrived)
    const companionAspect = r ? shapeOf(tmp.box.copy(frame).union(r.box)) : aspect;
    const win = (s: Spot): Spot => ({ ...s, cy: s.cy - sy });
    const doc = (s: Spot): Spot => ({ ...s, cy: s.cy + sy });
    // (the window less its scrollbar: he peeks inside the page, never over the scrollbar)
    const vwC = document.documentElement.clientWidth || window.innerWidth, vhC = window.innerHeight;
    /** Seated on his ride cloud his framed box is this much taller than his own. */
    const rideGrow = r ? shapeH(tmp.box.copy(frame).union(r.box)) / shapeH(frame) : 1;
    /** His corner peek (window px), riding or not. */
    const cornerAt = (side: 'right' | 'left', riding = P.riding) =>
      cornerSpot(vwC, vhC, riding ? companionAspect : aspect, side, riding ? rideGrow : 1);
    /** Ends any flight; the ride cloud idles. */
    const endFlight = () => {
      P.flight = null;
      P.bank = 0;
      if (layerEl) delete layerEl.dataset.fly;
      r?.player.play(REST);
    };
    /** Placed at once (unseen), then faded in there. */
    const appearAt = (s: Spot, corner: Corner = null) => {
      P.spot = s;
      P.corner = corner;
      P.shown = true;
      if (P.init && layerEl) { layerEl.dataset.appear = ''; P.appear = true; }
      fade(1);
    };
    const hideQuietly = (quick = false) => {
      // a flight cut short: he fades out where he is now, not at the space he was heading for
      if (P.flight) { P.rider = createRider({ cx: L.left + P.x, cy: L.top + P.y + sy, h: P.h }); P.corner = null; endFlight(); }
      P.shown = false;
      P.aim = createAim();
      fade(0, quick);
    };
    /** Riding: appears (fades in) at `s` (window px), the drift at rest there. */
    const appearRiding = (s: Spot, riding: boolean) => {
      P.spot = null;
      P.riding = riding;
      P.rider = createRider(doc(s));
      P.target = doc(s);
      P.aim = createAim();
      P.aim.spot = doc(s);
      P.corner = null;
      P.shown = true;
      if (P.init && layerEl) { layerEl.dataset.appear = ''; P.appear = true; }
      fade(1);
      r?.player.play(REST);
    };

    // away on About: his layer fades out (GuideProvider), and he is nowhere until he is back
    if (awayNow.current !== P.away) {
      P.away = awayNow.current;
      P.awaySince = wall;
      if (P.away) { if (P.flight) endFlight(); P.shown = false; P.entered = false; fade(0); }
    }
    // a change of page: the dwell starts again (its layout is still settling, its scroll goes back to
    // the top); he holds where he is in the window meanwhile, unless its content comes under him
    const page = window.location.hash;
    if (!P.init) P.page = page;
    else if (page !== P.page) {
      P.page = page;
      layout.current?.invalidate();
      if (P.flight) hideQuietly(true);
      P.aim = createAim();
      P.checkedAt = -Infinity;
    }
    // the hero at the top of home: is its Coco the one on screen?
    const vw0 = window.innerWidth, vh0 = window.innerHeight;
    const heroEl = !P.away ? document.querySelector<HTMLElement>('[data-guide-space]') : null;
    let hero: Spot | null = null;
    if (heroEl) {
      const hr = heroEl.getBoundingClientRect();
      if (hr.width > 0 && hr.height > 0) hero = heroSpot({ left: hr.left, top: hr.top, right: hr.right, bottom: hr.bottom }, aspect, spaceSizes(vw0, vh0).maxH);
    }
    const heroView = { left: 0, top: 0, right: vw0, bottom: vh0 };
    const wantHero = !!hero && heroMode(P.mode === 'hero', visibleShare(hero, aspect, heroView));

    // ── the home journey on a laptop or desktop (tour.ts): one Coco, the hero's own ──
    const tourHere = tourOn(page, vw0) && !P.away;
    if (tourHere && readySent.current && Number.isNaN(P.rideWanted)) { P.rideWanted = wall; loadRide(); }
    let tourAt: Spot | null = null;
    if (P.mode === 'tour' && !(tourHere && rideOk)) {
      // leaving the journey (another page, a narrow window): he carries on riding from where he is
      if (P.rider && P.tourFrame === 'win') { P.rider.y += sy; P.rider.vy += P.vs; }
      P.tourFrame = 'doc';
      P.mode = 'companion';
      P.corner = null;
      P.target = P.rider ? { cx: P.rider.x, cy: P.rider.y, h: P.rider.h } : null;
      P.aim = createAim();
      P.entered = true;
    }
    if (tourHere && rideOk && r) {
      const m = layout.current?.get(vw0, vh0);
      const dt1 = Math.max(dt, 1e-3);
      if (!Number.isNaN(P.lastSy)) P.vs += ((sy - P.lastSy) / dt1 - P.vs) * (1 - Math.exp(-dt1 * 12));
      P.lastSy = sy;
      /** A place framed on him alone, framed on him and his cloud: he stays exactly where he is. */
      const toRiding = (sp: Spot): Spot => {
        const U = tmp.box2.copy(frame).union(r.box);
        const h = sp.h * (shapeH(U) / shapeH(frame));
        const sc = h / shapeH(U);
        frame.getCenter(tmp.cB);
        U.getCenter(tmp.cU);
        return { cx: sp.cx - (tmp.cB.x - tmp.cU.x) * sc, cy: sp.cy + (tmp.cB.y - tmp.cU.y) * sc, h };
      };
      if (P.mode !== 'tour') {
        // the journey starts where he is (in the hero, or riding, or peeking) or, unseen, at his first stop
        if (P.flight) endFlight();
        const cur: Spot = { cx: L.left + P.x, cy: L.top + P.y, h: P.h };
        const start = P.riding ? cur : toRiding(cur);
        P.tourAppear = !(P.shown && P.seen && P.fade === 1);
        P.mode = 'tour';
        P.riding = true;
        P.corner = null;
        P.spot = null;
        P.rider = createRider(doc(start));
        P.tourFrame = 'doc';
        P.hold = createStopHold();
        P.stop = null;
        P.cushion = P.tourAppear ? 1 : 0;
        r.player.play(REST);
      }
      const anchors = stopAnchors();
      const heroShare = hero ? visibleShare(hero, aspect, heroView) : 0;
      const seenStop = m ? stopFor(P.hold.stop ?? 'hero', heroShare, anchors, m.view) : 'hero';
      const stop = holdStop(P.hold, seenStop, wall);
      if (stop !== P.stop) { P.stop = stop; P.stopSpot = null; P.stopCheckedAt = -Infinity; }
      const a = companionAspect;
      let target: Spot | null = null;
      let frameWanted: 'doc' | 'win' = 'doc';
      if (stop === 'hero' && hero) target = doc(toRiding(hero));
      else if (stop !== 'hero' && stop !== 'corner' && m) {
        // his resting place beside the heading (or below the cards): checked a few times a second, kept while clear
        if (wall - P.stopCheckedAt >= RIDING.lookS) {
          P.stopCheckedAt = wall;
          const sz = spaceSizes(vw0, vh0);
          const grow = rideGrow * COMPANION_SCALE;
          const opts = { ...sz, minH: sz.minH * grow, maxH: sz.maxH * grow, aspect: a };
          const mine = P.stopSpot ? win(P.stopSpot) : null;
          // looked for again when it is no longer clear or no longer wholly in view (the page has moved on)
          if (!mine || !stillClear(mine, m.obstacles, a, opts.pad) || visibleShare(mine, a, m.view) < ROAM.whole) {
            const an = anchors.find((x) => x.name === stop);
            const sp = an ? restSpot(stop, an.rect, m.view, m.obstacles, opts) : null;
            // (no room now: he keeps the place he had, if any, rather than leaving for the corner)
            if (sp || !mine) P.stopSpot = sp ? doc(sp) : null;
          }
        }
        target = P.stopSpot;
      }
      if (!target) {
        // the cards fill the screen (or no room beside the heading): his corner rest, in the window
        const side = cornerFree(cornerAt('right', true), a) ? 'right' : 'left';
        target = cornerAt(side, true);
        frameWanted = 'win';
      }
      // his drift moves between the page and the window without a jump in place or speed
      if (frameWanted !== P.tourFrame && P.rider) {
        if (frameWanted === 'win') { P.rider.y -= sy; P.rider.vy -= P.vs; } else { P.rider.y += sy; P.rider.vy += P.vs; }
        P.tourFrame = frameWanted;
      }
      const rider = P.rider!;
      if (P.tourAppear) {
        // unseen until now: placed at his stop, then faded in there
        placeRider(rider, target);
        P.tourAppear = false;
        P.shown = true;
        if (P.init && layerEl) { layerEl.dataset.appear = ''; P.appear = true; }
        fade(1);
      } else if (P.fade === 0 && !P.away) { P.shown = true; fade(1); }
      // carried right out of the window by a fast scroll, he waits just beyond its edge (unseen), so he
      // flies in from there as soon as his stop is in view, never from far away in the page
      if (P.tourFrame === 'doc') {
        const off = rider.h * 0.6;
        const wy = rider.y - sy;
        if (wy < -off) { rider.y = sy - off; rider.vy = Math.max(rider.vy, 0); }
        else if (wy > vh0 + off) { rider.y = sy + vh0 + off; rider.vy = Math.min(rider.vy, 0); }
      }
      followStep(rider, target, dt);
      tourAt = P.tourFrame === 'doc' ? win({ cx: rider.x, cy: rider.y, h: rider.h }) : { cx: rider.x, cy: rider.y, h: rider.h };
      P.bank = (rider.bank * Math.PI) / 180;
      // his cloud: none at rest in the hero, there in flight and at every other stop (eased)
      const atHero = stop === 'hero' && Math.hypot(rider.x - target.cx, rider.y - target.cy) < target.h * 0.03 && Math.abs(rider.h - target.h) < target.h * 0.03;
      P.cushion += ((atHero ? 0 : 1) - P.cushion) * (1 - Math.exp(-dt * 3));
    } else if (wantHero && hero) {
      if (P.mode !== 'hero') {
        // back to the hero: the companion (if shown) fades out quietly first, then the hero's Coco fades in
        if (P.flight) endFlight();
        if (P.init && P.shown && P.seen && !gone()) { if (P.fade === 1) fade(0); }
        else { P.mode = 'hero'; P.riding = false; P.rider = null; P.corner = null; appearAt(doc(hero)); }
      } else {
        P.spot = doc(hero);
        if (!P.shown) appearAt(P.spot);
      }
    } else if (!P.away) {
      if (P.mode === 'hero') {
        // the hero has scrolled away: its Coco goes with it, quietly; the companion makes his entrance
        P.mode = 'companion';
        P.entered = false;
        P.rider = null;
        // (he fades out where he is, scrolling away with the hero: P.spot stays his place until he is in again)
        if (P.init) hideQuietly(); else { P.shown = false; P.spot = null; }
      }
      if (Number.isNaN(P.rideWanted)) { P.rideWanted = wall; loadRide(); }
      // the page's scroll speed (smoothed): content it carries towards him is seen a moment early
      const dt1 = Math.max(dt, 1e-3);
      if (!Number.isNaN(P.lastSy)) P.vs += ((sy - P.lastSy) / dt1 - P.vs) * (1 - Math.exp(-dt1 * 12));
      P.lastSy = sy;
      const m = layout.current?.get(vw0, vh0);
      const riding = (P.shown && !P.riding ? false : rideOk);
      const a = riding ? companionAspect : aspect;
      // where he is (window px); his drift and his aim are in the page (they scroll with it, so the
      // scroll never carries content onto him)
      const here: Spot | null = P.rider ? win({ cx: P.rider.x, cy: P.rider.y, h: P.rider.h }) : null;
      // his own box, every frame: content coming under him (a layout change, a new page) sends him
      // off at once (a quick fade); he fades in again at a clear space
      if (m && P.shown && here && !P.corner && !P.flight && P.fade === 1
        && !pathClear(here, here, sweep(m.obstacles, 0, GUARD), P.riding ? companionAspect : aspect)) hideQuietly(true);
      // his corner: a control under it sends him away
      if (P.shown && P.corner && wall - P.checkedAt >= CHECK_S) {
        P.checkedAt = wall;
        if (!cornerFree(cornerAt(P.corner), P.riding ? companionAspect : aspect)) hideQuietly(true);
      }
      const rideReady = rideOk || wall - P.rideWanted >= RIDE_WAIT_S;
      if (m && !P.flight && rideReady && wall - P.lookedAt >= RIDING.lookS && (P.fade === 1 || gone())) {
        P.lookedAt = wall;
        const swept = m.obstacles;
        // smaller on pages; seated on his cloud the whole box is that much taller
        const grow = (riding ? rideGrow : 1) * COMPANION_SCALE;
        const sz = spaceSizes(vw0, vh0);
        const opts = { ...sz, minH: sz.minH * grow, maxH: sz.maxH * grow, aspect: a };
        // scrolling, he looks ahead: among good spaces the one the page carries towards the middle of the
        // view (it stays in view longest); otherwise the nearest to him
        const ahead = Math.abs(P.vs) > 40 ? (P.vs > 0 ? m.view.bottom - (m.view.bottom - m.view.top) * 0.2 : m.view.top + (m.view.bottom - m.view.top) * 0.2) : null;
        const nearPt = here && P.shown && !P.corner ? { cx: here.cx, cy: ahead ?? here.cy } : ahead !== null ? { cx: vw0 / 2, cy: ahead } : null;
        const best = findSpace(m.view, swept, opts, { near: nearPt });
        const sides: ('right' | 'left')[] = P.corner === 'left' ? ['left', 'right'] : ['right', 'left'];
        const freeCorner = () => {
          for (const side of sides) { const c = cornerAt(side, riding); if (cornerFree(c, a)) return { spot: c, side }; }
          return null;
        };
        /** His entrance from the nearer side of the window, if that way is clear (the corner peek may cross content). */
        const enter = (to: Spot, corner: Corner) => {
          const half = (to.h * a) / 2;
          const from: Spot[] = [
            { cx: m.view.left - half - EDGE_MARGIN, cy: to.cy, h: to.h },
            { cx: m.view.right + half + EDGE_MARGIN, cy: to.cy, h: to.h },
          ];
          if (to.cx - m.view.left > m.view.right - to.cx) from.reverse();
          const way = corner ? from[0] : from.find((f) => pathClear(f, to, m.obstacles, a));
          if (!r || !riding || reduced || !way) return false;
          P.riding = true;
          P.shown = true;
          P.corner = null;
          P.rider = null;
          P.spot = null;
          // (in the page: if it scrolls meanwhile his way scrolls with it; the corner stays in the window)
          P.flight = { from: corner ? way : doc(way), to: corner ? to : doc(to), t: 0, wall0: wall, corner };
          r.player.play(FLY, { loop: false, time: 0 });
          r.player.refresh();
          if (layerEl) layerEl.dataset.fly = '';           // he starts out of sight: shown at once
          fade(1);
          return true;
        };
        if (!P.shown) {
          // out of sight (just arrived, the hero gone, a hop, back from About): in at the best space,
          // or at the corner when none fits him
          if (best) {
            if (!(!P.entered && enter(best, null))) appearRiding(best, riding);
            P.entered = true;
          } else {
            const c = freeCorner();
            if (c && !(!P.entered && enter(c.spot, c.side))) {
              P.riding = riding; P.rider = null; P.spot = null; P.corner = c.side; P.shown = true;
              if (P.init && layerEl) { layerEl.dataset.appear = ''; P.appear = true; }
              fade(1);
              r?.player.play(REST);
            }
            if (c) P.entered = true;
          }
        } else if (P.corner) {
          // peeking from the corner: a space that holds a moment brings him out of it (a fade: the way
          // from the corner crosses content by nature)
          if (best) {
            if (Number.isNaN(P.openSince)) P.openSince = wall;
            if (wall - P.openSince >= OPEN_S) { P.openSince = NaN; hideQuietly(); }
          } else P.openSince = NaN;
        } else if (here) {
          // riding: keep his aim while it is clear and in view, or take a clearly better one; a way
          // across content means waiting where he is (if that is clear) or a quick hop
          const aimNow = P.aim.spot ? win(P.aim.spot) : null;
          // still good: clear, in view, and still in view a moment from now as the page carries it
          const soon = aimNow ? { ...aimNow, cy: aimNow.cy - P.vs * RIDING.sweepS * 2 } : null;
          const ok = !!aimNow && stillClear(aimNow, swept, a, opts.pad) && visibleShare(aimNow, a, m.view) >= ROAM.whole
            && visibleShare(soon!, a, m.view) >= ROAM.whole;
          const step = aimStep(P.aim, { now: wall, best: best && doc(best), ok });
          const hereClear = pathClear(here, here, swept, a);
          // (waiting is only for a place that stays in view a moment longer as the page carries it)
          const hereStays = visibleShare({ ...here, cy: here.cy - P.vs * RIDING.sweepS }, a, m.view) >= ROAM.lost;
          const riderDoc = doc(here);
          if (step === 'move' && P.aim.spot) {
            const kind = moveKind(pathClear(here, win(P.aim.spot), m.obstacles, a), hereClear && hereStays);
            if (kind === 'ride' && !reduced) P.target = P.aim.spot;
            else if (kind === 'wait') { P.target = riderDoc; P.aim = createAim(); }
            else hideQuietly(true);
          } else if (step === 'none') {
            // nowhere to go: he stays put while that is clear and in view, else goes (to the corner, next look)
            if (hereClear && visibleShare(here, a, m.view) >= ROAM.lost) P.target = riderDoc; else hideQuietly(true);
            P.aim = createAim();
          }
        }
      }
    }

    // where he is drawn this frame (his layer's px): at his spot (it scrolls with the page), or on
    // his way there (Blender's flight values on the line between the two)
    let at: Spot | null = tourAt ? tourAt : P.mode === 'hero' ? (P.spot ? win(P.spot) : null)
      : P.corner ? cornerAt(P.corner)
        : P.rider ? win({ cx: P.rider.x, cy: P.rider.y, h: P.rider.h }) : P.spot ? win(P.spot) : null;
    if (tourAt) { /* the journey placed him */ } else if (P.flight && r) {
      // his entrance: Blender's flight values on the line from beside the window to his space
      const F = P.flight;
      F.t += dt;
      const len = r.player.duration(FLY) || 2;
      const parts = r.parts;
      const f0 = F.corner ? F.from : win(F.from), f1 = F.corner ? F.to : win(F.to);
      at = flightAt(f0, f1, ctlValue(parts.progress, Math.min(1, F.t / len)), ctlValue(parts.lift));
      P.bank = (flightBank(F.from, F.to, ctlValue(parts.bank) * 10) * Math.PI) / 180;
      if (F.t >= len || wall - F.wall0 > flightTimeout(len)) {
        endFlight();
        at = f1;
        if (F.corner) P.corner = F.corner;
        else { P.rider = createRider(F.to); P.target = F.to; P.aim = createAim(); P.aim.spot = F.to; }
      }
    } else if (P.mode === 'companion' && P.rider && !P.corner && P.target && P.shown) {
      // riding: the drift towards his target, leaning into it (frame-rate independent)
      followStep(P.rider, P.target, dt);
      at = win({ cx: P.rider.x, cy: P.rider.y, h: P.rider.h });
      P.bank = (P.rider.bank * Math.PI) / 180;
    } else if (!P.flight) P.bank = 0;
    if (at) { P.x = at.cx - L.left; P.y = at.cy - L.top; P.h = at.h; }
    P.init = true;

    // in view: some of him inside the window (he is drawn only then: see below), and not faded out
    const shape = shapeOf(box());
    const hh = (P.h * SWAY) / 2, hw = (P.h * shape * SWAY) / 2;
    const inView = L.top + P.y - hh < vh && L.top + P.y + hh > 0 && L.left + P.x - hw < vw && L.left + P.x + hw > 0;
    const faded = (P.away && wall - P.awaySince >= AWAY_S) || (P.fade === 0 && wall - P.fadeAt >= FADE_S);
    P.seen = inView && !faded && !!at;
    g.visible = warm.current;
    if (TRACE && at) {
      const m = layout.current?.get(vw0, vh0);
      const shapeNow = shapeOf(box());
      // (his corner peek, and his glide along the bottom edge into it, may sit over content: approved)
      const peek = !!P.corner || !!P.flight?.corner;
      const rest = P.mode === 'tour' && !!P.rider && Math.hypot(P.rider.vx, P.rider.vy) < 6;
      const tourRest = rest && P.stop !== 'corner' && P.stop !== 'hero';
      const ov = m && P.seen && P.fade === 1 && !peek && (P.mode === 'companion' || tourRest) ? overlapArea(spotBox(at, shapeNow), m.obstacles) : 0;
      console.debug('cocotrace', JSON.stringify({ t: +wall.toFixed(4), x: +at.cx.toFixed(2), y: +at.cy.toFixed(2), h: +at.h.toFixed(2),
        fade: P.fade, seen: P.seen, mode: P.mode, corner: P.corner || (P.flight?.corner ?? null), flight: !!P.flight, stop: P.stop, rest, ov: Math.round(ov), sy, vs: Math.round(P.vs) }));
    }
    const k = (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360)) / H;      // world units per CSS px at z = 0
    const wx = (P.x - W / 2) * k, wy = -(P.y - H / 2) * k, wh = P.h * k;

    // framed on the whole emblem (seated on his ride cloud, the cloud too): that box is P.h tall,
    // turned by his lean about its middle
    const b = box();
    const boxH = b.max.y - b.min.y || 1;
    b.getCenter(tmp.c);
    const sc = wh / boxH;
    const cs = Math.cos(-P.bank), sn = Math.sin(-P.bank);
    g.scale.setScalar(sc);
    g.rotation.z = -P.bank;
    g.position.set(wx - (tmp.c.x * cs - tmp.c.y * sn) * sc, wy - (tmp.c.x * sn + tmp.c.y * cs) * sc, -tmp.c.z * sc);

    // ready once warm and drawn in place for a couple of frames
    if (warm.current && !readySent.current && ++shownFrames.current > 2) {
      readySent.current = true;
      onReady();
    }

    // his ride cloud: on his root bone, Blender's glow; shown while he rides it
    if (r) {
      r.gltf.scene.visible = P.riding && r.warm && P.seen && (P.mode === 'companion' || (P.mode === 'tour' && P.cushion > 0.01));
      if (r.gltf.scene.visible || P.flight) {
        r.player.update(dt);
        r.follow.follow();
        applyRideLook(r.parts, P.mode === 'tour' ? P.cushion : 1);
      }
    }

    // ── what he does ──
    const p = player.current, id = idle.current;
    if (!p || !id) return;
    // arriving: settle starts when he can be seen (the cloud is clearing, or there is none)
    if (holding.current) {
      if (!readySent.current || (veil.phase !== 'idle' && veil.phase !== 'revealing')) { attention.take(); return; }
      holding.current = false;
    }
    // out of view (and not drawn: see below): his clips hold where they are and carry on from
    // there, frame by frame, when he comes back; nothing he could have noticed meanwhile counts
    if (!P.seen) { attention.take(); return; }
    clock.current += dt;
    const now = clock.current;
    // his slow hover, eased in on the breath once he has settled (if the model has it)
    if (!P.floating && p.current === 'breathe') { P.floating = true; p.loopLayer(FLOAT, { fadeIn: 2.5 }); }
    const res = p.update(dt);
    if (res.wrapped) {
      // the boundary was crossed res.mainTime ago, part-way through this frame
      const drift = id.onLoop(now, res.mainTime);
      if (drift && p.layer(drift, { startTime: res.mainTime })) p.refresh();
    }
    if (id.tick(now) === 'flutter') p.layer('flutter', { fadeIn: 0.06, fadeOut: 0.06 });
    // he notices the visitor once he is visible and settled; nothing from before counts
    const settled = readySent.current && p.current !== 'settle';
    if (settled && !attentive.current) { attentive.current = true; attention.clear(); }
    const stim = attention.take();
    if (stim && attentive.current) {
      tmp.screen.set(wx, wy, 0).project(state.camera);
      const reaction = id.onStimulus(now, stim, { x: (tmp.screen.x + 1) / 2, y: (1 - tmp.screen.y) / 2 });
      if (reaction) p.layer(reaction, { fadeIn: 0.12, fadeOut: 0.2 });
    }
  });

  // He is drawn only while he can be seen. Once he has left the window (or faded out on About), one
  // last frame is drawn without him in view (so the canvas holds no sliver of him), then the GPU
  // does nothing until he comes back. A frame callback with a priority turns R3F's own render off;
  // this one runs after the one above, so it draws the frame just worked out.
  const drawnSeen = useRef(true);
  useFrame((state) => {
    const seen = place.current.seen;
    if (seen || drawnSeen.current) state.gl.render(state.scene, state.camera);
    drawnSeen.current = seen;
  }, 1);

  return (
    <group ref={group} visible={false}>
      <primitive object={gltf.scene} />
      <group ref={rideHolder} />
    </group>
  );
}

export interface HomeStageProps {
  arriving: boolean;
  /** On About: he fades out and waits (GuideProvider). */
  away: boolean;
  onReady: () => void;
  onContextLost: () => void;
}

export default function HomeStage({ arriving, away, onReady, onContextLost }: HomeStageProps) {
  // decided once, before he is shown: a change of resolution while he is on screen would show. The
  // canvas covers the window, so its buffer is also kept within a pixel budget (a large high-density
  // screen would otherwise cost hundreds of MB of multisampled buffers, for one small figure).
  const [dpr] = useState(() => stageDpr(qualityTier(), window.devicePixelRatio, window.innerWidth * window.innerHeight));
  const pendingRelease = useRef(0);
  useEffect(() => listen(), []);

  // Leaving (the welcome replayed, or the page gave up on him): stop his download and free whatever
  // loaded, decoded images included. Kept, his model would hold some 50 MB of decoded textures all
  // visit, and every earlier canvas's renderer through his materials. Coming back after Replay the
  // welcome, the bytes are still in the HTTP cache and he is parsed again under the covering cloud
  // (which waits for him). Deferred a tick so React's development double-mount does not throw him away.
  useEffect(() => {
    window.clearTimeout(pendingRelease.current);
    return () => {
      pendingRelease.current = window.setTimeout(() => ADULT.release(adultUrl()), 0);
    };
  }, []);

  return (
    <Canvas
      className="guide-canvas"
      flat
      style={{ pointerEvents: 'none' }}
      dpr={[1, dpr]}
      // it never takes pointer events, so it need not track its place while the page scrolls
      resize={{ scroll: false }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: FOV, near: 0.1, far: 40, position: [0, 0, CAMERA_Z] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        // shader status round trips (the info logs) only while developing: they stall a first draw
        gl.debug.checkShaderErrors = import.meta.env.DEV;
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost(); });
      }}
      aria-hidden
    >
      <hemisphereLight args={['#fff4e2', '#d9905e', 2.1]} />
      <directionalLight position={[2.5, 3.5, 5]} intensity={2.6} color="#fff0d0" />
      <directionalLight position={[-3, 1.5, 3]} intensity={0.9} color="#d6fbf6" />
      <Suspense fallback={null}>
        <Adult arriving={arriving} away={away} onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
