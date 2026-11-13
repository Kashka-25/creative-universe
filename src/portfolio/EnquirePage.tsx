// Enquire (#/enquire, also #/contact): a general enquiry for anyone who wants to bring a
// dream into the digital world, and Cassidy's offerings as a practitioner. Words come from
// content/enquire.json (Cassidy's own); the form is the shared "I'm interested" one.

import { Link } from 'react-router-dom';
import enquire from '../../content/enquire.json';
import { about } from '../content';
import { InterestForm } from './InterestForm';
import { LeafDivider } from './ornaments';
import { SkyClouds } from './SkyClouds';
import { useDocumentTitle } from './useDocumentTitle';

export const ENQUIRE_PATH = '/enquire';

export function EnquirePage() {
  useDocumentTitle(enquire.title);
  return (
    <article className="work-page enquire-page has-clouds">
      <SkyClouds seed="enquire" count={2} />
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">World</Link> <span aria-hidden>›</span> <span aria-current="page">{enquire.title}</span>
      </nav>

      <header className="work-page__head">
        <h1>{enquire.dream.heading}</h1>
        <p className="work-page__lede">{enquire.dream.text}</p>
      </header>

      <div className="work-page__body">
        <section aria-labelledby="offerings-title" className="enquire-page__offerings">
          <h2 id="offerings-title" className="work-page__label">{enquire.offerings.heading}</h2>
          <ul className="enquire-page__roles">
            {enquire.offerings.roles.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="prose">{enquire.offerings.consultation}</p>
        </section>

        <InterestForm project={enquire.form.project} heading={enquire.form.heading} intro={enquire.form.intro} />

        {about.contact.length > 0 && (
          <p className="enquire-page__other">
            Or reach Cassidy directly:{' '}
            {about.contact.map((c, i) => (
              <span key={c.href}>{i > 0 && ' · '}<a href={c.href} rel="noopener noreferrer">{c.label}</a></span>
            ))}
          </p>
        )}
      </div>

      <LeafDivider className="divider" />
    </article>
  );
}
