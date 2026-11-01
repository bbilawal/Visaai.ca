import {
  scriptForLocale,
  pickFont,
  loadFont,
} from '../src/modules/prefill/pdf-fonts';

describe('scriptForLocale', () => {
  it('maps the 15 shipped locales to scripts', () => {
    for (const l of ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'tr'])
      expect(scriptForLocale(l)).toBe('latin');
    expect(scriptForLocale('ar')).toBe('arabic');
    expect(scriptForLocale('ur')).toBe('arabic');
    expect(scriptForLocale('hi')).toBe('devanagari');
    for (const l of ['zh', 'zh-TW', 'ja', 'ko'])
      expect(scriptForLocale(l)).toBe('cjk');
  });

  it('falls back to base subtag then latin', () => {
    expect(scriptForLocale('zh-Hans-CN')).toBe('cjk'); // base zh
    expect(scriptForLocale('xx')).toBe('latin');
    expect(scriptForLocale(null)).toBe('latin');
    expect(scriptForLocale(undefined)).toBe('latin');
  });
});

describe('pickFont', () => {
  it('flags RTL only for arabic script', () => {
    expect(pickFont('ar').rtl).toBe(true);
    expect(pickFont('ur').rtl).toBe(true);
    expect(pickFont('en').rtl).toBe(false);
    expect(pickFont('zh').rtl).toBe(false);
  });

  it('uses one file for both CJK weights', () => {
    const c = pickFont('ja');
    expect(c.script).toBe('cjk');
    expect(c.boldFile).toBe(c.regularFile);
  });
});

describe('loadFont', () => {
  it('reads a vendored font file into a non-empty Buffer and caches it', () => {
    const a = loadFont('NotoSansArabic_400Regular.ttf');
    expect(a.length).toBeGreaterThan(1000);
    expect(loadFont('NotoSansArabic_400Regular.ttf')).toBe(a); // same cached ref
  });
});
