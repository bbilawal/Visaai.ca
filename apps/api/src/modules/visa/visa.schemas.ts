import { z } from 'zod';

/**
 * Strict inter-agent contract. ONLY these schemas cross agent boundaries — no
 * free-text leakage. Mirrors the multi-agent spec (Pydantic -> Zod).
 */

export const ResearchOutput = z.object({
  visa_class: z.string(),
  mandatory_documents: z.array(z.string()),
  financial_threshold_usd: z.number(),
  critical_immigration_rules: z.array(z.string()),
});
export type ResearchOutput = z.infer<typeof ResearchOutput>;

export const EvaluationOutput = z.object({
  /** Realistic 0–100 estimate. Never asserts certainty; server clamps to 1–99. */
  calculated_success_probability: z.number(),
  risk_factors: z.array(z.string()),
  critical_gaps: z.array(z.string()),
  mitigation_strategies: z.array(z.string()),
});
export type EvaluationOutput = z.infer<typeof EvaluationOutput>;

/** Final orchestration result returned to the API layer. */
export interface VisaAnalysis {
  research: ResearchOutput;
  evaluation: EvaluationOutput;
  /** Markdown strategy report (CopywriterAgent). */
  report: string;
}
