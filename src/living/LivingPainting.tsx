// The painting, alive: Cassidy's guide breathes, his head moves a little, his
// third eye glows, the sun breathes and the clouds drift, and now and then he
// lifts the cloud in his hands towards you. Hovering or tapping him invites
// that offering.
//
// Reduced motion, no WebGL, or a load failure: the same painting, still.
// Off screen or in a background tab: paused.

import { useEffect, useRef, useState } from 'react';
import { asset } from '../content';
import layoutJson from '../../public/art/living/layers.json';
import { motionAt, nextOffer } from './motion';
import { LivingRenderer, type Layout } from './renderer';

export const LAYOUT = layoutJson as unknown as Layout;
const FRAME_MS = 1000 / 30;
/** One clock and one offering for every copy, so the welcome's painting and the hero's move as one. */
const shared = { epoch: 0, offeredAt: null as number | null };

const prefersStill = () =>
  typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

export interface LivingPaintingProps {
  className?: string;
  /** Fade in over this many ms when it first draws (0: at once). */
  fadeIn?: number;
  /** Always the still painting (no WebGL, no motion). */
  still?: boolean;
}

export function LivingPainting({ className = '', fadeIn = 700, still: forceStill = false }: LivingPaintingProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const offerRequest = useRef(false);
  const [still, setStill] = useState(() => forceStill || prefersStill());

  useEffect(() => {
    if (still) return;
    let renderer: LivingRenderer | null = null;
    let raf = 0;
    let visible = true;
    let disposed = false;
    let last = 0;
    let start = 0;
    const el = wrap.current!;
    const cv = canvas.current!;

    const fit = () => {
      if (!renderer) return;
      // Layout size, not the on-screen box: CSS transforms on a parent must not resize the canvas.
      const r = { width: el.clientWidth, height: el.clientHeight };
      const a = LAYOUT.aspect;
      const w = Math.min(r.width, r.height * a);
      const h = w / a;
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      renderer.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!renderer || !visible || document.hidden || now - last < FRAME_MS) return;
      last = now;
      if (!start) start = now;
      if (!shared.epoch) shared.epoch = now;
      const t = (now - shared.epoch) / 1000;
      if (offerRequest.current || nextOffer(t, shared.offeredAt)) {
        const busy = shared.offeredAt !== null && t - shared.offeredAt < 4.6;
        if (!busy) shared.offeredAt = t;
        offerRequest.current = false;
      }
      const opacity = fadeIn ? Math.min(1, (now - start) / fadeIn) : 1;
      renderer.draw(t, motionAt(t, shared.offeredAt), opacity);
    };

    Promise.all(['figure', 'sky', 'mask'].map((n) => load(asset(`art/living/${n}.webp`))))
      .then(([figure, sky, mask]) => {
        if (disposed) return;
        renderer = new LivingRenderer(cv, LAYOUT, { figure, sky, mask });
        fit();
        raf = requestAnimationFrame(frame);
      })
      .catch((e) => { console.warn('[living painting] showing the still painting:', e); if (!disposed) setStill(true); });

    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { rootMargin: '60px' });
    io.observe(el);
    const lost = (e: Event) => { e.preventDefault(); setStill(true); };
    cv.addEventListener('webglcontextlost', lost);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      cv.removeEventListener('webglcontextlost', lost);
      renderer?.dispose();
    };
  }, [still, fadeIn]);

  // Reduced motion turned on while it is moving: it holds still at once, not only on the next visit.
  useEffect(() => {
    if (still) return;
    const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    if (!mq?.addEventListener) return;
    const onChange = () => { if (mq.matches) setStill(true); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [still]);

  const offer = () => { offerRequest.current = true; };

  return (
    <div className={`living ${className}`} ref={wrap} onPointerEnter={offer} onClick={offer} aria-hidden>
      {still ? (
        <div className="living__still" style={{ aspectRatio: String(LAYOUT.aspect) }}>
          <img src={asset('art/living/sky.webp')} alt="" />
          <img src={asset('art/living/figure.webp')} alt="" />
        </div>
      ) : (
        <canvas ref={canvas} className="living__canvas" />
      )}
    </div>
  );
}
