import type { DocumentState } from '../document.state';

/**
 * Language detection over the raw OCR text (GAPS.md §C step 1).
 *
 * Heuristic + deterministic ON PURPOSE — detection runs on the critical path and
 * must be cheap (no AI call, no network). It only needs to answer "is this
 * English?" well enough to decide whether to enqueue a (metered) AiService
 * translation. The actual translation is the only AI spend, and it is gated by
 * `needs_translation` downstream.
 *
 * Two signals:
 *  1. Non-Latin script ranges (Arabic, CJK, Cyrillic, …) — high confidence.
 *  2. Latin-script stopword frequency (fr/es/de/pt/it vs en) — medium confidence.
 */

interface ScriptRange {
  lang: string;
  re: RegExp;
}

// Ordered: first dominant non-Latin script wins.
const SCRIPTS: ScriptRange[] = [
  { lang: 'zh', re: /[一-鿿]/g }, // Han
  { lang: 'ja', re: /[぀-ヿ]/g }, // Hiragana/Katakana (Han handled above)
  { lang: 'ko', re: /[가-힯ᄀ-ᇿ]/g }, // Hangul
  { lang: 'ar', re: /[؀-ۿ]/g }, // Arabic
  { lang: 'ru', re: /[Ѐ-ӿ]/g }, // Cyrillic
  { lang: 'hi', re: /[ऀ-ॿ]/g }, // Devanagari
  { lang: 'th', re: /[฀-๿]/g }, // Thai
  { lang: 'he', re: /[֐-׿]/g }, // Hebrew
  { lang: 'el', re: /[Ͱ-Ͽ]/g }, // Greek
];

// Compact stopword sets for the common Latin-script filing languages.
const STOPWORDS: Record<string, Set<string>> = {
  en: new Set([
    'the',
    'and',
    'of',
    'to',
    'in',
    'is',
    'for',
    'this',
    'that',
    'with',
    'name',
    'date',
    'number',
    'birth',
    'passport',
    'bank',
    'account',
  ]),
  fr: new Set([
    'le',
    'la',
    'les',
    'des',
    'une',
    'un',
    'et',
    'de',
    'du',
    'pour',
    'avec',
    'nom',
    'date',
    'naissance',
    'numero',
    'compte',
    'banque',
    'sur',
  ]),
  es: new Set([
    'el',
    'la',
    'los',
    'las',
    'una',
    'un',
    'de',
    'del',
    'para',
    'con',
    'por',
    'nombre',
    'fecha',
    'nacimiento',
    'numero',
    'cuenta',
    'banco',
    'y',
  ]),
  de: new Set([
    'der',
    'die',
    'das',
    'und',
    'mit',
    'fur',
    'von',
    'den',
    'dem',
    'ein',
    'eine',
    'name',
    'datum',
    'geburt',
    'nummer',
    'konto',
    'bank',
  ]),
  pt: new Set([
    'o',
    'a',
    'os',
    'as',
    'um',
    'uma',
    'de',
    'do',
    'da',
    'para',
    'com',
    'por',
    'nome',
    'data',
    'nascimento',
    'numero',
    'conta',
    'banco',
    'e',
  ]),
  it: new Set([
    'il',
    'lo',
    'la',
    'gli',
    'le',
    'un',
    'una',
    'di',
    'del',
    'per',
    'con',
    'nome',
    'data',
    'nascita',
    'numero',
    'conto',
    'banca',
    'e',
  ]),
};

export interface LanguageGuess {
  lang: string; // ISO-639-1
  confidence: number; // 0..1
}

/**
 * Best-effort language guess. Returns null when there is too little text to
 * decide (treated as English / no translation downstream).
 */
export function detectLanguage(text: string): LanguageGuess | null {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < 12) return null; // too little signal

  // 1. Non-Latin script dominance.
  let bestScript: { lang: string; count: number } | null = null;
  for (const { lang, re } of SCRIPTS) {
    const count = (text.match(re) ?? []).length;
    if (count > 0 && (!bestScript || count > bestScript.count)) {
      bestScript = { lang, count };
    }
  }
  if (bestScript && bestScript.count / letters >= 0.1) {
    const confidence = Math.min(
      0.99,
      Math.max(0.7, bestScript.count / letters),
    );
    return { lang: bestScript.lang, confidence };
  }

  // 2. Latin-script stopword frequency.
  const tokens = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics for matching
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (tokens.length < 4) return null;

  const hits: Record<string, number> = {};
  for (const lang of Object.keys(STOPWORDS)) hits[lang] = 0;
  for (const tok of tokens) {
    for (const [lang, set] of Object.entries(STOPWORDS)) {
      if (set.has(tok)) hits[lang]++;
    }
  }

  let top = 'en';
  for (const lang of Object.keys(hits)) {
    if (hits[lang] > hits[top]) top = lang;
  }

  // Require a clear, non-trivial signal before declaring a non-English language.
  if (top !== 'en' && hits[top] >= 2 && hits[top] > hits.en) {
    const total = Object.values(hits).reduce((a, b) => a + b, 0) || 1;
    const confidence = Math.min(0.95, Math.max(0.6, hits[top] / total));
    return { lang: top, confidence };
  }

  return { lang: 'en', confidence: 0.6 };
}

/**
 * detect_language node. Runs after run_ocr (needs rawOcrText). Sets
 * detectedLanguage / languageConfidence / needsTranslation; persisted by
 * store_verification. Does NOT translate — translation is a separate, metered,
 * best-effort step gated by needsTranslation (see documents.processor.ts).
 */
export function makeDetectLanguageNode() {
  return async function detectLanguageNode(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};

    const guess = detectLanguage(state.rawOcrText ?? '');
    if (!guess) {
      return {
        detectedLanguage: undefined,
        languageConfidence: undefined,
        needsTranslation: false,
      };
    }

    return {
      detectedLanguage: guess.lang,
      languageConfidence: guess.confidence,
      needsTranslation: guess.lang !== 'en',
    };
  };
}
