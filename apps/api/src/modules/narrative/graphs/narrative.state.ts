import { Annotation } from '@langchain/langgraph';
import type { LetterType } from '@visaai/types';
import type { StayFromDates } from '../../shared/stay-duration';
import type { NarrativeEvidence } from './nodes/document-evidence';

export type DocType = LetterType;

export interface NarrativeContext {
  profile: Record<string, unknown>;
  vriScore: number | null;
  countryCode: string;
  visaType: string;
  purpose: string;
  /** Registry visa type (`visa_types.visaai_id`), e.g. 'ca-super-visa'; null
   *  for a legacy framework application. Selects route-specific letter text. */
  visaaiId?: string | null;
  /** What the applicant's verified documents establish (name, insurance). */
  evidence?: NarrativeEvidence | null;
  /** Trip dates + inclusive length when both planned dates are known. The
   *  profile's stated duration is already overwritten with `days`. */
  stay?: StayFromDates | null;
}

export const NarrativeAnnotation = Annotation.Root({
  applicationId: Annotation<string>(),
  docType: Annotation<DocType>(),
  context: Annotation<NarrativeContext>({
    reducer: (_e, u) => u,
    default: () => ({
      profile: {},
      vriScore: null,
      countryCode: '',
      visaType: '',
      purpose: '',
    }),
  }),
  draft: Annotation<string>({
    reducer: (_e, u) => u,
    default: () => '',
  }),
  critique: Annotation<string>({
    reducer: (_e, u) => u,
    default: () => '',
  }),
  approved: Annotation<boolean>({
    reducer: (_e, u) => u,
    default: () => false,
  }),
  // Escalation flag: set when automated review cannot converge or returns
  // unreadable output. Terminates the review loop WITHOUT falsely marking the
  // draft "approved" (fail-closed), so the draft is surfaced for human review.
  needsHumanReview: Annotation<boolean>({
    reducer: (_e, u) => u,
    default: () => false,
  }),
  revisionCount: Annotation<number>({
    reducer: (_e, u) => u,
    default: () => 0,
  }),
  generatedDocumentId: Annotation<string | null>({
    reducer: (_e, u) => u,
    default: () => null,
  }),
});

export type NarrativeState = typeof NarrativeAnnotation.State;
