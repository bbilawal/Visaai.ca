import {
  MESSAGES,
  resolveEmailLocale,
  messagesFor,
  type EmailLocale,
} from '../src/i18n/email/messages';

const LOCALES: EmailLocale[] = [
  'en',
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'nl',
  'ar',
  'tr',
  'hi',
  'ur',
  'zh',
  'zh-TW',
  'ja',
  'ko',
];
const STAGES = [
  'intake',
  'documents',
  'narrative',
  'readiness',
  'prefill',
  'submission',
] as const;

describe('email catalog key-parity', () => {
  it('has all 15 locales', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort());
  });

  it('every locale has the same reminder keys as en + all 6 nextStep stages', () => {
    const enReminder = Object.keys(MESSAGES.en.reminder).sort();
    for (const l of LOCALES) {
      expect(Object.keys(MESSAGES[l].reminder).sort()).toEqual(enReminder);
      for (const s of STAGES) {
        expect(typeof MESSAGES[l].nextStep[s]).toBe('string');
        expect(MESSAGES[l].nextStep[s].length).toBeGreaterThan(0);
      }
    }
  });

  it('bodyWithCountry carries the {country} placeholder in every locale', () => {
    for (const l of LOCALES) {
      expect(MESSAGES[l].reminder.bodyWithCountry).toContain('{country}');
    }
  });
});

describe('resolveEmailLocale', () => {
  it('maps each supported locale to itself', () => {
    for (const l of LOCALES) expect(resolveEmailLocale(l)).toBe(l);
  });
  it('falls back base subtag then en', () => {
    expect(resolveEmailLocale('zh-Hans-CN')).toBe('zh');
    expect(resolveEmailLocale('en-US')).toBe('en');
    expect(resolveEmailLocale('xx')).toBe('en');
    expect(resolveEmailLocale(null)).toBe('en');
    expect(resolveEmailLocale(undefined)).toBe('en');
  });
});

describe('messagesFor', () => {
  it('returns the resolved locale messages', () => {
    expect(messagesFor('ar')).toBe(MESSAGES.ar);
    expect(messagesFor('xx')).toBe(MESSAGES.en);
  });
});
