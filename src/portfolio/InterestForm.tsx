// "I'm interested": a short form on each work's page. It posts to Cassidy's one
// Formspree form (the site's only form, and the only request a page makes for it).
// Shown only once an endpoint is configured in content/interest.json.

import { useId, useState, type FormEvent } from 'react';
import { interestEndpoint, interestPayload, interestProblems } from './interest';

type State = 'idle' | 'sending' | 'sent' | 'error';

export function InterestForm({ project }: { project: string }) {
  const endpoint = interestEndpoint();
  const id = useId();
  const [state, setState] = useState<State>('idle');
  const [problems, setProblems] = useState<{ name?: string; email?: string }>({});
  if (!endpoint) return null;

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      name: String(f.get('name') ?? ''),
      email: String(f.get('email') ?? ''),
      message: String(f.get('message') ?? ''),
      gotcha: String(f.get('_gotcha') ?? ''),
      project,
      page: window.location.href,
    };
    const p = interestProblems(input);
    setProblems(p);
    if (p.name || p.email) return;
    if (input.gotcha) { setState('sent'); return; } // a bot: pretend, send nothing
    setState('sending');
    try {
      const body = new FormData();
      Object.entries(interestPayload(input)).forEach(([k, v]) => body.append(k, v));
      const res = await fetch(endpoint!, { method: 'POST', body, headers: { Accept: 'application/json' } });
      setState(res.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  const heading = `${id}-heading`;
  if (state === 'sent') {
    return (
      <section className="interest" aria-labelledby={heading}>
        <h2 id={heading} className="work-page__label">I’m interested</h2>
        <p role="status">Thank you. Cassidy will be in touch about {project}.</p>
      </section>
    );
  }
  return (
    <section className="interest" aria-labelledby={heading}>
      <h2 id={heading} className="work-page__label">I’m interested</h2>
      <p className="interest__intro">Want to hear more about {project}, or be part of it? Leave your details and Cassidy will reply.</p>
      <form className="interest__form" onSubmit={send} noValidate>
        <label className="interest__field">
          <span>Name</span>
          <input name="name" autoComplete="name" required aria-invalid={!!problems.name} aria-describedby={problems.name ? `${id}-name` : undefined} />
          {problems.name && <small id={`${id}-name`} className="interest__problem">{problems.name}</small>}
        </label>
        <label className="interest__field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required aria-invalid={!!problems.email} aria-describedby={problems.email ? `${id}-email` : undefined} />
          {problems.email && <small id={`${id}-email`} className="interest__problem">{problems.email}</small>}
        </label>
        <label className="interest__field">
          <span>Message <em>(optional)</em></span>
          <textarea name="message" rows={3} />
        </label>
        <label className="interest__trap" aria-hidden="true">
          Leave this empty <input name="_gotcha" tabIndex={-1} autoComplete="off" />
        </label>
        <p className="interest__privacy">Your details go to Cassidy through Formspree and are used only to reply to you.</p>
        <button className="button button--primary" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
        {state === 'error' && <p role="alert" className="interest__problem">That didn’t send. Please try again, or email YourOwnUniverse.life@gmail.com.</p>}
      </form>
    </section>
  );
}
