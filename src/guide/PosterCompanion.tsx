// The illustrated companion: where Coco is not drawn in 3D (lite: reduced motion, data saver, low
// memory, no WebGL; or 3D gave up), a still of him (a Blender render) floats in the page's negative
// space on every page but About, by the same rules as the 3D companion (space.ts, companion.ts): he
// moves only once scrolling has stopped (STILL_S), and while the hero at the top of home is on
// screen (it holds Cassidy's living painting of him) he is not shown at all. He is placed in the
// document, so he scrolls with his space on the compositor; between spaces he glides with a long,
// eased CSS transition (under reduced motion he fades out, moves, and fades back in). Where nothing
// fits him he peeks from a bottom corner of the window instead (fixed to it: companion.ts cornerSpot),
// clear of any control there. No still, no companion.

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { asset } from '../content';
import { prefersReducedMotion } from '../intro/capability';
import { cornerSpot, createDwell, dwelled, heroMode, heroSpot, STILL_S, touch } from './companion';
import { cornerFree, lookAround, measurePage, stopAnchors, wayClear } from './negativeSpace';
import { restSpot, stopFor, tourOn, type StopName } from './tour';

/** On the home journey his still is as small as the riding Coco (HomeStage COMPANION_SCALE). */
const TOUR_SCALE = 0.65;
import { createRoam, spaceSizes, visibleShare, type Spot } from './space';
import { ADULT_POSTER } from './paths';

/** How often he looks around the page for his space (ms). */
const LOOK_MS = 300;
/** Under reduced motion: how long he takes to fade out before he moves (ms; intro.css). */
const FADE_MS = 250;
/** After a change of page, how long he waits for the new page's layout before he looks (ms). */
const SETTLE_MS = 400;

export function PosterCompanion({ away }: { away: boolean }) {
  const [aspect, setAspect] = useState(0);
  const [missing, setMissing] = useState(false);
  /** Where he is shown (document px), and whether he is shown at all. */
  const [shown, setShown] = useState<{ spot: Spot | null; visible: boolean; corner?: boolean }>({ spot: null, visible: false });

  const { pathname } = useLocation();
  const firstPage = useRef(true);

  useEffect(() => {
    if (away) firstPage.current = false;
    if (!aspect || away) { setShown((v) => ({ ...v, visible: false })); return; }
    // a change of page: he fades out at once (his old place means nothing on the new page) and
    // looks for his space once the new page has been laid out (SETTLE_MS)
    const settle = firstPage.current ? 0 : SETTLE_MS;
    firstPage.current = false;
    if (settle) setShown((v) => ({ ...v, visible: false }));
    const R = createRoam();
    const dwell = createDwell(performance.now() / 1000);
    let hero = false;
    let tourStop: StopName = 'hero';
    let fade = 0;
    let first = true;
    let current: Spot | null = null;
    /** Peeking from this bottom corner (window px, fixed to the window), or not. */
    let side: 'right' | 'left' | null = null;
    let timer = 0;
    const still = prefersReducedMotion();
    const look = () => {
      const now = performance.now();
      // the hero at the top of home holds his painting: while it is on screen he is not shown
      const el = document.querySelector<HTMLElement>('.hero-stage');
      const hr = el?.getBoundingClientRect();
      const W = window.innerWidth, H = window.innerHeight;
      const spot = hr && hr.width > 0 ? heroSpot({ left: hr.left, top: hr.top, right: hr.right, bottom: hr.bottom }, aspect, spaceSizes(W, H).maxH) : null;
      const heroShare = spot ? visibleShare(spot, aspect, { left: 0, top: 0, right: W, bottom: H }) : 0;
      hero = !!spot && heroMode(hero, heroShare);
      // the home journey on a laptop or desktop (tour.ts): his still appears at each stop, with a fade
      const tour = tourOn(window.location.hash, W);
      let tourNext: Spot | null | undefined;
      if (tour) {
        const m = measurePage(W, H);
        tourStop = stopFor(tourStop, heroShare, stopAnchors(), m.view);
        hero = tourStop === 'hero';
        if (!hero && tourStop !== 'corner') {
          const an = stopAnchors().find((x) => x.name === tourStop);
          const sz = spaceSizes(W, H);
          const opts = { ...sz, minH: sz.minH * TOUR_SCALE, maxH: sz.maxH * TOUR_SCALE, aspect };
          const sp = an ? restSpot(tourStop as 'realms' | 'works' | 'bottom', an.rect, m.view, m.obstacles, opts) : null;
          tourNext = sp ? { ...sp, cy: sp.cy + window.scrollY } : null;
        } else tourNext = null;
      }
      if (hero) {
        window.clearTimeout(fade);
        if (current || side) { current = null; side = null; R.spot = null; setShown((v) => ({ ...v, visible: false })); }
        return;
      }
      // he moves only once scrolling has stopped (he never rides: he fades, or glides while still)
      if (!dwelled(dwell, now / 1000, STILL_S)) return;
      const near = current ? { cx: current.cx, cy: current.cy - window.scrollY } : null;
      if (tourNext === undefined) lookAround(R, { aspect, now: now / 1000, scrollIdle: true, near, force: first });
      first = false;
      // (on the journey his place is the stop's; the same place again is no change)
      const sameStop = tourNext && current && Math.hypot(tourNext.cx - current.cx, tourNext.cy - current.cy) < 24;
      const next = tourNext === undefined ? R.spot : sameStop ? current : tourNext;
      // no space fits him: he peeks from a bottom corner, the one he is in first, clear of controls
      let nextSide: 'right' | 'left' | null = null;
      let peek: Spot | null = null;
      if (!next) {
        for (const c of (side === 'left' ? ['left', 'right'] : ['right', 'left']) as ('right' | 'left')[]) {
          const at = cornerSpot(document.documentElement.clientWidth || W, H, aspect, c);
          if (cornerFree(at, aspect)) { nextSide = c; peek = at; break; }
        }
      }
      if (!next && nextSide && nextSide === side) {
        // the same corner: only follows the window's size
        setShown((v) => (v.spot && (v.spot.cx !== peek!.cx || v.spot.cy !== peek!.cy || v.spot.h !== peek!.h) ? { ...v, spot: peek } : v));
        return;
      }
      if (next === current && nextSide === side) return;
      const was = current ?? (side ? { cx: 0, cy: 0, h: 0 } : null);
      current = next;
      side = nextSide;
      window.clearTimeout(fade);
      if (peek) {
        // out of sight where he was, then faded in at the corner
        setShown((v) => ({ ...v, visible: false }));
        fade = window.setTimeout(() => {
          setShown({ spot: peek, visible: false, corner: true });
          fade = window.setTimeout(() => setShown({ spot: peek, visible: true, corner: true }), 50);
        }, was ? FADE_MS : 0);
        return;
      }
      if (!next) { setShown((v) => ({ ...v, visible: false })); return; }
      const sy = window.scrollY;
      if (!was || still || !was.h || !wayClear({ ...was, cy: was.cy - sy }, { ...next, cy: next.cy - sy }, aspect)) {
        // from nowhere, under reduced motion, or where the glide would cross content: out of
        // sight, moved while unseen, and faded back in
        setShown((v) => ({ ...v, visible: false }));
        fade = window.setTimeout(() => {
          setShown({ spot: next, visible: false });
          fade = window.setTimeout(() => setShown({ spot: next, visible: true }), 50);
        }, was ? FADE_MS : 0);
      } else setShown({ spot: next, visible: true });
    };
    const onScroll = () => touch(dwell, performance.now() / 1000);
    const start = () => { look(); timer = window.setInterval(look, LOOK_MS); };
    const wait = settle ? window.setTimeout(start, settle) : 0;
    if (!settle) start();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.clearTimeout(wait);
      window.clearInterval(timer);
      window.clearTimeout(fade);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [aspect, away, pathname]);

  if (missing) return null;
  const s = shown.spot;
  return (
    <img
      className={`guide-poster${shown.visible && s ? ' is-shown' : ''}${shown.corner ? ' is-corner' : ''}`}
      src={asset(ADULT_POSTER)}
      alt=""
      aria-hidden
      decoding="async"
      fetchPriority="low"
      style={s ? { height: `${s.h}px`, transform: `translate3d(${s.cx - (s.h * aspect) / 2}px, ${s.cy - s.h / 2}px, 0)` } : undefined}
      onLoad={(e) => { const i = e.currentTarget; setAspect(i.naturalHeight > 0 ? i.naturalWidth / i.naturalHeight : 0.9); }}
      onError={() => setMissing(true)}
    />
  );
}
