/**
 * The rules an answer must satisfy before it can be shown to anyone.
 *
 * Pure, and separate from the service that calls the model, because these are
 * the assertions that matter and they must be testable without one. Every rule
 * below corresponds to a specific way this system could tell someone something
 * false about their immigration case.
 *
 * THE CENTRAL RULE: a claim with no citation is dropped, not softened.
 *
 * The tempting alternative — keep the claim and mark it "unverified" — is
 * worse than it sounds. A person reading a visa answer does not calibrate on a
 * hedge; they read the sentence. An uncited sentence about a fee is a fee they
 * will budget for. So an uncited claim never ships, and if that leaves nothing,
 * the answer is "the official sources do not say", which is true and useful.
 */

export interface Claim {
  index: number;
  text: string;
  /** Chunk ids the generator said support this claim. */
  citedChunkIds: string[];
  /** The exact span quoted from the chunk, when the generator produced one. */
  supportingQuote?: string;
  /** Whether the claim is stated as a requirement or as a suggestion. */
  modality: 'mandatory' | 'recommended' | 'informational';
}

export interface GroundingEvidence {
  chunkId: string;
  text: string;
  countryId: string;
  visaTypeId: string | null;
  status: string;
  authorityRank: number;
}

export interface GroundingVerdict {
  /** Claims that survived every check. */
  accepted: Claim[];
  /** Claims dropped, and why, for the log and the admin surface. */
  rejected: Array<{ claim: Claim; reason: string }>;
  /** True when nothing survived and the caller must refuse rather than answer. */
  mustRefuse: boolean;
  warnings: string[];
}

/**
 * Minimum fraction of a quoted span that must actually appear in the cited
 * chunk. Not 1.0: a generator legitimately normalises whitespace and drops a
 * trailing bracket. Not 0.5 either — that would accept a paraphrase, and a
 * paraphrase of a legal requirement is a new claim.
 */
const QUOTE_MATCH_THRESHOLD = 0.85;

/**
 * Phrases a visa answer must never contain, whatever the evidence says.
 *
 * These are not style preferences. VisaAI's compliance position — stated
 * platform-wide, not per feature — is that it never guarantees an outcome and
 * never gives legal advice. A model that has read a consulate page saying
 * "applicants meeting these criteria are approved" can reproduce that as a
 * guarantee in VisaAI's voice, which converts a government's general statement
 * into our specific promise.
 */
const PROHIBITED_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    label: 'approval-guarantee',
    re: /\b(guarantee[sd]?|guaranteed|assured?|certain(ly)?|definitely)\b[^.]{0,40}\b(approv\w+|grant\w+|success\w*|accept\w+)\b/i,
  },
  {
    label: 'approval-guarantee',
    re: /\byou\s+will\s+(be\s+)?(approved|granted|get\s+(the\s+)?visa|succeed)\b/i,
  },
  {
    label: 'approval-prediction',
    re: /\byour\s+(application|visa)\s+will\s+(be\s+)?(approved|accepted|granted)\b/i,
  },
  {
    label: 'legal-advice',
    re: /\b(I|we)\s+(advise|recommend)\s+you\s+to\s+(sue|litigate|appeal\s+on\s+the\s+grounds)\b/i,
  },
  {
    label: 'outcome-probability',
    re: /\b\d{1,3}\s*%\s*(chance|likelihood|probability)\s+of\s+(approval|success|being\s+approved)\b/i,
  },
];

/** Split an answer into sentence-level claims. */
export function splitClaims(answer: string): string[] {
  return answer
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z(•])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Normalise for quote comparison: case, whitespace, quotes, dashes. */
export function normalizeForQuoteMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does the quote actually appear in the chunk?
 *
 * Word-level containment rather than substring, so a quote that differs only
 * in punctuation still matches, and a quote that reorders or invents words
 * does not. The failure this catches is the important one: a model that
 * fabricates a plausible "quotation" from a real source.
 */
export function quoteIsSupported(quote: string, chunkText: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  const c = normalizeForQuoteMatch(chunkText);
  if (!q) return false;
  if (c.includes(q)) return true;

  const qWords = q.split(' ').filter((w) => w.length > 1);
  if (qWords.length === 0) return false;
  // Contiguity matters: check the longest run of quote words that appears in
  // order in the chunk, not a bag-of-words overlap.
  let matched = 0;
  let cursor = 0;
  for (const word of qWords) {
    const at = c.indexOf(word, cursor);
    if (at >= 0) {
      matched++;
      cursor = at + word.length;
    }
  }
  return matched / qWords.length >= QUOTE_MATCH_THRESHOLD;
}

/**
 * Apply every grounding rule.
 *
 * @param expectedCountryId the jurisdiction the question was scoped to. Any
 *        claim citing evidence from a different country is dropped — that is
 *        the cross-jurisdiction leak, caught at the last possible moment even
 *        though retrieval already filtered for it, because two independent
 *        checks is what "must never happen" deserves.
 */
export function verifyGrounding(
  claims: Claim[],
  evidence: GroundingEvidence[],
  opts: {
    expectedCountryId?: string;
    expectedVisaTypeId?: string;
    allowSuperseded?: boolean;
  } = {},
): GroundingVerdict {
  const byId = new Map(evidence.map((e) => [e.chunkId, e]));
  const accepted: Claim[] = [];
  const rejected: Array<{ claim: Claim; reason: string }> = [];
  const warnings: string[] = [];

  for (const claim of claims) {
    const prohibited = PROHIBITED_PATTERNS.find((p) => p.re.test(claim.text));
    if (prohibited) {
      rejected.push({
        claim,
        reason: `prohibited claim (${prohibited.label})`,
      });
      continue;
    }

    if (claim.citedChunkIds.length === 0) {
      rejected.push({ claim, reason: 'no citation' });
      continue;
    }

    const cited = claim.citedChunkIds
      .map((id) => byId.get(id))
      .filter(Boolean) as GroundingEvidence[];
    if (cited.length === 0) {
      // A citation naming a chunk that was not retrieved is a fabricated
      // citation, which is strictly worse than no citation: it looks checkable.
      rejected.push({
        claim,
        reason: 'citation refers to evidence that was not retrieved',
      });
      continue;
    }

    const wrongCountry = opts.expectedCountryId
      ? cited.filter((e) => e.countryId !== opts.expectedCountryId)
      : [];
    if (wrongCountry.length > 0) {
      rejected.push({
        claim,
        reason: `citation is from another jurisdiction (${wrongCountry.length} of ${cited.length})`,
      });
      continue;
    }

    if (
      opts.expectedVisaTypeId &&
      cited.every(
        (e) =>
          e.visaTypeId !== null && e.visaTypeId !== opts.expectedVisaTypeId,
      )
    ) {
      rejected.push({
        claim,
        reason: 'citation is scoped to a different visa type',
      });
      continue;
    }

    if (!opts.allowSuperseded) {
      const stale = cited.filter((e) => e.status !== 'current');
      if (stale.length === cited.length) {
        rejected.push({
          claim,
          reason: 'every citation is superseded content',
        });
        continue;
      }
      if (stale.length > 0) {
        warnings.push(
          `claim ${claim.index} cites ${stale.length} superseded passage(s) alongside current ones`,
        );
      }
    }

    if (claim.supportingQuote) {
      const supported = cited.some((e) =>
        quoteIsSupported(claim.supportingQuote!, e.text),
      );
      if (!supported) {
        rejected.push({
          claim,
          reason: 'quoted text does not appear in the cited source',
        });
        continue;
      }
    } else if (claim.modality === 'mandatory') {
      // A mandatory claim is the one a person acts on. It needs a verbatim
      // span, not a gesture at a chunk.
      rejected.push({
        claim,
        reason: 'mandatory claim carries no supporting quote',
      });
      continue;
    }

    accepted.push(claim);
  }

  return {
    accepted,
    rejected,
    mustRefuse: accepted.length === 0,
    warnings,
  };
}

/**
 * The refusal.
 *
 * Deliberately concrete: it names the jurisdiction, says what was not found,
 * and points at the authority's own page. A refusal that says only "I don't
 * know" leaves a person with nothing, and they will go and ask somewhere with
 * no citations at all.
 */
export function buildRefusal(input: {
  question: string;
  countryName?: string;
  visaTypeName?: string;
  officialUrl?: string;
  authority?: string;
  reason:
    | 'no_evidence'
    | 'insufficient_evidence'
    | 'conflicting'
    | 'stale_only';
}): string {
  const scope = [input.visaTypeName, input.countryName]
    .filter(Boolean)
    .join(', ');
  const where = scope ? ` for ${scope}` : '';

  const lead =
    input.reason === 'conflicting'
      ? `The official sources${where} currently disagree on this, so VisaAI will not choose between them.`
      : input.reason === 'stale_only'
        ? `The only official text VisaAI holds on this${where} is from a superseded version of the page, so it may no longer be current.`
        : `VisaAI could not find current official guidance on this${where}.`;

  const pointer = input.officialUrl
    ? ` Check ${input.authority ? `${input.authority}'s ` : "the authority's "}official page: ${input.officialUrl}`
    : " Check the issuing authority's official page.";

  return (
    `${lead}${pointer}` +
    ' Requirements change without notice and the authority makes the final decision on every application.'
  );
}

/** The disclaimer every generated answer carries. */
export const ANSWER_DISCLAIMER =
  'Requirements can change without notice. This is a summary of official published guidance, ' +
  'not legal advice, and the issuing authority makes the final decision on every application.';
