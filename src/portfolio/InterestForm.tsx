// "I'm interested": a short form on each work's page. It posts to Cassidy's one
// Formspree form (the site's only form, and the only request a page makes for it).
// Shown only once an endpoint is configured in content/interest.json.
//
// Sturdy by design (a supporter's message once "just didn't send"):
// - no hidden honeypot field, which phone autofill can fill and silently swallow
//   the message; Formspree's own spam filter handles bots;
// - a tap on Send always shows something next to the button, and moves focus to
//   the first field that needs fixing;
// - a send that hangs gives up after 15 seconds instead of "Sending…" forever;
// - when it can't send, the visitor gets Formspree's reason and a one-tap email
//   that already holds what they typed.

import { useId, useRef, useState, type FormEvent } from 'react';
import { INTEREST_EMAIL, interestEndpoint, interestMailto, interestPayload, interestProblems, interestRefusal } from './interest';

type State = 'idle' | 'sending' | 'sent' | 'error';
const TIMEOUT_MS = 15000;

export function InterestForm({ project, heading: title = 'I’m interested', intro }: { project: string; heading?: string; intro?: string }) {
  const endpoint = interestEndpoint();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<State>('idle');
  const [problems, setProblems] = useState<{ name?: string; email?: string }>({});
  const [reason, setReason] = useState<string | null>(null);
  const [mailto, setMailto] = useState(`mailto:${INTEREST_EMAIL}`);
  if (!endpoint) return null;

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'sending') return;
    const f = new FormData(e.currentTarget);
    const input = {
      name: String(f.get('name') ?? ''),
      email: String(f.get('email') ?? ''),
      message: String(f.get('message') ?? ''),
      project,
      page: window.location.href,
    };
    setMailto(interestMailto(input));
    const p = interestProblems(input);
    setProblems(p);
    if (p.name || p.email) {
      setState('idle');
      form.current?.querySelector<HTMLInputElement>(p.name ? 'input[name="name"]' : 'input[name="email"]')?.focus();
      return;
    }
    setState('sending');
    setReason(null);
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const body = new FormData();
      Object.entries(interestPayload(input)).forEach(([k, v]) => body.append(k, v));
      const res = await fetch(endpoint!, { method: 'POST', body, headers: { Accept: 'application/json' }, signal: abort.signal });
      if (res.ok) { setState('sent'); return; }
      setReason(interestRefusal(await res.json().catch(() => null)));
      setState('error');
    } catch {
      setReason(abort.signal.aborted ? 'it took too long to reach the form.' : 'your browser or network couldn’t reach the form.');
      setState('error');
    } finally {
      window.clearTimeout(timer);
    }
  }

  const heading = `${id}-heading`;
  if (state === 'sent') {
    return (
      <section className="interest" aria-labelledby={heading}>
        <h2 id={heading} className="work-page__label">{title}</h2>
        <p role="status">{intro ? 'Thank you. Cassidy will be in touch.' : `Thank you. Cassidy will be in touch about ${project}.`}</p>
      </section>
    );
  }
  const needsFixing = !!(problems.name || problems.email);
  return (
    <section className="interest" aria-labelledby={heading}>
      <h2 id={heading} className="work-page__label">{title}</h2>
      <p className="interest__intro">{intro ?? `Want to hear more about ${project}, or be part of it? Leave your details and Cassidy will reply.`}</p>
      <form ref={form} className="interest__form" onSubmit={send} noValidate>
        <label className="interest__field">
          <span>Name</span>
          <input name="name" autoComplete="name" required aria-invalid={!!problems.name} aria-describedby={problems.name ? `${id}-name` : undefined} />
          {problems.name && <small id={`${id}-name`} className="interest__problem">{problems.name}</small>}
        </label>
        <label className="interest__field">
          <span>Email</span>
          <input name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required aria-invalid={!!problems.email} aria-describedby={problems.email ? `${id}-email` : undefined} />
          {problems.email && <small id={`${id}-email`} className="interest__problem">{problems.email}</small>}
        </label>
        <label className="interest__field">
          <span>Message <em>(optional)</em></span>
          <textarea name="message" rows={3} />
        </label>
        <p className="interest__privacy">Your details go to Cassidy through Formspree and are used only to reply to you.</p>
        <button className="button button--primary" type="submit" disabled={state === 'sending'} aria-busy={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
        {needsFixing && <p role="alert" className="interest__problem">Almost there: please check the {problems.name && problems.email ? 'name and email' : problems.name ? 'name' : 'email'} above.</p>}
        {state === 'error' && (
          <p role="alert" className="interest__problem">
            That didn’t send{reason ? `: ${reason.replace(/[.!]?$/, '.')}` : '.'} Please try again, or{' '}
            <a href={mailto}>email it to Cassidy instead</a> ({INTEREST_EMAIL}).
          </p>
        )}
      </form>
    </section>
  );
}
