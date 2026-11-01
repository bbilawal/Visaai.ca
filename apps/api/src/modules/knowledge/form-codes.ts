/**
 * Official form and artifact codes: 'IMM 5257', 'DS-160', 'I-129', 'VAF1A'.
 *
 * WHY THESE NEED SPECIAL HANDLING
 *
 * They are the highest-precision query a user ever issues — "what is IMM 5257"
 * has exactly one right answer — and they are the query type dense retrieval is
 * worst at. An embedding of "IMM 5257" sits close to "IMM 5707", "IMM 5645"
 * and every other Canadian form, because to an embedding model they are the
 * same token shape with a different number. Cosine similarity cannot separate
 * them; exact matching can.
 *
 * So codes are extracted at chunk time into `kb_chunks.form_codes`, which
 * makes an exact-code query a GIN index lookup rather than a similarity
 * search. Retrieval detects a code in the user's question and switches
 * strategy, rather than hoping the vector arm gets it right.
 *
 * NORMALISATION is the other half. A page writes "IMM 5257 (07-2023)", a user
 * types "imm5257", a caseworker writes "IMM-5257". All three must match, and
 * the version suffix must NOT become part of the identity — otherwise the
 * user's query for the form never matches the page that carries this year's
 * edition of it.
 */

/**
 * Patterns per issuing authority. Anchored on the authority's actual prefix
 * rather than a generic `[A-Z]{1,4}[- ]?\d{2,5}`, which matches road numbers,
 * postal codes, statute references, phone extensions and — memorably — the
 * "COVID-19" in every temporary-measures page.
 */
const FORM_PATTERNS: Array<{ re: RegExp; authority: string }> = [
  // Canada — IRCC
  { authority: 'CA', re: /\bIMM[\s-]?(\d{4}[A-Z]?)\b/gi },
  // United States — DoS and USCIS
  { authority: 'US', re: /\bDS[\s-]?(\d{2,4}[A-Z]?)\b/gi },
  { authority: 'US', re: /\bI[\s-](\d{2,4}[A-Z]?)\b/g },
  { authority: 'US', re: /\bN[\s-](\d{3,4}[A-Z]?)\b/g },
  { authority: 'US', re: /\bG[\s-](\d{3,4}[A-Z]?)\b/g },
  { authority: 'US', re: /\bEOIR[\s-]?(\d{2,3})\b/gi },
  // United Kingdom — Home Office
  { authority: 'GB', re: /\bVAF[\s-]?(\d{1,2}[A-Z]?)\b/gi },
  { authority: 'GB', re: /\bFLR\s*\(([A-Z]{1,3})\)/gi },
  { authority: 'GB', re: /\bSET\s*\(([A-Z]{1,3})\)/gi },
  { authority: 'GB', re: /\bBRP\b/g },
  // Australia — Home Affairs. Case-insensitive: a user types "form 918" and a
  // page writes "Form 918". Also matches the USCIS "Form 918, Supplement A"
  // style, which is the same shape.
  { authority: 'AU', re: /\bForm\s+(\d{2,4}[a-z]?)\b/gi },
  { authority: 'AU', re: /\bsubclass\s+(\d{3})\b/gi },
  // New Zealand — INZ
  { authority: 'NZ', re: /\bINZ[\s-]?(\d{3,4}[A-Z]?)\b/gi },
  // Schengen / EU
  { authority: 'EU', re: /\b(EU)\s*Blue\s*Card\b/gi },
  // India. The negative lookahead is load-bearing: without it this pattern
  // matches the "Form I" of "Form I-551" — a US form referenced on Canadian
  // pages — and files a spurious code "FORM I" on every chunk that mentions
  // one. Observed on canada.ca's eTA exemption page.
  { authority: 'IN', re: /\bForm\s+([IVX]{1,5})\b(?![-\s]?\d)/g },
  // Singapore — ICA
  { authority: 'SG', re: /\bICA[\s-]?Form[\s-]?(\d{1,3}[A-Z]?)\b/gi },
];

/** Visa/permit class codes that behave like form codes for search purposes. */
const CLASS_PATTERNS: RegExp[] = [
  /\b([BFHJLMOPQR])-?([12])\/?([BFHJLMOPQR])?-?([12])?\b(?=\s*(?:visa|status|classification|nonimmigrant))/gi,
  // The separator is `[-\s]?`, not `-?`.
  //
  // ROUND-TRIP INVARIANT: `detectQueryFormCodes(canonicalizeFormCode(x))` must
  // return that same canonical code. Canonicalisation turns "O-1A" into
  // "O 1A", so a pattern that only accepts a hyphen cannot re-detect the form
  // it just produced — and a user who types the code the way this system
  // DISPLAYS it gets no exact match. Asserted as a property test over every
  // code the corpus contains.
  /\b(H[-\s]?1B1?|H[-\s]?2A|H[-\s]?2B|L[-\s]?1[AB]?|O[-\s]?1[AB]?|E[-\s]?[123]|EB[-\s]?[1-5]|TN|K[-\s]?[1-4]|V[-\s]?[123])\b/g,
];

export interface FormCodeHit {
  /** Canonical form: uppercase, single space, no version suffix. */
  code: string;
  authority: string;
  raw: string;
}

/**
 * Canonical form of a code as stored and as searched.
 *
 * `IMM 5257 (07-2023)` -> `IMM 5257`
 * `imm-5257`           -> `IMM 5257`
 * `ds160`              -> `DS 160`
 */
export function canonicalizeFormCode(raw: string): string {
  return (
    raw
      .toUpperCase()
      // Drop an edition/version suffix in brackets: it is not part of identity.
      .replace(/\s*\((?:\d{2}[-/]\d{4}|REV\.?[^)]*|\d{4})\)\s*$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/([A-Z]+)\s*(\d)/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Extract every official code a chunk mentions. */
export function extractFormCodes(text: string): FormCodeHit[] {
  const seen = new Map<string, FormCodeHit>();

  for (const { re, authority } of FORM_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const code = canonicalizeFormCode(m[0]);
      if (!code || code.length > 32) continue;
      if (!seen.has(code)) seen.set(code, { code, authority, raw: m[0] });
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  for (const re of CLASS_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const code = canonicalizeFormCode(m[0]);
      if (!code || code.length > 32) continue;
      if (!seen.has(code))
        seen.set(code, { code, authority: 'class', raw: m[0] });
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  return [...seen.values()];
}

/**
 * Does a user's question name a specific form?
 *
 * Used by retrieval to switch to exact-code strategy. Returns canonical codes
 * so the caller can filter `kb_chunks.form_codes` directly.
 *
 * A QUERY IS MATCHED MORE LENIENTLY THAN A DOCUMENT, and the asymmetry is
 * deliberate rather than an oversight.
 *
 * Several patterns here are single-letter-prefixed — `I 129`, `N 400`,
 * `G 1145`. Matching those case-insensitively inside a document would fire on
 * ordinary prose ("see figure i 3", "under section i 5"), so extraction stays
 * case-sensitive. But a QUERY is a short string a person typed, where "what is
 * i-129" is exactly what someone writes, and treating it as no-match sends
 * them to the semantic arm — which cannot separate I-129 from I-130.
 *
 * So the query is scanned twice, raw and uppercased, and the results are
 * unioned. Uppercasing alone is not enough: the `Form IV` Roman-numeral
 * pattern needs the mixed-case literal.
 */
export function detectQueryFormCodes(query: string): string[] {
  // A query that mentions a form code is almost never asking about something
  // else as well, so all detected codes are returned and OR-ed by the caller.
  const codes = new Set<string>();
  for (const hit of extractFormCodes(query)) codes.add(hit.code);
  for (const hit of extractFormCodes(query.toUpperCase())) codes.add(hit.code);
  return [...codes];
}
