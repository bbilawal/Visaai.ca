import { buildSuggestSystemPrompt } from '../src/modules/vri/graphs/nodes/suggest-visa-categories';

describe('buildSuggestSystemPrompt', () => {
  it('scopes the directive to reasoning for a non-English locale', () => {
    const p = buildSuggestSystemPrompt('de');
    expect(p).toContain('German');
    expect(p).toContain('reasoning');
    expect(p).toContain('official English form');
  });
  it('returns the base prompt unchanged for en/null/undefined', () => {
    const base = buildSuggestSystemPrompt('en');
    expect(buildSuggestSystemPrompt(null)).toBe(base);
    expect(buildSuggestSystemPrompt(undefined)).toBe(base);
    expect(base).not.toContain('RESPONSE LANGUAGE');
  });

  it('asks for requirements fit, never an approval prediction', () => {
    const prompt = buildSuggestSystemPrompt('en');
    expect(prompt).toContain('requirements-fit score');
    expect(prompt).toMatch(/not an approval probability/i);
    expect(prompt).toMatch(/not legal advice/i);
    expect(prompt).not.toMatch(/MOST LIKELY to be approved/i);
    expect(prompt).not.toMatch(/Estimate the applicant's approval likelihood/i);
  });
});
