import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import enquire from '../content/enquire.json';

describe('the Enquire page', () => {
  it("carries Cassidy's own words and offerings", () => {
    expect(enquire.dream.text).toContain('bringing a dream of theirs into the digital world');
    expect(enquire.offerings.roles).toEqual([
      'Digital creator',
      'Holistic counsellor',
      'Complementary therapist',
      'Psychedelic integration therapist',
      'Shadow work facilitator',
      'Someone whose main intention is supporting people in freeing their dreams',
    ]);
    expect(enquire.offerings.consultation).toMatch(/^A consultation with me is more about encouraging an individual that anything is possible/);
  });

  it('files enquiries apart from project interest, by subject', () => {
    expect(enquire.form.project).toBe('General enquiry');
  });

  it('has its own address, with #/contact leading there too', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toMatch(/path: ENQUIRE_PATH, element: <EnquirePage \/>/);
    expect(main).toMatch(/path: '\/contact', element: <Navigate to=\{ENQUIRE_PATH\} replace \/>/);
    expect(readFileSync('src/portfolio/EnquirePage.tsx', 'utf8')).toContain("ENQUIRE_PATH = '/enquire'");
  });
});
