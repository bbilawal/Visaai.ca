import { Annotation } from '@langchain/langgraph';
import type { SlotMismatch } from './nodes/classify-document';

export interface ExtractedFields {
  full_name?: string;
  date_of_birth?: string;
  passport_number?: string;
  expiry_date?: string;
  employer?: string;
  monthly_income?: number;
  account_balance?: number;
  issue_date?: string;
  nationality?: string;
  currency?: string;
  sex?: string;
  national_id_number?: string;
  [key: string]: string | number | undefined;
}

export interface VerificationDetail {
  field: string;
  value: string | number;
  confidence: 'high' | 'medium' | 'low';
}

export const DocumentAnnotation = Annotation.Root({
  documentId: Annotation<string>(),
  applicationId: Annotation<string>(),
  storagePath: Annotation<string>(),
  mimeType: Annotation<string>(),
  documentType: Annotation<string>(),

  // Signed URL produced by fetch-document — kept separate from storagePath
  // so retries don't pass a signed URL back into createSignedUrl.
  signedUrl: Annotation<string>({
    reducer: (_existing, update) => update,
    default: () => '',
  }),

  rawOcrText: Annotation<string>({
    reducer: (_existing, update) => update,
    default: () => '',
  }),

  extractedFields: Annotation<ExtractedFields>({
    reducer: (_existing, update) => update,
    default: () => ({}),
  }),

  verificationResult: Annotation<'pass' | 'warn' | 'fail'>({
    reducer: (_existing, update) => update,
    default: () => 'pass',
  }),
  verificationDetails: Annotation<VerificationDetail[]>({
    reducer: (_existing, update) => update,
    default: () => [],
  }),

  allDocsProcessed: Annotation<boolean>({
    reducer: (_existing, update) => update,
    default: () => false,
  }),

  // --- Duplicate detection (detect_duplicate node) ---
  // sha256 of rawOcrText — same algorithm as ocr_runs.raw_text_hash.
  contentHash: Annotation<string | undefined>({
    reducer: (_existing, update) => update,
    default: () => undefined,
  }),
  // sha256 of the normalized identity tuple (document_type|id|name|dob).
  identityFphash: Annotation<string | undefined>({
    reducer: (_existing, update) => update,
    default: () => undefined,
  }),
  dupStatus: Annotation<'unique' | 'exact_dup' | 'likely_dup'>({
    reducer: (_existing, update) => update,
    default: () => 'unique',
  }),
  duplicateOf: Annotation<string | null>({
    reducer: (_existing, update) => update,
    default: () => null,
  }),

  // --- Expiry evaluation (evaluate_expiry node) ---
  expiryStatus: Annotation<'pass' | 'warn' | 'fail' | 'unknown' | null>({
    reducer: (_existing, update) => update,
    default: () => null,
  }),
  daysUntilExpiry: Annotation<number | null>({
    reducer: (_existing, update) => update,
    default: () => null,
  }),

  // --- Language detection (detect_language node) ---
  detectedLanguage: Annotation<string | undefined>({
    reducer: (_existing, update) => update,
    default: () => undefined,
  }),
  languageConfidence: Annotation<number | undefined>({
    reducer: (_existing, update) => update,
    default: () => undefined,
  }),
  needsTranslation: Annotation<boolean>({
    reducer: (_existing, update) => update,
    default: () => false,
  }),

  // --- Content classification (classify_document node) ---
  // Set when a generic upload was re-typed from its OCR text; the original
  // type stays recoverable here and run_cross_verification compares such a
  // document tolerantly (it may be a relative's ID, not the applicant's).
  classifiedFromContent: Annotation<boolean>({
    reducer: (_existing, update) => update,
    default: () => false,
  }),
  // Identity fields corrected or dropped by classify_document, and why.
  fieldAdjustments: Annotation<Record<string, string>>({
    reducer: (_existing, update) => update,
    default: () => ({}),
  }),

  // The upload plainly is not the document its checklist slot asks for
  // (a passport bio page in "evidence of previous travel"). null = fits, or
  // could not tell. Set by classify_document; fails the identity row and
  // re-opens the slot.
  slotMismatch: Annotation<SlotMismatch | null>({
    reducer: (_existing, update) => update,
    default: () => null,
  }),

  error: Annotation<string | null>({
    reducer: (_existing, update) => update,
    default: () => null,
  }),
  /**
   * Whether `error` can succeed on a later attempt (transient: throttling,
   * timeout). false = fail the job without BullMQ retries. null = unknown,
   * treated as retryable.
   */
  errorRetryable: Annotation<boolean | null>({
    reducer: (_existing, update) => update,
    default: () => null,
  }),
});

export type DocumentState = typeof DocumentAnnotation.State;
