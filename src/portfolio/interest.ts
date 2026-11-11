// The shared "I'm interested" form: pure helpers (tested in node). One Formspree form
// receives every project's submissions; the project travels in a field and in the
// subject, so Gmail can label it and Notion can file it under the project.

import config from '../../content/interest.json';

const ENDPOINT = /^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/;

/** The configured endpoint, or null when it is missing or not a Formspree form URL. */
export function interestEndpoint(raw: unknown = (config as { endpoint?: unknown }).endpoint): string | null {
  return typeof raw === 'string' && ENDPOINT.test(raw.trim()) ? raw.trim() : null;
}

export interface InterestInput {
  name: string;
  email: string;
  message?: string;
  project: string;
  page: string;
}

/** The subject Gmail filters on: "[<Project>] Interest from <name>". */
export const interestSubject = (project: string, name: string) => `[${project}] Interest from ${name.trim()}`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with the input, by field (empty when it can be sent). */
export function interestProblems(i: Pick<InterestInput, 'name' | 'email'>): { name?: string; email?: string } {
  const p: { name?: string; email?: string } = {};
  if (!i.name.trim()) p.name = 'Please add your name.';
  if (!i.email.trim()) p.email = 'Please add your email, so Cassidy can reply.';
  else if (!EMAIL.test(i.email.trim())) p.email = 'That email doesn’t look right.';
  return p;
}

/** The fields sent to Formspree. */
export function interestPayload(i: InterestInput): Record<string, string> {
  return {
    name: i.name.trim(),
    email: i.email.trim(),
    message: (i.message ?? '').trim(),
    project: i.project,
    page: i.page,
    subject: interestSubject(i.project, i.name),
  };
}

/** Where people can write when the form can't reach Formspree. */
export const INTEREST_EMAIL = 'YourOwnUniverse.life@gmail.com';

/**
 * A mailto link that carries what the visitor already typed, so a failed send
 * costs them nothing: their own mail app opens with it filled in.
 */
export function interestMailto(i: Pick<InterestInput, 'name' | 'message' | 'project'>): string {
  const name = i.name.trim();
  const body = [(i.message ?? '').trim(), name ? `From ${name}` : ''].filter(Boolean).join('\n\n');
  const subject = interestSubject(i.project, name || 'a visitor');
  return `mailto:${INTEREST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Formspree's own explanation of a refused submission, if it gave one. */
export function interestRefusal(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { error?: unknown; errors?: unknown };
  if (Array.isArray(b.errors)) {
    const msgs = b.errors
      .map((e) => (e && typeof e === 'object' ? (e as { message?: unknown }).message : null))
      .filter((m): m is string => typeof m === 'string' && m.trim() !== '');
    if (msgs.length) return msgs.join('. ');
  }
  return typeof b.error === 'string' && b.error.trim() ? b.error.trim() : null;
}
