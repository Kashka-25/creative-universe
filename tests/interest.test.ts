import { describe, expect, it } from 'vitest';
import { interestEndpoint, interestPayload, interestProblems, interestSubject } from '../src/portfolio/interest';

describe('the shared interest form', () => {
  it('accepts only a Formspree form endpoint', () => {
    expect(interestEndpoint('https://formspree.io/f/abc123XYZ')).toBe('https://formspree.io/f/abc123XYZ');
    expect(interestEndpoint(' https://formspree.io/f/abc123 ')).toBe('https://formspree.io/f/abc123');
    for (const bad of ['', undefined, null, 42, 'http://formspree.io/f/abc', 'https://example.test/f/abc', 'https://formspree.io/f/abc/../x', 'javascript:alert(1)']) {
      expect(interestEndpoint(bad)).toBeNull();
    }
  });

  it("uses Cassidy's configured Formspree form", () => {
    expect(interestEndpoint()).toMatch(/^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/);
  });

  it('puts the project in the subject, for Gmail labels', () => {
    expect(interestSubject('Kronk Booth', '  Fake Person ')).toBe('[Kronk Booth] Interest from Fake Person');
  });

  it('needs a name and a valid email', () => {
    expect(interestProblems({ name: '', email: '' })).toEqual({ name: expect.any(String), email: expect.any(String) });
    expect(interestProblems({ name: 'Fake', email: 'not-an-email' }).email).toBeTruthy();
    expect(interestProblems({ name: 'Fake', email: 'fake@example.test' })).toEqual({});
  });

  it('sends the project, the page and the honeypot', () => {
    const p = interestPayload({ name: ' Fake ', email: ' fake@example.test ', project: 'YOU', page: 'https://example.test/#/work/you' });
    expect(p).toEqual({
      name: 'Fake', email: 'fake@example.test', message: '', project: 'YOU',
      page: 'https://example.test/#/work/you', subject: '[YOU] Interest from Fake', _gotcha: '',
    });
  });
});
