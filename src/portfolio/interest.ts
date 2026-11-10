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
  /** The honeypot: people never see it, so anything in it means a bot. */
  gotcha?: string;
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
    _gotcha: i.gotcha ?? '',
  };
}
