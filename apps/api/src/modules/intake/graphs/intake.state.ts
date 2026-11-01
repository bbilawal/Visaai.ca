import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

export interface ChecklistItemMetaSnapshot {
  kind?: 'form' | 'document';
  owner?: 'applicant' | 'sponsor';
  strength?: boolean;
  form_code?: string;
  form_name?: string;
  source_url?: string | null;
  specs?: Record<string, string>;
}

export interface ChecklistItemSnapshot {
  id: string;
  document_type: string;
  label: string;
  required: boolean;
  status: string;
  added_reason: string | null;
  meta?: ChecklistItemMetaSnapshot | null;
}

export interface SuggestedVisaType {
  visa_type: string;
  label: string;
  reason: string;
}

export interface IntakeStateFields {
  applicationId: string;
  frameworkId: string | null;
  /**
   * The chosen visa route, into the sourced registry. Null until the applicant
   * picks one — that is discovery mode, not a missing value.
   */
  visaTypeId: string | null;
  destinationCountry: string | null;
  destinationState: string | null;
  requirementsJson: Record<string, unknown>;
  profileJson: Record<string, unknown>;
  riskIndicators: string[];
  checklistItems: ChecklistItemSnapshot[];
  suggestedVisaTypes: SuggestedVisaType[];
  messages: BaseMessage[];
  isComplete: boolean;
  currentQuestion: string | null;
  /**
   * When the document checklist was last derived, ISO-8601, or null if never.
   *
   * Lives on the checkpoint rather than in a column because that is where it
   * is already invalidated for free: choosing a different route deletes the
   * checkpoint, which is exactly when a rebuild is mandatory.
   */
  checklistBuiltAt: string | null;
}

export const IntakeAnnotation = Annotation.Root({
  applicationId: Annotation<string>(),
  visaTypeId: Annotation<string | null>({
    reducer: (_prev, next) => next ?? null,
    default: () => null,
  }),
  frameworkId: Annotation<string | null>({
    reducer: (existing, update) => update ?? existing,
    default: () => null,
  }),
  destinationCountry: Annotation<string | null>({
    reducer: (existing, update) => update ?? existing,
    default: () => null,
  }),
  destinationState: Annotation<string | null>({
    reducer: (existing, update) => update ?? existing,
    default: () => null,
  }),
  requirementsJson: Annotation<Record<string, unknown>>({
    reducer: (existing, update) => update ?? existing,
    default: () => ({}),
  }),
  profileJson: Annotation<Record<string, unknown>>({
    reducer: (existing, update) => ({ ...existing, ...update }),
    default: () => ({}),
  }),
  riskIndicators: Annotation<string[]>({
    reducer: (existing, update) => [...new Set([...existing, ...update])],
    default: () => [],
  }),
  checklistItems: Annotation<ChecklistItemSnapshot[]>({
    reducer: (existing, update) => update ?? existing,
    default: () => [],
  }),
  suggestedVisaTypes: Annotation<SuggestedVisaType[]>({
    reducer: (_existing, update) => update,
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  isComplete: Annotation<boolean>({
    reducer: (_existing, update) => update,
    default: () => false,
  }),
  currentQuestion: Annotation<string | null>({
    reducer: (_existing, update) => update,
    default: () => null,
  }),
  checklistBuiltAt: Annotation<string | null>({
    reducer: (existing, update) => update ?? existing,
    default: () => null,
  }),
});

export type IntakeState = typeof IntakeAnnotation.State;
