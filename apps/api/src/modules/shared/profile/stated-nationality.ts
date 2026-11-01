import { nationalityCode } from '@visaai/types';

/**
 * The applicant's OWN nationality, when they state it in so many words.
 *
 * Nationality decides which route an applicant may use (Canada's eTA vs a
 * visitor visa), and the model extraction is allowed to miss it: prod
 * 2026-10-16, app 5d3a17a4, "I am a citizen of Pakistan with a Pakistani
 * passport only." produced a profile without any nationality, and the eTA
 * gate then accepted a route that passport cannot use.
 *
 * This is a deliberately narrow fallback, not a parser. It only reads
 * first-person statements ("I am a citizen of X", "I'm an X national",
 * "I hold an X passport", "my passport is from X", "my nationality is X"), so
 * "my son, a Canadian citizen" never becomes the applicant's citizenship. A
 * country it cannot recognise (via `nationalityCode`) yields nothing.
 */
export interface StatedNationality {
  nationality: string;
  passport_country?: string;
}

// Up to four words after the cue; the longest prefix that names a country wins
// ("the united states of america" before "the united").
const WORDS = "((?:[a-z][a-z.'-]*)(?:\\s+[a-z][a-z.'-]*){0,4})";
const ME = "(?:i\\s+am|i'm|im)";

const NATIONALITY_CUES: RegExp[] = [
  new RegExp(
    `\\b${ME}\\s+(?:a\\s+|an\\s+)?(?:citizen|national)\\s+of\\s+(?:the\\s+)?${WORDS}`,
    'i',
  ),
  new RegExp(
    `\\bmy\\s+(?:nationality|citizenship)\\s+is\\s+(?:the\\s+)?${WORDS}`,
    'i',
  ),
];
// The demonym comes BEFORE the noun here, so the capture ends at the noun.
const NATIONALITY_BEFORE: RegExp[] = [
  new RegExp(
    `\\b${ME}\\s+(?:a\\s+|an\\s+)?${WORDS}\\s+(?:citizen|national)\\b(?!['’]s)`,
    'i',
  ),
];
const PASSPORT_CUES: RegExp[] = [
  new RegExp(
    `\\bmy\\s+passport\\s+is\\s+(?:from\\s+|issued\\s+(?:by|in)\\s+)?(?:the\\s+)?${WORDS}`,
    'i',
  ),
];
const PASSPORT_BEFORE: RegExp[] = [
  new RegExp(
    `\\bi\\s+(?:have|hold|carry|own|travel\\s+on|use)\\s+(?:a\\s+|an\\s+|my\\s+)?(?:valid\\s+)?${WORDS}\\s+passport\\b`,
    'i',
  ),
  new RegExp(`\\bmy\\s+(?:only\\s+)?${WORDS}\\s+passport\\b`, 'i'),
];

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * `candidate` as a country name. `nationalityCode` accepts ANY two letters as an
 * ISO code, so a short lowercase word ("in", "an", "us") must not count — only
 * a written-out name/demonym or a code the applicant typed in capitals ("UK").
 */
function asCountry(candidate: string): string | null {
  const s = candidate.trim().replace(/[.,;:!?]+$/, '');
  if (s.length <= 3 && s !== s.toUpperCase()) return null;
  const code = nationalityCode(s);
  return code ? countryName(code) : null;
}

/** Longest leading run of `words` that names a country, as its English name. */
function leadingCountry(words: string): string | null {
  const parts = words.trim().split(/\s+/);
  for (let n = parts.length; n >= 1; n -= 1) {
    const hit = asCountry(parts.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return null;
}

/**
 * `words` as a whole naming a country. Used where the cue FOLLOWS the words
 * ("… Pakistani citizen"), so "I am visiting a Canadian citizen" — where the
 * words are "visiting a Canadian" — is not read as the applicant's own.
 */
function wholeCountry(words: string): string | null {
  return asCountry(words);
}

function firstMatch(
  text: string,
  leading: RegExp[],
  trailing: RegExp[],
): string | null {
  for (const re of leading) {
    const m = re.exec(text);
    const hit = m && leadingCountry(m[1]);
    if (hit) return hit;
  }
  for (const re of trailing) {
    const m = re.exec(text);
    const hit = m && wholeCountry(m[1]);
    if (hit) return hit;
  }
  return null;
}

/**
 * "with a Pakistani passport" counts only when it qualifies the applicant's own
 * citizenship statement in the same sentence ("I am a citizen of X with a Y
 * passport") — elsewhere it may describe anyone.
 */
function passportAfterOwnCitizenship(text: string): string | null {
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    if (!firstMatch(sentence, NATIONALITY_CUES, NATIONALITY_BEFORE)) continue;
    const m = new RegExp(
      `\\bwith\\s+(?:a\\s+|an\\s+)?(?:valid\\s+)?${WORDS}\\s+passport\\b`,
      'i',
    ).exec(sentence);
    const hit = m && wholeCountry(m[1]);
    if (hit) return hit;
  }
  return null;
}

export function statedNationality(text: string): StatedNationality | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const nationality = firstMatch(text, NATIONALITY_CUES, NATIONALITY_BEFORE);
  const passport =
    firstMatch(text, PASSPORT_CUES, PASSPORT_BEFORE) ??
    passportAfterOwnCitizenship(text);
  const resolved = nationality ?? passport;
  if (!resolved) return null;
  return passport
    ? { nationality: resolved, passport_country: passport }
    : { nationality: resolved };
}
