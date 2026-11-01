import { languageName, languageDirective } from '../src/i18n/language';

describe('languageName', () => {
  it('maps supported codes', () => {
    expect(languageName('fr')).toBe('French');
    expect(languageName('ar')).toBe('Arabic');
    expect(languageName('zh-TW')).toBe('Traditional Chinese');
    expect(languageName('zh')).toBe('Simplified Chinese');
  });
  it('falls back to primary subtag, then null', () => {
    expect(languageName('fr-CA')).toBe('French');
    expect(languageName('xx')).toBeNull();
    expect(languageName(null)).toBeNull();
  });
});

describe('languageDirective', () => {
  it('returns empty for English / unknown / missing (no behaviour change)', () => {
    expect(languageDirective('en')).toBe('');
    expect(languageDirective(null)).toBe('');
    expect(languageDirective(undefined)).toBe('');
    expect(languageDirective('xx')).toBe('');
  });
  it('instructs the model to respond in the target language', () => {
    const fr = languageDirective('fr');
    expect(fr).toContain('French');
    expect(fr.toUpperCase()).toContain('RESPONSE LANGUAGE');
    const ur = languageDirective('ur');
    expect(ur).toContain('Urdu');
  });
  it('preserves official form codes (does not translate identifiers)', () => {
    const de = languageDirective('de');
    expect(de).toContain('DS-160');
    expect(de).toContain('IMM 5257');
  });
});
