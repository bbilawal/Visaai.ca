import { Annotation } from '@langchain/langgraph';
import type { PrefilledFormField, PrefilledFormPayload } from '@visaai/types';
import type { OtherPartyDocument } from './nodes/applicant-guards';

export interface PrefillContext {
  countryCode: string;
  visaType: string;
  purpose: string;
  /** Registry visa type id (`visa_types.visaai_id`); null for legacy routes. */
  visaaiId?: string | null;
  profile: Record<string, unknown>;
  /** Every uploaded document's extracted fields, merged into one flat map. */
  documentFields: Record<string, unknown>;
  /**
   * The same values grouped by `documents.document_type`. Gives the field
   * generator provenance — an `account_balance` from a `bank_statement` and a
   * `program_start_date` from an `admission_letter` are different evidence, and
   * a flat map alone cannot say which document a value came from.
   */
  documentFieldsByType: Record<string, Record<string, unknown>>;
  /**
   * Documents that do NOT describe the applicant — a host's invitation, a
   * sponsoring child's employment letter or bank statement, or a financial
   * document that names nobody. They may fill sponsor/host fields only; the
   * two maps above hold the applicant's own documents and nothing else.
   */
  otherPartyDocuments: OtherPartyDocument[];
  /** Applicant's name as on the passport (fallback: intake profile). */
  applicantName: string | null;
  /** Each uploaded insurance policy's extracted fields, one per document. */
  insurancePolicies?: Array<Record<string, unknown>>;
  /**
   * Identity and contact details the applicant already gave us on their ACCOUNT
   * — onboarding (`users.full_name`, `users.nationality`) and Settings
   * (`user_profiles`: phone, full postal address).
   *
   * Before this existed, four modules read `users` and every one of them
   * selected `preferred_language` and nothing else, while `user_profiles` was
   * read by no pipeline module at all. So an applicant typed their name,
   * nationality, phone and address into the product, and the prefilled
   * government form still came back with "Contact" and "Address" blank — a
   * section the generator is explicitly instructed to fill. Empty when the user
   * has not filled those screens in.
   */
  accountProfile: Record<string, unknown>;
  /**
   * Answers people entered on the stored Forms page (applicant typed,
   * consultant corrected). A regeneration starts from them, so the questions
   * it adds see what the applicant already typed (dry run 2026-10-18).
   */
  personFields?: PrefilledFormField[];
}

export const PrefillAnnotation = Annotation.Root({
  applicationId: Annotation<string>(),
  context: Annotation<PrefillContext>(),
  fields: Annotation<PrefilledFormField[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  payload: Annotation<PrefilledFormPayload | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  generatedDocumentId: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});

export type PrefillState = typeof PrefillAnnotation.State;
