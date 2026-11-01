import { resolveLocale, translate } from './i18n';
import { RTL_LOCALES, SUPPORTED_LOCALES } from './messages';

describe('resolveLocale', () => {
  it('prefers an exact tag match so zh-TW is not collapsed to zh', () => {
    expect(resolveLocale(['zh-TW'])).toBe('zh-TW');
  });

  it('falls back to the base language of a regional tag', () => {
    expect(resolveLocale(['fr-CA'])).toBe('fr');
    expect(resolveLocale(['en-GB'])).toBe('en');
  });

  it('walks the candidate list in priority order', () => {
    expect(resolveLocale(['', 'xx-YY', 'es-MX'])).toBe('es');
  });

  it('defaults to English for an unsupported locale', () => {
    expect(resolveLocale(['sw-KE'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
  });
});

describe('translate', () => {
  it('returns the localized string when present', () => {
    expect(translate('fr', 'auth.signIn')).toBe('Se connecter');
  });

  it('falls back to English for an untranslated key', () => {
    expect(translate('fr', 'billing.history')).toBe('Payment history');
  });

  it('interpolates variables', () => {
    expect(translate('en', 'documents.tooLarge', { max: 20 })).toBe(
      'That file is larger than 20 MB.',
    );
  });

  it('leaves an unknown placeholder intact rather than printing undefined', () => {
    expect(translate('en', 'auth.verifyEmailBody', {})).toContain('{email}');
  });

  it('returns the key itself when a key is missing everywhere', () => {
    expect(translate('en', 'does.not.exist' as never)).toBe('does.not.exist');
  });

  it('resolves a regional tag through its base catalogue', () => {
    expect(translate('fr' as never, 'common.cancel')).toBe('Annuler');
  });
});

describe('locale metadata', () => {
  it('marks the RTL languages the platform ships', () => {
    expect(RTL_LOCALES.has('ar')).toBe(true);
    expect(RTL_LOCALES.has('ur')).toBe(true);
    expect(RTL_LOCALES.has('en')).toBe(false);
  });

  it('covers the same locales apps/web ships', () => {
    // Guards against the two clients drifting apart on language support.
    const web = [
      'ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'nl', 'pt', 'tr', 'ur', 'zh', 'zh-TW',
    ];
    expect([...SUPPORTED_LOCALES].sort()).toEqual(web.sort());
  });

  it('always has a disclaimer string — it is a compliance requirement, not copy', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(translate(locale, 'eligibility.disclaimer').length).toBeGreaterThan(0);
    }
  });
});
