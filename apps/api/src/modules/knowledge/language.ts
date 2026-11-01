/**
 * Language detection, dependency-free and deliberately conservative.
 *
 * WHY NOT A LIBRARY. `franc` and friends classify across 180+ languages from
 * trigram profiles and are excellent at that. This corpus does not need that:
 * every document arrives with a declared language on its `visa_sources` row,
 * and the only question detection has to answer is "did the authority serve
 * the language it says it serves". That happens when a ministry's English page
 * falls back to the national language, or when a PDF linked from an English
 * page is only published in the original — both routine, both damaging if
 * indexed under the wrong language, because a language filter then hides the
 * document from the users who can read it.
 *
 * WHY 'und' IS A REAL ANSWER. A 30-word fee table has no reliable linguistic
 * signal. Returning a guessed 'en' would let it be filtered out of an
 * Arabic-language query; returning 'und' means it is matched by every language
 * filter, which is the correct behaviour for text that is mostly numbers.
 */

/** Scripts identifiable from a codepoint range alone. */
const SCRIPT_RANGES: Array<{ lang: string; re: RegExp }> = [
  { lang: 'ar', re: /[؀-ۿݐ-ݿ]/ },
  { lang: 'he', re: /[֐-׿]/ },
  { lang: 'el', re: /[Ͱ-Ͽ]/ },
  { lang: 'ru', re: /[Ѐ-ӿ]/ },
  { lang: 'hi', re: /[ऀ-ॿ]/ },
  { lang: 'bn', re: /[ঀ-৿]/ },
  { lang: 'ta', re: /[஀-௿]/ },
  { lang: 'th', re: /[฀-๿]/ },
  { lang: 'ko', re: /[가-힯ᄀ-ᇿ]/ },
  { lang: 'ja', re: /[぀-ゟ゠-ヿ]/ },
  { lang: 'zh', re: /[一-鿿]/ },
];

/**
 * Function words, which are the most reliable Latin-script signal available
 * without a model. Content words drift between related languages; function
 * words do not, and they are frequent enough to register in a short sample.
 */
const STOPWORDS: Record<string, string[]> = {
  en: [
    'the',
    'and',
    'you',
    'must',
    'for',
    'with',
    'your',
    'have',
    'this',
    'that',
    'not',
    'are',
    'will',
    'from',
    'apply',
  ],
  fr: [
    'le',
    'la',
    'les',
    'des',
    'vous',
    'pour',
    'dans',
    'avec',
    'votre',
    'est',
    'une',
    'sur',
    'demande',
    'doit',
    'être',
  ],
  es: [
    'el',
    'la',
    'los',
    'las',
    'para',
    'con',
    'que',
    'una',
    'del',
    'por',
    'debe',
    'solicitud',
    'usted',
    'sus',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'für',
    'mit',
    'sie',
    'nicht',
    'ist',
    'von',
    'auf',
    'ein',
    'eine',
    'müssen',
    'antrag',
  ],
  pt: [
    'de',
    'que',
    'para',
    'com',
    'uma',
    'dos',
    'das',
    'não',
    'você',
    'seu',
    'pedido',
    'deve',
    'residência',
  ],
  it: [
    'di',
    'che',
    'per',
    'con',
    'una',
    'del',
    'della',
    'non',
    'sono',
    'deve',
    'domanda',
    'soggiorno',
  ],
  nl: [
    'de',
    'het',
    'een',
    'van',
    'voor',
    'met',
    'niet',
    'zijn',
    'aanvraag',
    'moet',
    'verblijf',
  ],
  sv: [
    'och',
    'att',
    'för',
    'med',
    'inte',
    'som',
    'har',
    'ansökan',
    'uppehållstillstånd',
    'du',
  ],
  no: [
    'og',
    'for',
    'ikke',
    'med',
    'som',
    'har',
    'søknad',
    'oppholdstillatelse',
    'du',
    'må',
  ],
  fi: [
    'ja',
    'on',
    'ei',
    'että',
    'sinun',
    'hakemus',
    'oleskelulupa',
    'voit',
    'täytyy',
  ],
  tr: [
    've',
    'için',
    'bir',
    'ile',
    'olarak',
    'başvuru',
    'vize',
    'gerekir',
    'olan',
  ],
  pl: ['nie', 'jest', 'dla', 'oraz', 'wniosek', 'pobyt', 'musi', 'przez'],
};

export interface LanguageResult {
  language: string;
  confidence: number;
}

/**
 * Detect the dominant language of a document.
 *
 * @param hint the language the registry says the source is in. Used only to
 *             break a near-tie, never to override a clear signal — the point of
 *             detection is to catch the case where the hint is wrong.
 */
export function detectLanguage(text: string, hint?: string): LanguageResult {
  const sample = text.slice(0, 20_000);
  const letters = sample.replace(/[^\p{L}]/gu, '');

  // Too little linguistic content to classify. A fee table is mostly digits.
  if (letters.length < 60) return { language: 'und', confidence: 0 };

  // Non-Latin scripts are decided by codepoint density, which is unambiguous.
  for (const { lang, re } of SCRIPT_RANGES) {
    const matches = sample.match(new RegExp(re.source, 'gu'));
    if (matches && matches.length / letters.length > 0.2) {
      // Japanese uses Han characters too, so kana presence decides between
      // ja and zh rather than Han presence, which both share.
      if (lang === 'zh' && /[぀-ゟ゠-ヿ]/.test(sample)) {
        return { language: 'ja', confidence: 0.95 };
      }
      return { language: lang, confidence: 0.95 };
    }
  }

  const words = sample
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length < 20) return { language: 'und', confidence: 0 };

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  const scores: Array<{ lang: string; score: number }> = [];
  for (const [lang, stops] of Object.entries(STOPWORDS)) {
    let hits = 0;
    for (const s of stops) hits += counts.get(s) ?? 0;
    scores.push({ lang, score: hits / words.length });
  }
  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1];

  if (top.score < 0.01) return { language: 'und', confidence: 0 };

  // Near-tie between two languages that share function words (nl/de, no/sv,
  // es/pt). The registry's declared language breaks it — but only here, where
  // the evidence genuinely does not separate them.
  if (second && top.score - second.score < 0.005) {
    if (hint === second.lang) return { language: second.lang, confidence: 0.5 };
    if (hint === top.lang) return { language: top.lang, confidence: 0.6 };
    return { language: top.lang, confidence: 0.4 };
  }

  // Confidence scales with the margin, capped: this is a heuristic and should
  // never claim the certainty of a script-range match.
  const margin = second ? top.score - second.score : top.score;
  const confidence = Math.min(0.9, 0.5 + margin * 20);
  return { language: top.lang, confidence: Number(confidence.toFixed(2)) };
}

/** Language tags accepted by the `kb_*` schema's regex. */
export function normalizeLanguageTag(tag: string | null | undefined): string {
  if (!tag) return 'und';
  const t = tag.trim().toLowerCase();
  if (t === 'und' || t === '') return 'und';
  const m = /^([a-z]{2})(?:[-_]([a-z]{2,4}))?/.exec(t);
  if (!m) return 'und';
  return m[2] ? `${m[1]}-${m[2].toUpperCase()}` : m[1];
}
