// The illustrated companion: where Coco is not drawn in 3D (lite: reduced motion, data saver, low
// memory, no WebGL; or 3D gave up), a still of him (a Blender render) keeps the visitor company in
// the bottom-right corner on every page, with the same peek and step-aside rules as the 3D companion
// (docking.ts stepAside), moved by eased CSS transforms (under reduced motion he only fades in and
// out). On home he waits while the hero, with its living painting, is in view. No still, no companion.

import { useEffect, useRef, useState } from 'react';
import { asset } from '../content';
import { stage } from '../scene/stage';
import { ASIDE, createAside, endRoom, focusInCorner, heroRect, nextDocked, stepAside } from './docking';
import { ADULT_POSTER } from './paths';

export function PosterCompanion({ onHome }: { onHome: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [away, setAway] = useState(true);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const se = () => document.scrollingElement ?? root;
    const aside = createAside(se().scrollTop, performance.now() / 1000);
    let docked = true;
    let timer = 0;
    const update = () => {
      const el = se(), vh = window.innerHeight;
      docked = nextDocked(docked, onHome ? heroRect(stage.el) : null, vh);
      const h = img.current?.offsetHeight ?? 0, w = img.current?.offsetWidth ?? 0;
      const hold = root.hasAttribute('data-menu-open') || focusInCorner(endRoom(h), w);
      const out = stepAside(aside, el.scrollTop, performance.now() / 1000, el.scrollTop + vh >= el.scrollHeight - 4, hold);
      setAway(!docked || out);
      // stepped aside: he peeks back up once the page has been still for a moment
      window.clearTimeout(timer);
      if (aside.away) timer = window.setTimeout(update, ASIDE.idle * 1000 + 50);
    };
    const resize = () => {
      root.style.setProperty('--guide-room', `${endRoom(img.current?.offsetHeight ?? 0)}px`);
      update();
    };
    resize();
    const menu = new MutationObserver(update);
    menu.observe(root, { attributes: true, attributeFilter: ['data-menu-open'] });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', resize);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      window.clearTimeout(timer);
      menu.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', resize);
      root.style.removeProperty('--guide-room');
    };
  }, [loaded, onHome]);

  if (missing) return null;
  return (
    <img
      ref={img}
      className={`guide-poster${loaded ? ' is-loaded' : ''}${away ? ' is-away' : ''}`}
      src={asset(ADULT_POSTER)}
      alt=""
      aria-hidden
      decoding="async"
      fetchPriority="low"
      onLoad={() => setLoaded(true)}
      onError={() => setMissing(true)}
    />
  );
}
