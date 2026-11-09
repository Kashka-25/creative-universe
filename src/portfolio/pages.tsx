import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  about, asset, neighbours, owner, realmById, realms, workBySlug, works, worksIn, type RealmId,
} from '../content';
import { Cover, HeroStage, RealmMedallion, StatusPill, WorkCard, realmCount, realmHref } from './components';
import { CloudScroll, LeafDivider, Vine } from './ornaments';
import { useDocumentTitle } from './useDocumentTitle';
import { prefersReducedMotion } from '../intro/capability';

/**
 * "Explore the realms": the view moves to them (smoothly, unless the visitor asks for reduced
 * motion) and so does keyboard focus, so Tab carries on from there and a screen reader lands on
 * "The realms" instead of going back to the hero.
 */
function exploreRealms() {
  const section = document.getElementById('realms');
  if (!section) return;
  section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  section.focus({ preventScroll: true });
}

// ── The World (home) ───────────────────────────────────────
export function WorldPage() {
  useDocumentTitle();
  const [filter, setFilter] = useState<RealmId | 'all'>('all');
  const withWorks = realms.filter((r) => r.kind === 'works' && worksIn(r.id).length > 0);
  const shown = filter === 'all' ? works : worksIn(filter);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <Vine className="hero__vine hero__vine--left" />
        <div className="hero__words">
          <p className="eyebrow">Cassidy’s Creative Universe</p>
          <h1 id="hero-title" className="hero__title">{owner.name}</h1>
          <p className="hero__line">{owner.line}</p>
          <p className="hero__intro">{owner.intro}</p>
          <div className="hero__actions">
            <button type="button" className="button button--primary" onClick={exploreRealms}>
              Explore the realms
            </button>
            <Link to="/about" className="button button--ghost">About &amp; contact</Link>
          </div>
        </div>
        <HeroStage />
      </section>

      <LeafDivider className="divider" />

      <section id="realms" className="realms" aria-labelledby="realms-title" tabIndex={-1}>
        <header className="section-head">
          <h2 id="realms-title">The realms</h2>
          <p>Six regions of one world. Wander in any order.</p>
        </header>
        <ol className="realm-path">
          {realms.map((r, i) => (
            <li key={r.id} className="realm-path__stop" style={{ ['--i' as string]: i }}>
              <Link to={realmHref(r)} className="realm-card" data-colour={r.accent}>
                <RealmMedallion realm={r} />
                <span className="realm-card__text">
                  <span className="realm-card__title">{r.title}</span>
                  <span className="realm-card__blurb">{r.blurb}</span>
                  {realmCount(r) && <span className="realm-card__count">{realmCount(r)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="works" aria-labelledby="works-title">
        <header className="section-head">
          <h2 id="works-title">Works in this world</h2>
          <CloudScroll className="section-head__cloud" />
        </header>
        <div className="chips" role="group" aria-label="Show works from">
          <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            Everything <span className="chip__n">{works.length}</span>
          </button>
          {withWorks.map((r) => (
            <button key={r.id} type="button" className="chip" data-colour={r.accent} aria-pressed={filter === r.id} onClick={() => setFilter(r.id)}>
              {r.title} <span className="chip__n">{worksIn(r.id).length}</span>
            </button>
          ))}
        </div>
        <div className="work-grid">
          {shown.map((w) => <WorkCard key={w.slug} work={w} />)}
        </div>
      </section>
    </>
  );
}

// ── A realm ────────────────────────────────────────────────
export function RealmPage() {
  const { id = '' } = useParams();
  const realm = realmById(id);
  useDocumentTitle(realm?.title);
  if (!realm) return <NotFound />;
  if (realm.kind === 'page') return <Navigate to={`/${realm.id}`} replace />;
  const list = worksIn(realm.id);
  const i = realms.indexOf(realm);
  const next = realms[(i + 1) % realms.length];
  const groups = groupByCollection(list);

  return (
    <article className="realm-page" data-colour={realm.accent}>
      <header className="page-head">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">World</Link> <span aria-hidden>›</span> <span aria-current="page">{realm.title}</span></nav>
        <RealmMedallion realm={realm} size="lg" />
        <h1>{realm.title}</h1>
        <p className="page-head__blurb">{realm.blurb}</p>
      </header>

      {list.length === 0 ? (
        <div className="empty-realm">
          <CloudScroll className="empty-realm__cloud" />
          <p className="empty-realm__title">This part of the world is still being drawn.</p>
          <p>Nothing has been placed here yet. Come back soon, or wander somewhere that’s already in bloom.</p>
          <Link to="/" className="button button--ghost">Back to the world</Link>
        </div>
      ) : (
        groups.map(([collection, items]) => (
          <section key={collection ?? 'all'} className="collection" aria-label={collection ?? realm.title}>
            {groups.length > 1 && collection && <h2 className="collection__title">{collection}</h2>}
            <div className="work-grid">
              {items.map((w) => <WorkCard key={w.slug} work={w} headingLevel={groups.length > 1 ? 3 : 2} />)}
            </div>
          </section>
        ))
      )}

      <LeafDivider className="divider" />
      <p className="journey">
        <span>Continue the journey</span>
        <Link to={realmHref(next)} className="journey__next">{next.title} <span aria-hidden>→</span></Link>
      </p>
    </article>
  );
}

function groupByCollection<T extends { collection?: string }>(list: T[]): [string | undefined, T[]][] {
  const map = new Map<string | undefined, T[]>();
  for (const w of list) map.set(w.collection, [...(map.get(w.collection) ?? []), w]);
  return [...map.entries()];
}

// ── A single work ──────────────────────────────────────────
export function WorkPage() {
  const { slug = '' } = useParams();
  const work = workBySlug(slug);
  useDocumentTitle(work?.title);
  if (!work) return <NotFound />;
  const realm = realmById(work.realm)!;
  const { prev, next } = neighbours(work);

  return (
    <article className="work-page" data-colour={work.colour}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">World</Link> <span aria-hidden>›</span>{' '}
        <Link to={realmHref(realm)}>{realm.title}</Link> <span aria-hidden>›</span>{' '}
        <span aria-current="page">{work.title}</span>
      </nav>

      <header className="work-page__head">
        <p className="work-page__meta">
          {work.category && <span>{work.category}</span>}
          <StatusPill status={work.status} />
          {work.collection && <span className="work-page__collection">{work.collection}</span>}
          {work.year && <span>{work.year}</span>}
        </p>
        <h1>{work.title}</h1>
        {work.description && <p className="work-page__lede">{work.description}</p>}
      </header>

      <figure className="work-page__cover">
        <Cover work={work} eager alt={work.cover ? `${work.title}: cover image` : ''} />
      </figure>

      <div className="work-page__body">
        {work.portfolioDescription && <p className="prose">{work.portfolioDescription}</p>}
        {work.body?.map((para, i) => <p key={i} className="prose">{para}</p>)}
        {work.role && <p className="work-page__fact"><strong>Role</strong> {work.role}</p>}
        {work.credits && <p className="work-page__fact"><strong>Credits</strong> {work.credits}</p>}
        {work.media?.map((m, i) => (
          <div key={i} className="media">
            {m.kind === 'audio' && <audio controls preload="none" src={m.src} aria-label={m.title ?? work.title} />}
            {m.kind === 'video' && <video controls preload="none" src={m.src} aria-label={m.title ?? work.title} />}
            {m.kind === 'embed' && <iframe src={m.src} title={m.title ?? work.title} loading="lazy" allow="encrypted-media; fullscreen" />}
          </div>
        ))}
        {work.gallery && (
          <div className="gallery">
            {work.gallery.map((g) => <img key={g.src} src={asset(g.src)} alt={g.alt} loading="lazy" />)}
          </div>
        )}
        {work.link && (
          <p>
            <a className="button button--primary" href={work.link} target="_blank" rel="noopener noreferrer">
              Visit {work.title} <span aria-hidden>↗</span><span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        )}
      </div>

      <LeafDivider className="divider" />
      <nav className="work-page__walk" aria-label={`More in ${realm.title}`}>
        {prev ? <Link to={`/work/${prev.slug}`} rel="prev"><span aria-hidden>←</span> {prev.title}</Link> : <span />}
        <Link to={realmHref(realm)}>All of {realm.title}</Link>
        {next ? <Link to={`/work/${next.slug}`} rel="next">{next.title} <span aria-hidden>→</span></Link> : <span />}
      </nav>
    </article>
  );
}

// ── About & Contact ────────────────────────────────────────
export function AboutPage() {
  const realm = realmById('about')!;
  useDocumentTitle(realm.title);
  const counts = useMemo(() => realms.filter((r) => r.kind === 'works').map((r) => [r, worksIn(r.id).length] as const), []);
  return (
    <article className="about-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">World</Link> <span aria-hidden>›</span> <span aria-current="page">{realm.title}</span></nav>
      <div className="about-page__grid">
        {about.portrait && (
          <figure className="about-page__portrait">
            <img src={asset(about.portrait)} alt={about.portraitAlt} />
          </figure>
        )}
        <div className="about-page__words">
          <RealmMedallion realm={realm} />
          <h1>{owner.name}</h1>
          <p className="hero__line">{owner.line}</p>
          <p className="prose">{owner.intro}</p>

          {about.contact.length > 0 ? (
            <section aria-labelledby="contact-title" className="contact">
              <h2 id="contact-title">Get in touch</h2>
              <ul>
                {about.contact.map((c) => <li key={c.href}><a href={c.href} rel="noopener noreferrer">{c.label}</a></li>)}
              </ul>
            </section>
          ) : import.meta.env.DEV ? (
            <p className="dev-slot">Contact links go in <code>content/about.json</code>. Visitors don’t see this note.</p>
          ) : null}

          <section aria-labelledby="map-title" className="about-map">
            <h2 id="map-title">Around the world</h2>
            <ul>
              {counts.map(([r, n]) => (
                <li key={r.id}><Link to={realmHref(r)}>{r.title}</Link> <span>{n === 0 ? 'still growing' : n}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </article>
  );
}

export function NotFound() {
  useDocumentTitle('Off the map');
  return (
    <div className="empty-realm">
      <CloudScroll className="empty-realm__cloud" />
      <h1 className="empty-realm__title">This path isn’t on the map.</h1>
      <Link to="/" className="button button--ghost">Back to the world</Link>
    </div>
  );
}
