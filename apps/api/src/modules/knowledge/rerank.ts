/**
 * Reranking, as a deterministic feature function rather than a cross-encoder.
 *
 * WHY NOT A MODEL. A cross-encoder reranker is the standard answer and it is
 * genuinely better at semantic relevance. Three reasons it is the wrong first
 * move here, in order of weight:
 *
 *   1. The signals that matter most in this corpus are not semantic. Whether a
 *      passage is the visa type the user asked about, whether it is a
 *      checklist or a nav crumb, whether it names the form the user typed —
 *      these are known exactly from metadata. A model would be asked to
 *      re-derive from text what the schema already states.
 *   2. It is another inference call on the request path, and this path already
 *      has one (the embedding). Retrieval p95 has a budget.
 *   3. It cannot be tested. Every rule below is asserted in a unit test with a
 *      fixed input and a fixed expected order; a model's ranking is asserted
 *      only statistically, and the failure mode being defended against —
 *      another country's rule ranking first — needs a hard guarantee, not a
 *      probability.
 *
 * The fusion score from SQL is the base. These are multiplicative adjustments
 * on top, all bounded, so no single signal can invert a large relevance gap.
 * A reranker that can promote an irrelevant passage because it is a checklist
 * has stopped being a reranker.
 */
import type { RetrievedChunk } from './knowledge-retrieval.service';

export interface RerankSignal {
  query: string;
  formCodes: string[];
  visaTypeId?: string;
  preferredLanguages?: string[];
  nationality?: string;
  /** Chunks the form-code arm matched exactly. These never move down. */
  pinnedChunkIds?: Set<string>;
}

/** Multipliers. Each is small; the product is what orders near-ties. */
const WEIGHTS = {
  /** The chunk is scoped to the exact visa type asked about. */
  exactVisaType: 1.25,
  /** Country-level content (applies to every route) when a route was asked. */
  countryLevelForRoute: 1.02,
  /** A checklist or table is usually the direct answer to a document question. */
  checklist: 1.12,
  table: 1.08,
  /** Navigation and page furniture that survived stripping. */
  metadata: 0.7,
  /** Exact form-code match on a query that named one. */
  formCodeExact: 1.4,
  /** The chunk is in a language the user reads. */
  languageMatch: 1.06,
  /** Superseded content, when the caller explicitly asked to include it. */
  superseded: 0.55,
  /** The user's nationality appears in the chunk — nationality-scoped rules. */
  nationalityMention: 1.1,
  /** Heading path repeats a query term: the section is about the question. */
  headingTermMatch: 1.15,
  /** OCR-derived or otherwise low-confidence extraction. */
  lowConfidence: 0.85,
} as const;

/** Words too common in this corpus to signal anything when matched. */
const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'for',
  'in',
  'on',
  'is',
  'are',
  'do',
  'does',
  'i',
  'my',
  'you',
  'your',
  'what',
  'which',
  'how',
  'can',
  'need',
  'visa',
  'apply',
  'application',
  'requirements',
  'requirement',
  'documents',
]);

export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function rerank(
  chunks: RetrievedChunk[],
  signal: RerankSignal,
): RetrievedChunk[] {
  const terms = queryTerms(signal.query);
  const wantedCodes = new Set(signal.formCodes);
  const languages = new Set(signal.preferredLanguages ?? []);

  const scored = chunks.map((chunk) => {
    let multiplier = 1;

    if (signal.visaTypeId) {
      if (chunk.visaTypeId === signal.visaTypeId)
        multiplier *= WEIGHTS.exactVisaType;
      else if (chunk.visaTypeId === null)
        multiplier *= WEIGHTS.countryLevelForRoute;
    }

    if (
      wantedCodes.size > 0 &&
      chunk.formCodes.some((c) => wantedCodes.has(c))
    ) {
      multiplier *= WEIGHTS.formCodeExact;
    }

    if (languages.size > 0 && languages.has(chunk.language)) {
      multiplier *= WEIGHTS.languageMatch;
    }

    if (chunk.status === 'superseded' || chunk.status === 'withdrawn') {
      multiplier *= WEIGHTS.superseded;
    }

    // Heading match is weighted above body match because a heading is the
    // authority's own statement of what the section is about.
    const headingText = chunk.headingPath.join(' ').toLowerCase();
    if (terms.length > 0 && terms.some((t) => headingText.includes(t))) {
      multiplier *= WEIGHTS.headingTermMatch;
    }

    if (
      signal.nationality &&
      mentionsNationality(chunk.text, signal.nationality)
    ) {
      multiplier *= WEIGHTS.nationalityMention;
    }

    // Structure signals come from the section kind recorded at chunk time.
    const kind = inferKind(chunk);
    if (kind === 'checklist') multiplier *= WEIGHTS.checklist;
    else if (kind === 'table') multiplier *= WEIGHTS.table;
    else if (kind === 'metadata') multiplier *= WEIGHTS.metadata;

    return { chunk, score: chunk.score * multiplier };
  });

  // Pinned chunks keep their relative order and sit above everything else.
  // A user who typed a form number gets that form's page first, whatever the
  // semantic scores say.
  const pinned = signal.pinnedChunkIds ?? new Set<string>();
  scored.sort((a, b) => {
    const ap = pinned.has(a.chunk.chunkId) ? 1 : 0;
    const bp = pinned.has(b.chunk.chunkId) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break, so two runs of the same query return the same
    // order and a benchmark is reproducible.
    if (a.chunk.authorityRank !== b.chunk.authorityRank) {
      return a.chunk.authorityRank - b.chunk.authorityRank;
    }
    return a.chunk.chunkId.localeCompare(b.chunk.chunkId);
  });

  return scored.map((s) => {
    s.chunk.score = Number(s.score.toFixed(6));
    return s.chunk;
  });
}

/**
 * Recover the section kind from what retrieval returns.
 *
 * `kb_chunks.section_kind` is on the row but the SQL function does not project
 * it — adding a column to the function's return type is a migration, and the
 * same signal is recoverable from the text shape. A chunk of `key: value |`
 * lines is a table; a chunk of bullets under a documents heading is a
 * checklist.
 */
export function inferKind(
  chunk: RetrievedChunk,
): 'checklist' | 'table' | 'list' | 'metadata' | 'prose' {
  const text = chunk.text;
  const lines = text.split('\n').filter(Boolean);

  if (
    lines.length >= 2 &&
    lines.filter((l) => l.includes(' | ')).length >= lines.length * 0.6
  ) {
    return 'table';
  }
  const bullets = lines.filter((l) => l.trimStart().startsWith('•')).length;
  if (bullets >= 2) {
    const heading = chunk.headingPath.join(' ').toLowerCase();
    return /(document|checklist|what you (need|must)|required|supporting|evidence|provide|submit)/.test(
      heading,
    )
      ? 'checklist'
      : 'list';
  }
  // Very short chunks with no sentence are page furniture.
  if (text.length < 80 && !/[.!?]/.test(text)) return 'metadata';
  return 'prose';
}

/**
 * Does the chunk name the applicant's nationality?
 *
 * Matches the ISO code as a standalone token and the country name. Bounded to
 * the codes actually used for nationality-scoped rules; a broader match on any
 * two-letter uppercase token would fire on every "EU", "UK" and "US" in the
 * corpus and stop discriminating.
 */
export function mentionsNationality(
  text: string,
  nationality: string,
): boolean {
  const code = nationality.trim().toUpperCase();
  if (code.length !== 2) return false;
  const name = COUNTRY_NAMES[code];
  if (name && new RegExp(`\\b${name}\\b`, 'i').test(text)) return true;
  return new RegExp(`\\b${code}\\b`).test(text);
}

/**
 * Names for the nationalities that most often carry a distinct rule (visa
 * nationals, biometric exemptions, reciprocity schedules). Not a full ISO
 * table: this is a ranking signal, and a missing entry degrades to the
 * code-only match rather than to a wrong result.
 */
const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India',
  PK: 'Pakistan',
  BD: 'Bangladesh',
  NG: 'Nigeria',
  PH: 'Philippines',
  CN: 'China',
  VN: 'Vietnam',
  ID: 'Indonesia',
  LK: 'Sri Lanka',
  NP: 'Nepal',
  EG: 'Egypt',
  MA: 'Morocco',
  DZ: 'Algeria',
  TN: 'Tunisia',
  TR: 'Türkiye',
  IR: 'Iran',
  IQ: 'Iraq',
  SY: 'Syria',
  AF: 'Afghanistan',
  SO: 'Somalia',
  RU: 'Russia',
  UA: 'Ukraine',
  BR: 'Brazil',
  MX: 'Mexico',
  CO: 'Colombia',
  ZA: 'South Africa',
  KE: 'Kenya',
  GH: 'Ghana',
  ET: 'Ethiopia',
  SD: 'Sudan',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  JP: 'Japan',
  KR: 'South Korea',
  SG: 'Singapore',
  MY: 'Malaysia',
  TH: 'Thailand',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
};
