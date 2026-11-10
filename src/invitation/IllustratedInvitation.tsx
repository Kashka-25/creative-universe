// The invitation without motion: for reduced motion, data saver, low memory, no WebGL, or when
// the 3D take cannot load. A still of Adult Coco rendered in Blender from his own model (the same
// still home shows while he loads) if there is one, otherwise Cassidy's painting, still. No auto-advance: the visitor comes in when they choose.

import { useEffect, useRef, useState } from 'react';
import { asset } from '../content';
import { LivingPainting } from '../living/LivingPainting';
import { ADULT_POSTER } from '../guide/paths';

/** The painting appears anyway after this long, even if an image is slow (it never stays empty). */
const PAINTING_WAIT_MS = 2500;

/**
 * Cassidy's painting, held still, faded in as ONE piece once both of its layers (sky, figure) have
 * loaded, instead of popping in a layer at a time as each decodes.
 */
function StillPainting() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const imgs = [...el.querySelectorAll('img')];
      if (imgs.length > 0 && imgs.every((i) => i.complete)) setShown(true);
    };
    // load and error do not bubble, but they pass through their ancestors in the capture phase
    el.addEventListener('load', check, true);
    el.addEventListener('error', check, true);
    check();
    const t = window.setTimeout(() => setShown(true), PAINTING_WAIT_MS);
    return () => {
      el.removeEventListener('load', check, true);
      el.removeEventListener('error', check, true);
      window.clearTimeout(t);
    };
  }, []);
  return (
    <div ref={ref} className={`invitation__painting${shown ? ' is-shown' : ''}`} role="img" aria-label={PAINTING_ALT}>
      <LivingPainting still fadeIn={0} />
    </div>
  );
}

const PAINTING_ALT =
  "Cassidy's guide: a chimp in an orange beanie and dungarees, meditating on a turquoise cloud, a third eye on his forehead, the sun and a lightning bolt behind him.";

const STILL_ALT =
  'Coco meditating on his cloud, his eyes closed, a third eye on his forehead, the sun and a lightning bolt behind him.';

export function IllustratedInvitation() {
  const [still, setStill] = useState<'trying' | 'shown' | 'missing'>('trying');
  return (
    <div className="invitation__illustrated">
      {still !== 'missing' && (
        <img
          className={`invitation__still${still === 'shown' ? ' is-shown' : ''}`}
          src={asset(ADULT_POSTER)}
          alt={STILL_ALT}
          decoding="async"
          onLoad={() => setStill('shown')}
          onError={() => setStill('missing')}
        />
      )}
      {still === 'missing' && <StillPainting />}
    </div>
  );
}
