// Cassidy's offerings (content/enquire.json, Cassidy's own words), shared by the About page
// and the Enquire page, and the "Send an enquiry" button that opens the enquiry form in place.

import { useEffect, useId, useRef, useState } from 'react';
import enquire from '../../content/enquire.json';
import { InterestForm } from './InterestForm';

/** The roles and the consultation note. `headingLevel` keeps the page outline right. */
export function OfferingsList({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Heading = `h${headingLevel}` as const;
  const id = useId();
  return (
    <section aria-labelledby={id} className="enquire-page__offerings">
      <Heading id={id} className="work-page__label">{enquire.offerings.heading}</Heading>
      <ul className="enquire-page__roles">
        {enquire.offerings.roles.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <p className="prose">{enquire.offerings.consultation}</p>
    </section>
  );
}

/** A "Send an enquiry" button; pressing it opens the enquiry form below and moves focus into it. */
export function EnquiryButton() {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  }, [open]);
  return (
    <div className="enquiry-toggle">
      {!open && (
        <button type="button" className="button button--primary" aria-expanded={false} aria-controls={panel} onClick={() => setOpen(true)}>
          {enquire.form.heading}
        </button>
      )}
      <div id={panel} ref={box} hidden={!open}>
        {open && <InterestForm project={enquire.form.project} heading={enquire.form.heading} intro={enquire.form.intro} />}
      </div>
    </div>
  );
}
