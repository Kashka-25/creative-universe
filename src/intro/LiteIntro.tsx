// The illustrated welcome for devices that should not run the 3D intro
// (reduced motion, no WebGL, data saver, low memory). It uses Cassidy's
// original painting, so the guide still greets every visitor.

import { useEffect } from 'react';
import { asset, owner } from '../content';
import type { IntroEvent, IntroState } from './introMachine';

export function LiteIntro({ state, send }: { state: IntroState; send: (e: IntroEvent) => void }) {
  useEffect(() => {
    if (state !== 'revealing') return;
    const t = window.setTimeout(() => send({ type: 'LANDED' }), 900);
    return () => window.clearTimeout(t);
  }, [state, send]);

  return (
    <div className={`lite-intro is-${state}`}>
      <div className="lite-intro__sky" aria-hidden />
      <figure className="lite-intro__guide">
        <img src={asset('art/guide.webp')} alt="Cassidy's guide: a chimp in an orange beanie and dungarees, meditating on a turquoise cloud, a third eye on his forehead, the sun and a lightning bolt behind him." />
      </figure>
      <div className="lite-intro__words">
        <p className="lite-intro__eyebrow">Welcome to the creative universe of</p>
        <p className="lite-intro__name">{owner.name}</p>
        <button type="button" className="intro-follow" onClick={() => send({ type: 'FOLLOW' })} autoFocus>
          Follow him in
        </button>
      </div>
    </div>
  );
}
