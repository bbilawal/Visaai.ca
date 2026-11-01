import { ChatOpenAI } from '@langchain/openai';
import {
  offeredGenTypesForRoute,
  ROUTE_LETTERS,
  type LetterType,
} from '@visaai/types';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { VriState, VriRecommendation } from '../vri.state';
import { documentEvidence, refusalFacts } from '../scoring/evidence';
import { languageDirective } from '../../../../i18n/language';
import {
  DEFAULT_RISK_WEIGHTS,
  DEFAULT_THRESHOLDS,
  routeRiskWeights,
} from '../../risk-config.types';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';

const FACTOR_LABELS: Record<string, string> = {
  documentation_pct: 'Documentation Completeness',
  financial_pct: 'Financial Sufficiency',
  travel_history_pct: 'Travel History',
  home_ties_pct: 'Home Country Ties',
  employment_pct: 'Employment Strength',
  consistency_pct: 'Application Consistency',
};

const REC_PROMPT = `You are a visa application advisor. For each weak factor in a visa application,
provide ONE specific, actionable recommendation to strengthen it.
Return ONLY a JSON array of objects with keys: factor (the factor key), issue (one sentence describing the weakness), recommendation_text (2-3 sentences of concrete advice).
Each weak factor comes with the EVIDENCE the scorer actually found (what was read from documents, what was declared, what could not be read). Ground every recommendation in that evidence — name the specific document or fact to fix.
If a previous refusal is listed, the recommendation must directly answer the grounds the officer gave in that refusal.
Be specific to immigration applications. Do not invent facts about the applicant.
NEVER assert why a value differs or script a factual explanation for the applicant. You cannot know the cause of a discrepancy (it may be a typo, an outdated document, or a document that belongs to someone else). Do not say or suggest that differences "were data-entry errors", typos, clerical or honest mistakes, and do not tell the applicant what to state or confirm about the cause. Instead: tell them to check which value is correct, fix the answer or upload the right document, and, if the difference is real, explain it truthfully. Give no legal advice and make no prediction about approval.

${UNTRUSTED_DATA_DIRECTIVE}`;

// The letters the applicant writes. The itinerary is a generated document too,
// but recommending one is not the defect this guards against.
const LETTER_NAMES: Partial<Record<LetterType, string>> = {
  loe: 'letter of explanation',
  cover_letter: 'cover letter',
  invitation_letter: 'letter of invitation',
};

/**
 * Which generated letters this route uses. A route that offers none
 * (spousal sponsorship, Express Entry, eTA) must not be told to write one —
 * live prod 2026-10-20: a spousal sponsorship applicant was told to "include a
 * short letter of explanation" the route has nowhere to put.
 */
function lettersDirective(offered: readonly LetterType[]): string {
  const notOffered = (Object.keys(LETTER_NAMES) as LetterType[]).filter(
    (t) => !offered.includes(t),
  );
  if (notOffered.length === 0) return '';
  const offeredLetters = offered.filter((t) => LETTER_NAMES[t]);
  const allowed = offeredLetters.length
    ? `The only letters the applicant writes on this application route are: ${offeredLetters.map((t) => LETTER_NAMES[t]).join(', ')}.`
    : 'The applicant writes NO letters on this application route.';
  const banned =
    notOffered.map((t) => LETTER_NAMES[t]).join(', ') +
    (offeredLetters.length === 0
      ? ', or any other letter or written statement of their own'
      : '');
  return `\n\nLETTERS: ${allowed} Never recommend writing, including or attaching a ${banned}. Point the applicant to correcting their answers or uploading the right document instead.`;
}

/**
 * The letters a route offers, but ONLY when the route has an explicit
 * ROUTE_LETTERS entry; `null` otherwise. A route without an entry (plain TRV,
 * every non-Canada route) gets the default Generate set from
 * `offeredGenTypesForRoute`, which leaves out the invitation letter — yet on a
 * TRV the host's invitation letter is ordinary third-party evidence. So letters
 * are only ever banned on a route that explicitly says what it offers.
 * Mirrors the match in route-letters.ts `entryFor`.
 */
export function explicitRouteLetters(
  country: string | null | undefined,
  visaaiId: string | null | undefined,
): LetterType[] | null {
  const c = country?.trim().toUpperCase() ?? '';
  const id = visaaiId?.trim() ?? '';
  if (!id) return null;
  const hasEntry = ROUTE_LETTERS.some(
    (r) => (!c || r.country === c) && r.visaaiIds.includes(id),
  );
  return hasEntry ? offeredGenTypesForRoute({ country: c, visaaiId: id }) : null;
}

/**
 * @param offeredLetters the route's explicit letters
 *   (`explicitRouteLetters`). Omitted/null = no letters directive at all.
 */
export function buildRecSystemPrompt(
  language?: string | null,
  offeredLetters?: readonly LetterType[] | null,
): string {
  return (
    REC_PROMPT +
    (offeredLetters ? lettersDirective(offeredLetters) : '') +
    languageDirective(language)
  );
}

// ── Deterministic post-filter ────────────────────────────────────────────
// The prompt rules are the first line; this is the backstop for a model that
// ignores them. It removes clauses (not whole recommendations) so the rest of
// the advice — "upload a clear copy of the passport page" — survives.
//
// ENGLISH ONLY: every pattern below is English. The node skips the filter when
// recommendations are generated in another language (it would match nothing,
// or worse, mangle sentences on English-looking punctuation); for those, the
// prompt rules are the only guard.

// Only the letters the APPLICANT writes. An itinerary, or third-party evidence
// such as an employment letter, is a document to upload and is left alone.
const LETTER_PATTERNS: Partial<Record<LetterType, RegExp>> = {
  loe: /\b(letters?\s+of\s+explanation|explanation\s+letters?|explanatory\s+(letter|statement|note)s?|LOEs?|written\s+explanations?|(letter|statement)\s+(explaining|that\s+explains))\b/i,
  cover_letter: /\bcover(ing)?\s+letters?\b/i,
  invitation_letter: /\b(letters?\s+of\s+invitation|invitation\s+letters?)\b/i,
};

/** Phrasing that asserts the cause of a discrepancy or scripts an explanation. */
// A bare "typo" or "minor error" is fine ("Fix the typo in your name"); only
// a claim about what CAUSED a difference is stripped.
const CAUSE_PATTERNS: RegExp[] = [
  /\b(data[-\s]?entry|typographical|clerical|inadvertent|honest|innocent)\s+(errors?|mistakes?|slips?|oversights?)\b/i,
  /\b(was|were|is|are|been)\s+(just\s+|simply\s+|only\s+|merely\s+)?(an?\s+)?typos?\b/i,
  /\b(due\s+to|caused\s+by|because\s+of|result\s+of)\s+(an?\s+|the\s+)?typos?\b/i,
  /\btypos?\s+(caused|explains?|explained)\b/i,
  /\b(state|stating|states|explain|explaining|explains|confirm|confirming|confirms|declare|declaring|declares|say|saying|says|note|noting|clarify|clarifying)\s+that\s+(the\s+|these\s+|those\s+|this\s+|any\s+)?(discrepanc|difference|mismatch|inconsistenc|error|mistake)/i,
  /\b(discrepanc\w*|differences?|mismatch\w*|inconsistenc\w*)\s+(were|was|are|is)\s+(due\s+to|caused\s+by|the\s+result\s+of|(an?\s+|simply\s+|just\s+|only\s+)?(errors?|mistakes?))/i,
];

/** Truthful, cause-neutral replacement for a removed explanation script. */
export const NEUTRAL_DISCREPANCY_ADVICE =
  'Check which value is correct, fix it in your application, and if a difference is real, explain it truthfully.';
/** Fallback when everything left was a letter the route does not use. */
export const NO_LETTER_FALLBACK =
  'Correct the answers in your application so they match your documents exactly, and upload the right document.';

/** Neutral advice an LLM already gave in its own words. */
const HAS_NEUTRAL = /which\s+value\s+is\s+correct/i;
/** Fallback `issue` when the whole issue sentence asserted a cause. */
export const NEUTRAL_ISSUE =
  'Some details in your application do not match your documents.';

// Sentence boundary — but not after a common abbreviation ("Dr. Smith",
// "the U.S. visa", "e.g. a lease"), which would cut a sentence in two.
const SENTENCE_SPLIT =
  /(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms|St|No|vs|U\.S|U\.K|e\.g|i\.e)\.)\s+(?=[A-Z"“(])/;
/** Clause boundaries a model uses to chain extra instructions onto a sentence. */
const CLAUSE_SPLIT =
  /(,?\s+and\s+(?=(?:include|attach|provide|add|write|submit|enclose|state|stating|confirm|confirming|explain|explaining|declare|declaring|note|noting)\b)|,\s+(?=(?:confirming|stating|explaining|declaring|noting|clarifying|saying)\b)|;\s+)/i;

const DEPENDENT_CLAUSE =
  /^\s*(confirming|stating|explaining|declaring|noting|clarifying|saying|identifying)\b/i;

function letterHit(
  text: string,
  offered: readonly LetterType[] | null,
): boolean {
  // No explicit route entry: no letter is banned (see explicitRouteLetters).
  if (offered === null) return false;
  return (Object.keys(LETTER_PATTERNS) as LetterType[]).some(
    (t) => !offered.includes(t) && LETTER_PATTERNS[t]!.test(text),
  );
}
const causeHit = (text: string) => CAUSE_PATTERNS.some((re) => re.test(text));

/**
 * Strip advice the route cannot act on (a letter it does not use) and any
 * clause that asserts why a value differs. Returns the text unchanged when
 * nothing matched.
 */
export function sanitizeRecommendationText(
  text: string,
  offeredLetters: readonly LetterType[] | null,
  opts: { neutralAdvice?: boolean; fallback?: string } = {},
): string {
  const neutralAdvice = opts.neutralAdvice ?? true;
  const fallback = opts.fallback ?? NO_LETTER_FALLBACK;
  let removedCause = false;
  let removedLetter = false;
  const sentences = text
    .trim()
    .split(SENTENCE_SPLIT)
    .map((sentence) => {
      // With a capture group, split() alternates clause, separator, clause, …
      const parts = sentence.split(CLAUSE_SPLIT);
      const kept: string[] = [];
      let droppedLetterClause = false;
      for (let i = 0; i < parts.length; i += 2) {
        const clause = parts[i] ?? '';
        if (letterHit(clause, offeredLetters)) {
          removedLetter = droppedLetterClause = true;
          continue;
        }
        if (causeHit(clause)) {
          removedCause = true;
          continue;
        }
        // "…include a letter of explanation …, confirming that …": the
        // participle describes the dropped letter, so it goes with it.
        if (droppedLetterClause && DEPENDENT_CLAUSE.test(clause)) continue;
        if (kept.length > 0) kept.push(parts[i - 1] ?? ' ');
        kept.push(clause);
      }
      if (kept.length === 0) return '';
      let out = kept.join('').trim().replace(/[,;:\s]+$/, '');
      if (!/[.!?]["”)]?$/.test(out)) out += '.';
      return out.charAt(0).toUpperCase() + out.slice(1);
    })
    .filter((s) => s.length > 0);

  if (!removedCause && !removedLetter) return text;
  if (
    removedCause &&
    neutralAdvice &&
    !sentences.some((s) => HAS_NEUTRAL.test(s))
  ) {
    sentences.push(NEUTRAL_DISCREPANCY_ADVICE);
  }
  if (sentences.length === 0) sentences.push(fallback);
  return sentences.join(' ');
}

/**
 * `recommendation_text` loses unoffered letters and asserted causes;
 * `issue` (a description, not advice) loses asserted causes only.
 */
export function sanitizeRecommendations(
  recs: VriRecommendation[],
  offeredLetters: readonly LetterType[] | null,
): VriRecommendation[] {
  return recs.map((r) => ({
    ...r,
    issue: sanitizeRecommendationText(r.issue, null, {
      neutralAdvice: false,
      fallback: NEUTRAL_ISSUE,
    }),
    recommendation_text: sanitizeRecommendationText(
      r.recommendation_text,
      offeredLetters,
    ),
  }));
}

/** English output: no language, 'en', or 'en-*'. */
function isEnglish(language?: string | null): boolean {
  return !language || /^en(\b|[-_])/i.test(language.trim());
}

export function makeGenerateRecommendationsNode(
  llm: ChatOpenAI,
  language?: string | null,
  weakThreshold: number = DEFAULT_THRESHOLDS.weak_threshold,
) {
  return async function generateRecommendations(
    state: VriState,
  ): Promise<Partial<VriState>> {
    // FAKE-002: never advise on a factor that was never assessed. Excluding
    // it from the aggregate but leaving it here would just invert the original
    // defect — the user would be told to "improve Application Consistency"
    // because the stored 0 sits below the weak threshold, when in fact no
    // cross-verification ran at all.
    const unassessed = new Set<string>(state.unassessedFactors ?? []);
    // A factor the route does not weigh (weight 0 — funds and home ties on
    // Canada's eTA) is not advice-worthy either: telling an eTA applicant to
    // "strengthen proof of funds" sends them after evidence nobody will ask
    // for (dry run 2026-10-16).
    const routeWeights = routeRiskWeights(
      DEFAULT_RISK_WEIGHTS,
      state.data?.destinationCountry,
      state.data?.visaaiId,
    );
    const unweighted = new Set(
      Object.entries(routeWeights)
        .filter(([, w]) => w === 0)
        .map(([factor]) => factor),
    );
    for (const factor of unweighted) unassessed.add(factor);
    const weakFactors = Object.entries(state.scores)
      .filter(([factor, pct]) => !unassessed.has(factor) && pct < weakThreshold)
      .map(([factor, pct]) => ({
        factor,
        label: FACTOR_LABELS[factor] ?? factor,
        pct,
      }));

    // Letters this route explicitly uses; null = no ROUTE_LETTERS entry, so
    // nothing is banned and TRV-style advice keeps its LOE / host invitation.
    const offeredLetters = explicitRouteLetters(
      state.data?.destinationCountry,
      state.data?.visaaiId,
    );
    // The post-filter is English-only; for any other language the prompt
    // rules are the guard.
    const sanitize = (recs: VriRecommendation[]) =>
      isEnglish(language) ? sanitizeRecommendations(recs, offeredLetters) : recs;

    const deterministic = sanitize(
      buildEvidenceRecommendations(state).filter(
        (r) => !unweighted.has(r.factor),
      ),
    );
    if (weakFactors.length === 0) return { recommendations: deterministic };

    const evidence = state.factorEvidence ?? {};
    const refusal = refusalFacts(state.data.profile ?? {});
    const factorLines = weakFactors
      .map((f) => {
        const ev = evidence[f.factor as keyof typeof evidence] ?? [];
        return `- ${f.label} (${f.factor}): ${f.pct}${ev.length ? `\n  Evidence:\n${ev.map((e) => `    * ${e}`).join('\n')}` : ''}`;
      })
      .join('\n');
    const refusalLine =
      refusal.priorRefusal === true
        ? `\n\nPrevious refusal${refusal.date ? ` (${refusal.date.toISOString().slice(0, 10)})` : ''}: ${refusal.reason ?? 'reason not recorded'}`
        : '';

    const response = await llm.invoke([
      new SystemMessage(buildRecSystemPrompt(language, offeredLetters)),
      new HumanMessage(
        `Weak factors (score out of 100):\n${factorLines}${refusalLine}\n\n${asUntrustedData('Applicant profile context', state.data.profile)}\n\nGenerate recommendations as a JSON array:`,
      ),
    ]);

    const raw =
      typeof response.content === 'string'
        ? response.content
        : ((response.content[0] as { text?: string } | undefined)?.text ?? '');

    let parsed: Array<{
      factor: string;
      issue: string;
      recommendation_text: string;
    }> = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      // Non-parseable — fall back to generic recommendations
    }

    const llmRecs: VriRecommendation[] = (
      parsed.length > 0
        ? parsed
        : weakFactors.map((f) => ({
            factor: f.factor,
            issue: `${f.label} is below the recommended threshold.`,
            recommendation_text: `Strengthen your ${f.label.toLowerCase()} with additional supporting evidence.`,
          }))
    ).map((r, i) => ({
      factor: r.factor,
      issue: r.issue,
      recommendation_text: r.recommendation_text,
      priority:
        weakFactors.findIndex((f) => f.factor === r.factor) >= 0
          ? Math.round(
              100 - (weakFactors.find((f) => f.factor === r.factor)?.pct ?? 0),
            )
          : i,
    }));

    return {
      recommendations: [
        ...deterministic,
        ...sanitize(llmRecs),
      ],
    };
  };
}

const GROUND_ADVICE: Record<string, string> = {
  home_ties:
    'Prove each tie with documents, not statements: property title deeds/registry extracts, your marriage certificate and your spouse’s ID showing they stay at home, ID/residence proof for children who stay, and pension or income records. In a letter of explanation, state what keeps you in your home country and what has changed since the refusal.',
  purpose:
    'Make the temporary purpose unambiguous: a short, fixed itinerary with a booked return ticket inside the requested stay, and a clear statement (from you and your host) that you will not work or provide ongoing care such as childcare. Request only the stay the itinerary needs.',
  funds:
    'Document the money behind the trip: recent bank statements, the sponsor’s employment letter, pay stubs and tax/income records, and a signed support letter tying the sponsor’s funds to this visit.',
  travel_history:
    'Add evidence of any previous travel (visas and entry/exit stamps) and explain any gaps.',
  misrepresentation:
    'A misrepresentation finding needs professional advice before re-applying — make sure every answer matches your documents exactly.',
};

/**
 * Recommendations that come straight from the evidence, independent of the
 * LLM (so they survive an unparseable model response):
 *   - a previous refusal → one recommendation per refusal ground, quoting it;
 *   - uploads OCR could not read → re-upload, naming each document;
 * Factor keys stay within the six `*_pct` keys the readiness UI labels.
 */
export function buildEvidenceRecommendations(
  state: VriState,
): VriRecommendation[] {
  const out: VriRecommendation[] = [];
  const r = refusalFacts(state.data.profile ?? {});
  if (r.priorRefusal === true) {
    const when = r.date ? ` on ${r.date.toISOString().slice(0, 10)}` : '';
    const issue = `Your previous visa application was refused${when}${r.reason ? `: ${r.reason}` : ''}. The officer will check whether this application answers those grounds.`;
    const grounds = r.grounds.length ? r.grounds : (['home_ties'] as const);
    for (const g of grounds) {
      out.push({
        factor:
          g === 'funds'
            ? 'financial_pct'
            : g === 'purpose' || g === 'misrepresentation'
              ? 'consistency_pct'
              : g === 'travel_history'
                ? 'travel_history_pct'
                : 'home_ties_pct',
        issue,
        recommendation_text: GROUND_ADVICE[g],
        priority: 100,
      });
    }
  }

  const unreadable = documentEvidence(state.data).filter((d) => d.failed);
  if (unreadable.length > 0) {
    out.push({
      factor: 'documentation_pct',
      issue: `${unreadable.length} uploaded document(s) could not be read, so their content was not assessed: ${[...new Set(unreadable.map((d) => d.type))].join(', ')}.`,
      recommendation_text:
        'Re-upload each of these as a clear, complete scan or the original PDF (all pages, no glare or cropping). Until they are read, the readiness score cannot credit them, and the details they contain cannot be checked against the rest of your application.',
      priority: 90,
    });
  }
  return out;
}
