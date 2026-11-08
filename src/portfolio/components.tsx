import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { asset, statusLabel, worksIn, type Realm, type Work } from '../content';
import { useIntro } from '../intro/IntroProvider';
import { stage } from '../scene/stage';
import { RealmEmblem } from './ornaments';
import { LivingPainting } from '../living/LivingPainting';

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
      <Link to={`/work/${work.slug}`} className="work-card__link" viewTransition>
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
 * The guide's home in the hero: the living painting. After the welcome's
 * metamorphosis the painting glides in here (EmergingPainting); this one is
 * already drawing underneath, hidden, and takes over when it lands.
 */
export function HeroStage() {
  const { handoff, state, covering } = useIntro();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stage.set(ref.current);
    return () => stage.set(null);
  }, []);
  // While his painting emerges in the welcome, this copy starts up hidden underneath, so nothing is left to load when he lands.
  const arriving = handoff && (state === 'revealing' || state === 'emerging');
  // When his painting glides in from the welcome, this copy takes over in place: no second fade.
  const arrived = useRef(false);
  if (arriving) arrived.current = true;
  return (
    <div className={`hero-stage ${arriving ? 'is-arriving' : ''}`} ref={ref} aria-hidden>
      {(!covering || arriving) && <LivingPainting className={`hero-stage__living ${arrived.current ? 'is-instant' : ''}`} fadeIn={arrived.current ? 0 : 700} />}
    </div>
  );
}
