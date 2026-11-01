// Single source of truth for supported locales. Add a language = add a code
// here + a messages/<code>.json file. Everything else (selector, RTL, fallback)
// derives from this list.

export const LOCALES = [
  'en', // English
  'fr', // Français
  'es', // Español
  'de', // Deutsch
  'it', // Italiano
  'pt', // Português
  'nl', // Nederlands
  'ar', // العربية (RTL)
  'tr', // Türkçe
  'hi', // हिन्दी
  'ur', // اردو (RTL)
  'zh', // 简体中文
  'zh-TW', // 繁體中文
  'ja', // 日本語
  'ko', // 한국어
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Right-to-left locales. Drives <html dir> and layout mirroring. */
export const RTL_LOCALES: readonly Locale[] = ['ar', 'ur'];

/** Cookie that persists the chosen locale across refresh / logged-out sessions. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Endonyms (native names) for the language selector + English label for a11y. */
export const LOCALE_LABELS: Record<Locale, { native: string; english: string }> = {
  en: { native: 'English', english: 'English' },
  fr: { native: 'Français', english: 'French' },
  es: { native: 'Español', english: 'Spanish' },
  de: { native: 'Deutsch', english: 'German' },
  it: { native: 'Italiano', english: 'Italian' },
  pt: { native: 'Português', english: 'Portuguese' },
  nl: { native: 'Nederlands', english: 'Dutch' },
  ar: { native: 'العربية', english: 'Arabic' },
  tr: { native: 'Türkçe', english: 'Turkish' },
  hi: { native: 'हिन्दी', english: 'Hindi' },
  ur: { native: 'اردو', english: 'Urdu' },
  zh: { native: '简体中文', english: 'Chinese (Simplified)' },
  'zh-TW': { native: '繁體中文', english: 'Chinese (Traditional)' },
  ja: { native: '日本語', english: 'Japanese' },
  ko: { native: '한국어', english: 'Korean' },
};

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export function dirFor(locale: Locale): 'rtl' | 'ltr' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

/** Map a raw Accept-Language / browser code to a supported locale, else null. */
export function matchLocale(candidate: string | null | undefined): Locale | null {
  if (!candidate) return null;
  const lower = candidate.toLowerCase();
  // exact (handles zh-TW)
  const exact = LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  // primary subtag (en-US -> en, zh-CN -> zh)
  const primary = lower.split('-')[0];
  return LOCALES.find((l) => l.toLowerCase().split('-')[0] === primary) ?? null;
}
