// His true form, emerging: the living painting appears where the cocoon
// opened, then glides into his home in the portfolio hero ("he has found his
// home"). When it arrives the story moves on (LANDED) and the hero's own
// living painting, already drawing underneath, takes over.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { IntroEvent, IntroState } from '../intro/introMachine';
import { emergence } from '../scene/emergence';
import { stage } from '../scene/stage';
import { LAYOUT, LivingPainting } from './LivingPainting';

/** How much of the painting's height the chimp fills (cloud base to beanie), and where his middle sits. */
const CHIMP_SHARE = 0.71;
const CHIMP_MIDDLE = 0.447;

interface Box { left: number; top: number; width: number; height: number }

function fromCocoon(): Box {
  const r = emergence.rect ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.48, h: window.innerHeight * 0.42 };
  const height = Math.min(window.innerHeight * 0.95, (r.h / CHIMP_SHARE) * 1.02);
  const width = height * LAYOUT.aspect;
  return { left: r.x - width / 2, top: r.y - CHIMP_MIDDLE * height, width, height };
}

function intoHero(): Box | null {
  const el = stage.el;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const width = Math.min(r.width, r.height * LAYOUT.aspect);
  const height = width / LAYOUT.aspect;
  return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height };
}

export function EmergingPainting({ state, send }: { state: IntroState; send: (e: IntroEvent) => void }) {
  const [box] = useState<Box>(fromCocoon);
  // The glide is a GPU transform from where he emerged to his home: the canvas never resizes mid-flight.
  const [glide, setGlide] = useState<string | null>(null);
  const moving = glide !== null;
  const landed = useRef(false);

  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (state !== 'revealing') return;
    // Make sure the start position is laid out (it is, if he emerged; not yet, after a skip), then glide.
    el.current?.getBoundingClientRect();
    const t = window.setTimeout(() => {
      const target = intoHero();
      if (!target) { landed.current = true; send({ type: 'LANDED' }); return; }
      const s = target.width / box.width;
      setGlide(`translate(${target.left - box.left}px, ${target.top - box.top}px) scale(${s})`);
    }, 40);
    return () => window.clearTimeout(t);
  }, [state, send, box]);

  useEffect(() => {
    if (!moving) return;
    // If the transition's end is never reported (a busy or hidden page), land anyway.
    const t = window.setTimeout(() => { if (!landed.current) { landed.current = true; send({ type: 'LANDED' }); } }, 2000);
    return () => window.clearTimeout(t);
  }, [moving, send]);

  const style: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height, transform: glide ?? undefined };
  return (
    <div
      ref={el}
      className={`emerging ${moving ? 'is-going-home' : ''}`}
      style={style}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'transform' && !landed.current) { landed.current = true; send({ type: 'LANDED' }); }
      }}
      aria-hidden
    >
      <div className="emerging__inner">
        <LivingPainting fadeIn={0} />
      </div>
    </div>
  );
}
