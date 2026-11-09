// Adult Coco, the visitor's companion: a closed-eyed sage seated on his cloud, the sun and lightning
// bolt behind him. One transparent layer above the page's content and below the header, the menu,
// dialogs and the cloud veil (pointer-events: none: he never blocks a click).
//
// He sits in the home hero, and keeps the visitor company in the corner everywhere else: docked
// beside the content column where the window is wide enough, otherwise peeking up from the bottom
// edge, stepping aside below it while the visitor reads (docking.ts stepAside). Every movement is a
// Blender clip from coco-sage.glb, played by ClipPlayer: 'breathe' loops; arriving from the
// invitation he plays 'settle' first (once the cloud starts to clear, so it is seen) and joins
// 'breathe' at its first frame; rare drifts start on a breath's loop boundary; a face flutter now
// and then; small reactions to the visitor.
// Loads ONLY coco-sage.glb, through his own loader: if home gives up on him (too slow, a lost
// context, an error) the download stops and whatever loaded is freed. Lazy chunk (with three.js);
// the page never waits for it. Nothing is shown until his shaders are compiled, his textures
// uploaded and one frame drawn unseen (buffers, morph textures), so he appears without a hitch. The
// resolution is decided once, before he is shown, and never changes while he is on screen.
//
// While he sits in the hero his layer is anchored in the page, so the browser scrolls him with the
// hero on the compositor (no swimming on a touch fling); docked in the corner it is fixed in the
// window. See docking.ts nextLayerMode.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Box3, Matrix4, Vector3, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { asset } from '../content';
import { stage } from '../scene/stage';
import { qualityTier, stageDpr } from '../intro/capability';
import { ClipPlayer, clamp01, smoothstep } from '../characters/ClipPlayer';
import { createModelSource } from '../characters/modelSource';
import { drawOnce, neverCullSkinned, restBox, texturesUnder, uploadGradually } from '../characters/sceneUtils';
import { veil } from '../veil/veil';
import { attention, listen } from './attention';
import { createIdleScheduler, DRIFTS, REACTIONS, type IdleScheduler } from './idle';
import {
  ASIDE_OMEGA, belowCorner, carryAcross, carryFrom, cornerClear, createAside, createSmallViewport, createStableViewport, endRoom, FIGURE, focusInCorner,
  glideStep, heroRect, layerAnchor, nextDocked, nextLayerMode, placement, springStep, stepAside, tuckDrop, type Aside, type LayerMode,
} from './docking';
import { ADULT_URL } from './paths';

const CAMERA_Z = 10;
const FOV = 30;
/** coco-sage's clips are authored at 30 fps. */
const FPS = 30;
/** His height relative to the space he is given (as before). */
const SIZE = FIGURE;
const ADDITIVE = new Set<string>([...DRIFTS, 'flutter', ...REACTIONS]);
const SUN_BOLT = 'sun_bolt';
/** The page counts as still once no scroll has happened for this long (a fling has ended). */
const SCROLL_IDLE_MS = 160;

/**
 * His model, through a loader of his own (never shared with the invitation's). Bytes that arrive
 * while the cloud veil is clearing wait for it to finish before they are parsed, so the parse never
 * lands in the middle of the clearing.
 */
const ADULT = createModelSource((L, urls) => useLoader.clear(L, urls), { hold: () => veil.phase === 'revealing' });
const adultUrl = () => asset(ADULT_URL);

interface Frame { full: Box3; body: Box3 }

/**
 * His bounding boxes in the model's own space, in his rest pose: with the sun and bolt, and his
 * body alone. From the stored geometry bounds: no per-vertex skinning (65k vertices) on the way in.
 */
function measure(scene: Object3D): Frame {
  scene.updateWorldMatrix(true, true);
  const toLocal = scene.parent ? new Matrix4().copy(scene.parent.matrixWorld).invert() : new Matrix4();
  const full = restBox(scene).applyMatrix4(toLocal);
  const body = restBox(scene, new Box3(), scene.getObjectByName(SUN_BOLT));
  if (body.isEmpty()) body.copy(full);
  else body.applyMatrix4(toLocal);
  return { full, body };
}

interface AdultProps { arriving: boolean; onReady: () => void }

const freshPlace = () => ({
  init: false, docked: true, atHero: false, since: 99, mode: 'fixed' as LayerMode,
  x: 0, vx: 0, y: 0, vy: 0, h: 1, vh: 0, dock: 1, vdock: 0, tx: 0, ty: 0,
  /** The corner is clear of the page's content column at this window size (see docking.ts cornerClear). */
  clear: false,
  /** He is the peeking companion (the corner overlaps the content column). */
  peek: false,
  /** How far he has stepped aside below the bottom edge (0 peeking ... 1 wholly below), and its speed. */
  tuck: 0, vtuck: 0,
  /** Some of him was in the window on the last frame. */
  seen: true,
  /** The end-of-page room last written (see docking.ts endRoom). */
  room: -1,
});

function Adult({ arriving, onReady }: AdultProps) {
  const gltf = useLoader(ADULT.Loader, adultUrl());
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const group = useRef<Group>(null!);
  const frame = useMemo(() => measure(gltf.scene), [gltf]);
  /** His width on screen in the corner, as a share of his corner height (his body alone, framed there). */
  const cornerWidthShare = useMemo(() => {
    const w = frame.body.max.x - frame.body.min.x, h = frame.body.max.y - frame.body.min.y;
    return h > 0 && w > 0 ? (SIZE * w) / h : 0.9;
  }, [frame]);
  const player = useRef<ClipPlayer | null>(null);
  const idle = useRef<IdleScheduler | null>(null);
  const sun = useRef<MeshStandardMaterial[]>([]);
  const sunNode = useRef<Object3D | null>(null);
  const clock = useRef(0);
  const warm = useRef(false);
  const shownFrames = useRef(0);
  const readySent = useRef(false);
  /** Arriving: 'settle' waits on its first frame until the cloud starts to clear. */
  const holding = useRef(false);
  /** He responds to the visitor only once he is visible and has settled. */
  const attentive = useRef(false);
  const resumed = useRef(false);
  const lastScroll = useRef(-Infinity);
  const stable = useMemo(() => createStableViewport(), []);
  const small = useMemo(() => createSmallViewport(), []);
  // only touch screens have a URL bar that slides; elsewhere the corner is simply the window's
  const touch = useMemo(() => !!window.matchMedia?.('(pointer: coarse)').matches, []);
  const place = useRef(freshPlace());
  /** Where his layer was in the window when he was last drawn. */
  const painted = useRef<{ top: number; left: number } | null>(null);
  const aside = useRef<Aside | null>(null);
  const tmp = useMemo(() => ({ c: new Vector3(), s: new Vector3(), screen: new Vector3() }), []);

  // His clips: one mixer, created here and torn down completely (StrictMode-safe).
  useEffect(() => {
    neverCullSkinned(gltf.scene);
    const p = new ClipPlayer(gltf.scene, gltf.animations, { additive: (n) => ADDITIVE.has(n), fps: FPS });
    holding.current = false;
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

  // The sun and bolt behind him: a steady, soft glow (a material setting, not movement). It fades
  // out while he is docked beside the column, so that companion stays uncluttered.
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
      c.transparent = true;
      mats.push(c);
      return c;
    };
    node?.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      restore.push([m, m.material]);
      m.material = Array.isArray(m.material) ? m.material.map(glow) : glow(m.material);
    });
    sun.current = mats;
    sunNode.current = node;
    return () => {
      for (const [m, mat] of restore) m.material = mat;
      mats.forEach((m) => m.dispose());
      sun.current = [];
      sunNode.current = null;
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

  // When the page last scrolled: his layer only changes how it is held while the page is still.
  useEffect(() => {
    const onScroll = () => { lastScroll.current = performance.now(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // His layer goes back to being fixed in the window when he leaves (and starts afresh if he returns);
  // the page's end no longer keeps room for him.
  useEffect(() => () => {
    const el = gl.domElement.closest<HTMLElement>('.guide-layer');
    if (el) delete el.dataset.attached;
    el?.style.removeProperty('top');
    document.documentElement.style.removeProperty('--guide-room');
    place.current = freshPlace();
    aside.current = null;
  }, [gl]);

  useFrame((state, rawDt) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    let dt = Math.min(rawDt, 0.1);
    if (resumed.current) { resumed.current = false; dt = Math.min(dt, 1 / 60); }
    const { width: W, height: H } = state.size;
    const P = place.current;
    const g = group.current;
    const layerEl = gl.domElement.closest<HTMLElement>('.guide-layer');

    // ── where he sits (springs in the layer's CSS px, so a change of canvas size can never move him) ──
    const r = heroRect(stage.el);                                  // the hero, in the window (null once it has left the page)
    const vw = window.innerWidth, vh = window.innerHeight;
    const large = stable(vw, vh);
    P.docked = nextDocked(P.init ? P.docked : true, r, large);
    const cornerH = touch ? Math.min(vh, small(vw, vh)) : vh;
    // docked beside the content column where the corner is clear of it, otherwise peeking up
    P.clear = cornerClear(W, cornerH, cornerWidthShare, P.init && P.clear);
    const withHero = !!r && !P.docked;
    let L = layerEl?.getBoundingClientRect() ?? { top: 0, left: 0, height: H };   // his layer, in the window
    /** His layer let go of a hero that has scrolled out of view: he comes up from below his corner. */
    let fromBelow = false;

    // how the layer is held: anchored in the page while he sits in the hero, fixed otherwise
    if (layerEl) {
      const scrollIdle = performance.now() - lastScroll.current >= SCROLL_IDLE_MS;
      const outOfView = !r || r.bottom <= 0 || r.top >= vh;
      const hero = P.atHero ? heroSpot(r, L, W, H) : null;
      const settled = !!hero && Math.abs(P.x - hero.cx) < 1 && Math.abs(P.y - hero.cy) < 1 && Math.abs(P.h - hero.h) < 1
        && Math.abs(P.vx) + Math.abs(P.vy) < 12;
      // fixed: where it would be anchored (centred on the hero, inside the page); attached: where it is
      const anchor = r && P.mode === 'fixed'
        ? layerAnchor(r.top + window.scrollY, r.height, L.height, document.documentElement.scrollHeight)
        : null;
      const fits = !!r && (anchor ? anchor.fits : r.top >= L.top - 0.5 && r.bottom <= L.top + L.height + 0.5);
      const next = nextLayerMode(P.mode, { inHero: withHero, scrollIdle, outOfView, settled, fits });
      if (next !== P.mode && P.init) {
        // a data attribute, not a class: React owns the layer's className (it is rewritten when he
        // becomes ready) and would drop a class added here
        if (next === 'attached') { layerEl.style.top = `${anchor?.top ?? 0}px`; layerEl.dataset.attached = ''; }
        else { delete layerEl.dataset.attached; layerEl.style.removeProperty('top'); }
        // the same place on screen across the switch (his positions shift by the layer's own move,
        // from where it was last drawn once the hero has gone with the page: see carryFrom); he
        // comes up from below only after a fling, never when the hero went with the page
        const moved = layerEl.getBoundingClientRect();
        fromBelow = carryAcross(P, carryFrom(painted.current, L, r), moved, next, r, vh);
        L = moved;
        P.mode = next;
      }
      painted.current = { top: L.top, left: L.left };
    }

    // he heads for the hero while it is in view (and stays with it while his layer is anchored in
    // the page, until it may change), otherwise for the corner
    const atHero = !!r && (withHero || P.mode === 'attached');
    const peek = !atHero && !P.clear;
    // a new place (the hero, the peek or the docked corner): the spring glides him there
    if (atHero !== P.atHero || peek !== P.peek || !P.init) { P.atHero = atHero; P.peek = peek; P.since = 0; } else P.since += dt;
    // in the corner he stands on his layer's bottom edge, which the browser keeps on the window's
    // bottom edge while a phone's URL bar slides (intro.css): his place in the layer never moves with it
    const spot = atHero ? heroSpot(r, L, W, H)! : cornerSpot(L, W, cornerH, peek);
    /** The window's bottom edge, in the window (the layer's, when it is held to it). */
    const viewBottom = Math.max(vh, L.top + L.height);
    // framed on the whole emblem (0) in the hero and peeking, so his sun and bolt say who he is; on his
    // body alone (1) docked beside the column
    const framing = atHero || peek ? 0 : 1;

    // stepping aside: only as the peeking companion (elsewhere he is out of the content's way), and
    // while the mobile menu is open
    const wall = performance.now() / 1000;
    const se = document.scrollingElement ?? document.documentElement;
    const A = (aside.current ??= createAside(se.scrollTop, wall));
    const atEnd = se.scrollTop + vh >= se.scrollHeight - 4;
    const peekH = placement(true, null, W, cornerH, true).h;
    const hold = document.documentElement.hasAttribute('data-menu-open') || (peek && focusInCorner(endRoom(peekH), peekH * 1.2));
    const away = stepAside(A, se.scrollTop, wall, atEnd, hold);
    if (!P.init) {
      P.x = spot.cx; P.y = spot.cy; P.h = spot.h; P.dock = framing; P.tx = spot.cx; P.ty = spot.cy;
      P.init = true;
    }
    // the hero went out of view with him (a fling): he is off-screen above, so rather than fly back
    // down across the page he comes up into the corner from just below it, already corner-sized
    if (fromBelow && !atHero) {
      const b = belowCorner(spot, viewBottom - L.top);
      P.x = b.x; P.y = b.y; P.h = b.h;
      P.vx = 0; P.vy = 0; P.vh = 0; P.dock = framing; P.vdock = 0;
      P.tx = spot.cx; P.ty = spot.cy; P.since = 0;
    }
    // the same place moving (the page scrolling under a fixed layer): once there he moves with it
    // exactly, so he stays with it; the spring glides him between places (see docking.ts glideStep)
    glideStep(P, spot, dt);
    [P.dock, P.vdock] = springStep(P.dock, P.vdock, framing, 3.2, dt);
    // stepping aside is a spring of its own on top of his place, so it never jumps with it
    [P.tuck, P.vtuck] = springStep(P.tuck, P.vtuck, peek && away ? 1 : 0, ASIDE_OMEGA, dt);
    const y = P.y + P.tuck * tuckDrop(P.h);
    // in view: some of him inside the window (he is drawn only then: see below)
    const inView = L.top + y - P.h * 0.55 < viewBottom && L.top + y + P.h * 0.55 > 0;
    // the end of every page keeps room for the peeking companion, so its last line scrolls clear of him
    const room = P.clear ? 0 : endRoom(peekH);
    if (room !== P.room) {
      P.room = room;
      document.documentElement.style.setProperty('--guide-room', `${room}px`);
    }
    g.visible = warm.current;
    const k = (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360)) / H;      // world units per CSS px at z = 0
    const wx = (P.x - W / 2) * k, wy = -(y - H / 2) * k, wh = P.h * k;

    // framed on the whole emblem, or on his body alone docked beside the column (the sun has faded)
    const d = smoothstep(clamp01(P.dock));
    const full = frame.full, body = frame.body;
    const boxH = (full.max.y - full.min.y) * (1 - d) + (body.max.y - body.min.y) * d || 1;
    full.getCenter(tmp.c);
    body.getCenter(tmp.s);
    tmp.c.lerp(tmp.s, d);
    const s = (wh * SIZE) / boxH;
    g.scale.setScalar(s);
    g.position.set(wx - tmp.c.x * s, wy - tmp.c.y * s, -tmp.c.z * s);

    const sunOpacity = 1 - d;
    for (const m of sun.current) m.opacity = sunOpacity;
    if (sunNode.current) sunNode.current.visible = sunOpacity > 0.01;

    // ready once warm and drawn in place for a couple of frames
    if (warm.current && !readySent.current && ++shownFrames.current > 2) {
      readySent.current = true;
      onReady();
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
    P.seen = inView;
    if (!inView) { attention.take(); return; }
    clock.current += dt;
    const now = clock.current;
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

  // He is drawn only while he can be seen. Once he has stepped wholly below the edge, one last frame
  // is drawn without him in view (so the canvas holds no sliver of him), then the GPU does nothing
  // until he comes back. A frame callback with a priority turns R3F's own render off; this one runs
  // after the one above, so it draws the frame just worked out.
  const drawnSeen = useRef(true);
  useFrame((state) => {
    const seen = place.current.seen;
    if (seen || drawnSeen.current) state.gl.render(state.scene, state.camera);
    drawnSeen.current = seen;
  }, 1);

  return (
    <group ref={group} visible={false}>
      <primitive object={gltf.scene} />
    </group>
  );
}

type LayerBox = { top: number; left: number };

/** His place in the hero, in his layer's px (the hero's box measured against the layer). */
function heroSpot(r: DOMRect | null, L: LayerBox, W: number, H: number) {
  if (!r) return null;
  const rel = { top: r.top - L.top, bottom: r.bottom - L.top, left: r.left - L.left, width: r.width, height: r.height };
  return placement(false, rel, W, H);
}

/** His place in the corner, in his layer's px: on the layer's bottom edge (held to the window's). */
function cornerSpot(L: LayerBox & { height: number }, W: number, cornerH: number, peek: boolean) {
  const c = placement(true, null, W, cornerH, peek, L.height);
  return { cx: c.cx - L.left, cy: c.cy, h: c.h };
}

export interface HomeStageProps {
  arriving: boolean;
  onReady: () => void;
  onContextLost: () => void;
}

export default function HomeStage({ arriving, onReady, onContextLost }: HomeStageProps) {
  // decided once, before he is shown: a change of resolution while he is on screen would show. The
  // canvas covers the window, so its buffer is also kept within a pixel budget (a large high-density
  // screen would otherwise cost hundreds of MB of multisampled buffers, for a figure in a corner).
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
        <Adult arriving={arriving} onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
