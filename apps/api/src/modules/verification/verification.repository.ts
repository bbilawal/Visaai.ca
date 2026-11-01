import type {
  FieldVerification,
  SectionVerification,
  SeedFieldInput,
  VerificationState,
} from '@visaai/types';

/** Data-access contract for field_verifications + section_verification view. */
export interface IVerificationRepository {
  upsertSeed(applicationId: string, fields: SeedFieldInput[]): Promise<void>;

  getByField(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldVerification | null>;

  getStates(applicationId: string): Promise<FieldVerification[]>;

  getSectionRollup(applicationId: string): Promise<SectionVerification[]>;

  /** Guarded transition: only applies when current state == expectedFrom (optimistic lock). */
  transition(
    applicationId: string,
    fieldKey: string,
    expectedFrom: VerificationState,
    to: VerificationState,
    patch: Partial<FieldVerification>,
  ): Promise<FieldVerification>;

  listByDocument(documentId: string): Promise<FieldVerification[]>;
}

export const VERIFICATION_REPOSITORY = Symbol('IVerificationRepository');
