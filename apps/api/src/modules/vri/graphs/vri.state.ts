import { Annotation } from '@langchain/langgraph';
import type { PlanTier } from '@visaai/types';

export interface VriInputData {
  profile: Record<string, unknown>;
  checklistItems: Array<{
    id?: string;
    document_type: string;
    required: boolean;
    status: string;
  }>;
  documents: Array<{
    id: string;
    document_type: string | null;
    ocr_status: string;
    checklist_item_id?: string | null;
  }>;
  verifications: Array<{
    /** Links extracted fields back to the document they were read from. */
    document_id?: string;
    verification_type: string;
    result: string;
    details_json: Record<string, unknown>;
  }>;
  crossVerifications: Array<{
    field_compared: string;
    result: string;
    /** value_a / value_b as extracted — lets the consistency scorer re-check
     *  format-only differences (15.06.1961 vs 1961-06-15). */
    details_json?: Record<string, unknown>;
  }>;
  destinationCountry: string | null;
  currentVisaType: string | null;
}

export interface FactorScores {
  documentation_pct: number;
  financial_pct: number;
  travel_history_pct: number;
  home_ties_pct: number;
  employment_pct: number;
  consistency_pct: number;
}

export type FactorEvidence = Partial<Record<keyof FactorScores, string[]>>;

export interface VriRecommendation {
  factor: string;
  issue: string;
  recommendation_text: string;
  priority: number;
}

export interface VisaForm {
  form_code: string;
  form_name: string;
  source_url: string | null;
}

export interface VisaSuggestion {
  country_code: string;
  visa_category: string;
  approval_likelihood: number;
  reasoning: string;
  required_forms: VisaForm[];
  required_documents: string[];
  official_source: string | null;
  rank: number;
}

export const VriAnnotation = Annotation.Root({
  applicationId: Annotation<string>(),
  planTier: Annotation<PlanTier>({
    reducer: (_e, u) => u,
    default: () => 'none',
  }),
  data: Annotation<VriInputData>({
    reducer: (_e, u) => u,
    default: () => ({
      profile: {},
      checklistItems: [],
      documents: [],
      verifications: [],
      crossVerifications: [],
      destinationCountry: null,
      currentVisaType: null,
    }),
  }),
  scores: Annotation<FactorScores>({
    reducer: (existing, update) => ({ ...existing, ...update }),
    default: () => ({
      documentation_pct: 0,
      financial_pct: 0,
      travel_history_pct: 0,
      home_ties_pct: 0,
      employment_pct: 0,
      consistency_pct: 0,
    }),
  }),
  /**
   * FAKE-002: factors whose input data was absent, so no assessment actually
   * ran. They are EXCLUDED from the weighted aggregate rather than scored,
   * because an unperformed check is neither a pass nor a fail.
   *
   * Accumulates across scorer nodes (they run in parallel and each may add its
   * own), so the reducer unions rather than replaces.
   */
  unassessedFactors: Annotation<(keyof FactorScores)[]>({
    reducer: (existing, update) => [
      ...new Set([...(existing ?? []), ...(update ?? [])]),
    ],
    default: () => [],
  }),
  /**
   * Plain-language evidence trail per factor: what each scorer actually read
   * (or could not read) to reach its number. Feeds the recommendation prompt
   * and the calculate response, so a score is never a bare constant.
   */
  factorEvidence: Annotation<FactorEvidence>({
    reducer: (existing, update) => ({ ...(existing ?? {}), ...(update ?? {}) }),
    default: () => ({}),
  }),
  overallScore: Annotation<number>({
    reducer: (_e, u) => u,
    default: () => 0,
  }),
  // Auto-escalate-on-low-score (HITL): set by the aggregate node, persisted by save.
  escalate: Annotation<boolean>({
    reducer: (_e, u) => u,
    default: () => false,
  }),
  escalationReason: Annotation<string | null>({
    reducer: (_e, u) => u,
    default: () => null,
  }),
  recommendations: Annotation<VriRecommendation[]>({
    reducer: (_e, u) => u,
    default: () => [],
  }),
  visaSuggestions: Annotation<VisaSuggestion[]>({
    reducer: (_e, u) => u,
    default: () => [],
  }),
});

export type VriState = typeof VriAnnotation.State;
