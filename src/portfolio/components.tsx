import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { asset, statusLabel, worksIn, type Realm, type Work } from '../content';
import { useGuide } from '../guide/GuideProvider';
import { stage } from '../scene/stage';
import { RealmEmblem } from './ornaments';
import { LivingPainting } from '../living/LivingPainting';
import { attention } from '../guide/attention';
import { ADULT_POSTER } from '../guide/paths';

export function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  return <span className={`status status--${status}`}>{statusLabel(status)}</span>;
}

/** Cover image, or a drawn stand-in when a work has none (nothing is invented: it shows the title). */
export function Cover({ work, eager = false, alt = '' }: { work: Work; eager?: boolean; alt?: string }) {
  if (work.cover) {
    return (
      <img
        className="cover"
        src={asset(work.cover.src)}
        width={work.cover.width ?? undefined}
        height={work.cover.height ?? undefined}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    );
  }
  return (
    <div className="cover cover--drawn" data-colour={work.colour} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
      <span className="cover--drawn__initial" aria-hidden>{work.title.charAt(0)}</span>
    </div>
  );
}

export function WorkCard({ work, headingLevel = 3 }: { work: Work; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <article className="work-card" data-colour={work.colour}>
      <Link to={`/work/${work.slug}`} className="work-card__link">
        <div className="work-card__media"><Cover work={work} /></div>
        <div className="work-card__body">
          <p className="work-card__meta">
            <span>{work.category}</span>
            <StatusPill status={work.status} />
          </p>
          <H className="work-card__title">{work.title}</H>
          {work.description && <p className="work-card__desc">{work.description}</p>}
        </div>
      </Link>
    </article>
  );
}

export function RealmMedallion({ realm, size = 'md' }: { realm: Realm; size?: 'md' | 'lg' }) {
  return (
    <span className={`medallion medallion--${size}`} data-colour={realm.accent}>
      <RealmEmblem emblem={realm.emblem} className="medallion__emblem" />
    </span>
  );
}

export const realmHref = (r: Realm) => (r.kind === 'page' ? `/${r.id}` : `/realm/${r.id}`);

export function realmCount(r: Realm) {
  if (r.kind === 'page') return null;
  const n = worksIn(r.id).length;
  return n === 0 ? 'Still growing' : `${n} ${n === 1 ? 'work' : 'works'}`;
}

/**
 * Coco's home in the hero. With 3D running, the guide layer draws him over this box: until he is
 * ready a still poster of him holds his place (if there is one), then an invisible button over him
 * lets a pointer say hello. His reaction is purely visual (the 3D layer is hidden from assistive
 * technology), so the button is not a tab stop and is hidden from screen readers too.
 * Otherwise Cassidy's living painting is his home.
 */
export function HeroStage() {
  const { live3D, ready, instant } = useGuide();
  const ref = useRef<HTMLDivElement>(null);
  // a layout effect: its cleanup runs in the same task that takes the hero out of the page, so no
  // frame of his ever sees a hero that has already gone (a detached box measures all zeros)
  useLayoutEffect(() => {
    stage.set(ref.current);
    return () => stage.set(null);
  }, []);
  if (live3D) {
    return (
      <div className="hero-stage hero-stage--live" ref={ref}>
        <Poster leaving={ready} instant={instant} />
        {ready && (
          <button
            type="button"
            className="hero-stage__greet"
            tabIndex={-1}
            aria-hidden
            title="Say hello to Coco"
            onClick={() => attention.push({ kind: 'tap' })}
          />
        )}
      </div>
    );
  }
  return (
    <div className="hero-stage" ref={ref} aria-hidden>
      <LivingPainting className="hero-stage__living" />
    </div>
  );
}

/** A still of Coco while the 3D one loads; it fades away as he appears. Nothing if there is no poster. */
function Poster({ leaving, instant }: { leaving: boolean; instant: boolean }) {
  const [missing, setMissing] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    // it waits, opaque, while he fades in over it, then fades itself (see .is-leaving)
    const t = window.setTimeout(() => setGone(true), 1500);
    return () => window.clearTimeout(t);
  }, [leaving]);
  // arriving under the cloud veil he is there at once: the cloud clearing is the reveal, so the
  // still (a different pose from his settle) never shows over him
  if (missing || gone || (leaving && instant)) return null;
  return (
    <img
      className={`hero-stage__poster${leaving ? ' is-leaving' : ''}`}
      src={asset(ADULT_POSTER)}
      alt=""
      aria-hidden
      decoding="async"
      onError={() => setMissing(true)}
    />
  );
}
