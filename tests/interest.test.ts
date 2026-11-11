import { describe, expect, it } from 'vitest';
import { interestEndpoint, interestMailto, interestPayload, interestProblems, interestRefusal, interestSubject } from '../src/portfolio/interest';

describe('the shared interest form', () => {
  it('accepts only a Formspree form endpoint', () => {
    expect(interestEndpoint('https://formspree.io/f/abc123XYZ')).toBe('https://formspree.io/f/abc123XYZ');
    expect(interestEndpoint(' https://formspree.io/f/abc123 ')).toBe('https://formspree.io/f/abc123');
    for (const bad of ['', null, 42, 'http://formspree.io/f/abc', 'https://example.test/f/abc', 'https://formspree.io/f/abc/../x', 'javascript:alert(1)']) {
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

  it('sends the project and the page, with no honeypot field for autofill to fill', () => {
    const p = interestPayload({ name: ' Fake ', email: ' fake@example.test ', project: 'YOU', page: 'https://example.test/#/work/you' });
    expect(p).toEqual({
      name: 'Fake', email: 'fake@example.test', message: '', project: 'YOU',
      page: 'https://example.test/#/work/you', subject: '[YOU] Interest from Fake',
    });
    expect(Object.keys(p)).not.toContain('_gotcha');
  });

  it('offers an email that already holds what the visitor typed', () => {
    const m = interestMailto({ name: ' Fake ', message: 'Love this & more', project: 'Empatherapy' });
    expect(m.startsWith('mailto:YourOwnUniverse.life@gmail.com?')).toBe(true);
    const q = new URLSearchParams(m.split('?')[1]);
    expect(q.get('subject')).toBe('[Empatherapy] Interest from Fake');
    expect(q.get('body')).toBe('Love this & more\n\nFrom Fake');
    expect(new URLSearchParams(interestMailto({ name: '', project: 'YOU' }).split('?')[1]).get('subject')).toBe('[YOU] Interest from a visitor');
  });

  it("explains a refusal in Formspree's own words", () => {
    expect(interestRefusal({ error: 'Validation errors', errors: [{ code: 'TYPE_EMAIL', field: 'email', message: 'should be an email' }] })).toBe('should be an email');
    expect(interestRefusal({ error: 'Form not found' })).toBe('Form not found');
    for (const none of [null, 'x', {}, { errors: [{}] }]) expect(interestRefusal(none)).toBeNull();
  });
});
