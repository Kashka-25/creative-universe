import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { asset, statusLabel, worksIn, type Realm, type Work } from '../content';
import { useIntro } from '../intro/IntroProvider';
import { stage } from '../scene/stage';
import { RealmEmblem } from './ornaments';

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
 * The spot in the hero where the guide sits. With 3D running, this is an empty
 * window the scene draws into. Otherwise it shows the painting itself.
 */
export function HeroStage() {
  const { mode, sceneFailed, guideReady, state } = useIntro();
  const ref = useRef<HTMLDivElement>(null);
  const live = mode === 'full' && !sceneFailed;
  useEffect(() => {
    if (!live) return;
    stage.set(ref.current);
    return () => stage.set(null);
  }, [live]);
  const showArt = !live || (!guideReady && state === 'done');
  return (
    <div className={`hero-stage ${showArt ? 'hero-stage--art' : ''}`} ref={ref} aria-hidden>
      {showArt && <img src={asset('art/guide.webp')} alt="" className="hero-stage__art" />}
    </div>
  );
}
