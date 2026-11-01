import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { EvaluationOutput, ResearchOutput } from './visa.schemas';
import { VISA_OPENAI } from './openai.provider';
import { languageDirective, languageName } from '../../i18n/language';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../shared/ai/untrusted';

import { modelForTask } from '../shared/ai/model-factory';

/**
 * Models come from the task registry. Each agent here is a distinct registry
 * task with its own tier, budget and eval threshold; two shared constants
 * could not express that the evaluator earns a stronger model and the
 * copywriter does not.
 */
const MODEL_ESTIMATE = modelForTask('visa_requirement_estimate');
const MODEL_EVALUATE = modelForTask('profile_evaluation');
const MODEL_COPY = modelForTask('recommendation_copy');

/**
 * Directive for the structured-output agents (research, evaluator). Only the
 * free-text/description string fields are translated; enum values, class names,
 * codes, and numeric thresholds MUST stay machine/original so downstream logic
 * and government codes are unaffected. Returns '' for en/null (no-op).
 */
function structuredLanguageDirective(language?: string | null): string {
  const name = languageName(language);
  if (!name || language === 'en') return '';
  return (
    `\nRESPONSE LANGUAGE: Write the descriptive/explanatory free-text string ` +
    `fields (e.g. document names, rule descriptions, risk factors, gaps, ` +
    `mitigation steps) in ${name}. Keep enum values, class names, official ` +
    `form/visa codes, and all numeric thresholds exactly as-is — never ` +
    `translate or localize codes, identifiers, or numbers.`
  );
}

/** Bounded retry for transient OpenAI failures. No redundant success calls. */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
    }
  }
  throw new Error(
    `${label} failed: ${last instanceof Error ? last.message : 'unknown'}`,
  );
}

// ── VisaResearchAgent ───────────────────────────────────────────────────────
const RESEARCH_PROMPT = `
You are a visa-requirements research engine. Given a country and visa type,
output ONLY the structured schema — no prose, no commentary.
- visa_class: the official/common class name.
- mandatory_documents: concrete required documents.
- financial_threshold_usd: typical proof-of-funds in USD (best estimate).
- critical_immigration_rules: hard rules that drive refusals.
If a value is uncertain, give a conservative typical value and capture the
uncertainty as a critical_immigration_rule. Never invent precise figures as fact.
`.trim();

@Injectable()
export class VisaResearchAgent {
  private readonly log = new Logger(VisaResearchAgent.name);
  constructor(@Inject(VISA_OPENAI) private readonly client: OpenAI) {}

  async run(
    country: string,
    visaType: string,
    notes?: string,
    language?: string | null,
  ): Promise<ResearchOutput> {
    // SEC-6002: `notes` is applicant free text — fence it as untrusted data.
    const user = `Country: ${country}\nVisa type: ${visaType}${notes ? `\nNotes: ${asUntrustedData('applicant notes', notes)}` : ''}`;
    return withRetry('VisaResearchAgent', async () => {
      const completion = await this.client.chat.completions.parse({
        model: MODEL_ESTIMATE,
        temperature: 0,
        max_tokens: 600,
        response_format: zodResponseFormat(ResearchOutput, 'visa_research'),
        messages: [
          {
            role: 'system',
            content:
              RESEARCH_PROMPT +
              structuredLanguageDirective(language) +
              `\n\n${UNTRUSTED_DATA_DIRECTIVE}`,
          },
          { role: 'user', content: user },
        ],
      });
      const parsed = completion.choices[0]?.message?.parsed;
      if (!parsed) throw new Error('no structured output');
      return parsed;
    });
  }
}

// ── ProfileEvaluatorAgent ───────────────────────────────────────────────────
const EVALUATOR_PROMPT = `
You are a visa risk evaluator. Given visa requirements and an applicant profile,
output ONLY the structured schema — no prose.
- calculated_success_probability: a REALISTIC 0–100 estimate. NEVER 100. NEVER
  express certainty. Lower it for missing/weak evidence, thin finances, or
  unmet hard rules.
- risk_factors: concrete factors lowering the odds.
- critical_gaps: specific missing/insufficient items vs the requirements.
- mitigation_strategies: actionable steps that would raise the probability.
Base the score only on the supplied requirements and profile.
`.trim();

@Injectable()
export class ProfileEvaluatorAgent {
  private readonly log = new Logger(ProfileEvaluatorAgent.name);
  constructor(@Inject(VISA_OPENAI) private readonly client: OpenAI) {}

  async run(
    research: ResearchOutput,
    profile: string,
    language?: string | null,
  ): Promise<EvaluationOutput> {
    // SEC-6002: the profile is applicant/OCR-derived — fence it as untrusted.
    const user = `VISA REQUIREMENTS (JSON):\n${JSON.stringify(research)}\n\nAPPLICANT PROFILE:\n${asUntrustedData('applicant profile', profile)}`;
    const result = await withRetry('ProfileEvaluatorAgent', async () => {
      const completion = await this.client.chat.completions.parse({
        model: MODEL_EVALUATE,
        temperature: 0,
        max_tokens: 800,
        response_format: zodResponseFormat(EvaluationOutput, 'visa_evaluation'),
        messages: [
          {
            role: 'system',
            content:
              EVALUATOR_PROMPT +
              structuredLanguageDirective(language) +
              `\n\n${UNTRUSTED_DATA_DIRECTIVE}`,
          },
          { role: 'user', content: user },
        ],
      });
      const parsed = completion.choices[0]?.message?.parsed;
      if (!parsed) throw new Error('no structured output');
      return parsed;
    });
    // Defensive: never assert certainty regardless of model output.
    result.calculated_success_probability = Math.max(
      1,
      Math.min(99, Math.round(result.calculated_success_probability)),
    );
    return result;
  }
}

// ── CopywriterAgent ─────────────────────────────────────────────────────────
const COPYWRITER_PROMPT = `
Return only structured Markdown. No greetings, no explanations, no conversational
tone. Convert the evaluation into a scannable visa strategy report with these
sections: ## Success Probability (bold percent + one-line uncertainty caveat),
## Key Risks, ## Critical Gaps, ## Mitigation Plan, ## Required Documents.
Use headings and bullet lists. Do NOT claim guaranteed approval.
`.trim();

@Injectable()
export class CopywriterAgent {
  private readonly log = new Logger(CopywriterAgent.name);
  constructor(@Inject(VISA_OPENAI) private readonly client: OpenAI) {}

  async run(
    research: ResearchOutput,
    evaluation: EvaluationOutput,
    language?: string | null,
  ): Promise<string> {
    const user = `EVALUATION (JSON):\n${JSON.stringify(evaluation)}\n\nREQUIREMENTS (JSON):\n${JSON.stringify(research)}`;
    return withRetry('CopywriterAgent', async () => {
      const completion = await this.client.chat.completions.create({
        model: MODEL_COPY,
        temperature: 0,
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: COPYWRITER_PROMPT + languageDirective(language),
          },
          { role: 'user', content: user },
        ],
      });
      const md = completion.choices[0]?.message?.content?.trim();
      if (!md) throw new Error('no markdown output');
      return md;
    });
  }
}
