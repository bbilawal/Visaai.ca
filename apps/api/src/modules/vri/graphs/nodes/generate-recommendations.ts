import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { VriState, VriRecommendation } from '../vri.state';
import { documentEvidence, refusalFacts } from '../scoring/evidence';
import { languageDirective } from '../../../../i18n/language';
import { DEFAULT_THRESHOLDS } from '../../risk-config.types';
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

${UNTRUSTED_DATA_DIRECTIVE}`;

export function buildRecSystemPrompt(language?: string | null): string {
  return REC_PROMPT + languageDirective(language);
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
    const weakFactors = Object.entries(state.scores)
      .filter(([factor, pct]) => !unassessed.has(factor) && pct < weakThreshold)
      .map(([factor, pct]) => ({
        factor,
        label: FACTOR_LABELS[factor] ?? factor,
        pct,
      }));

    const deterministic = buildEvidenceRecommendations(state);
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
      new SystemMessage(buildRecSystemPrompt(language)),
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

    return { recommendations: [...deterministic, ...llmRecs] };
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
