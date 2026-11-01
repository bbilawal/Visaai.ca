/**
 * Backend language support for AI generation. The user's preferred UI locale
 * (stored in users.preferred_language, mirrored from the web NEXT_LOCALE cookie)
 * is turned into a system-prompt directive so AI responses come back in the
 * user's language. English (or unknown/missing) yields an empty directive, so
 * the default behaviour is unchanged.
 *
 * Keep LANGUAGE_NAMES in sync with apps/web/i18n/config.ts LOCALES.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ar: 'Arabic',
  tr: 'Turkish',
  hi: 'Hindi',
  ur: 'Urdu',
  zh: 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  ja: 'Japanese',
  ko: 'Korean',
};

export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  return LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES[code.split('-')[0]] ?? null;
}

/**
 * System-prompt directive instructing the model to respond in the user's
 * language. Returns '' for English / unknown / missing (no behaviour change).
 * Official form codes/identifiers (DS-160, IMM 5257, etc.) are NOT translated.
 */
export function languageDirective(code: string | null | undefined): string {
  const name = languageName(code);
  if (!name || code === 'en') return '';
  return (
    `\n\nIMPORTANT — RESPONSE LANGUAGE: Write ALL of your response to the user in ${name}. ` +
    `Translate questions, labels, explanations, and helper text into ${name}. ` +
    `Keep official government form codes/identifiers (e.g. DS-160, IMM 5257, VAF1A) ` +
    `and proper nouns in their original form. Use natural, fluent ${name}.`
  );
}
