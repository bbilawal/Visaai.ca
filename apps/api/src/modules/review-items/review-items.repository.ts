import type { ReviewItemDecision, ReviewItemKind } from '@visaai/types';

export interface DocumentRow {
  id: string;
  application_id: string;
  document_type: string | null;
  file_name: string | null;
  storage_path: string;
  upload_status: string | null;
  ocr_status: string | null;
  created_at: string | null;
  /** The checklist slot the upload belongs to; a newer upload there replaces it. */
  checklist_item_id?: string | null;
}

export interface VerificationRow {
  document_id: string;
  verification_type: string | null;
  result: string | null;
  details_json: unknown;
  verified_at: string | null;
}

export interface ExtractedFieldRow {
  source_document_id: string | null;
  field_key: string;
  value_snapshot: string | null;
  origin: string | null;
  confidence: number | null;
}

export interface GeneratedRow {
  id: string;
  application_id: string;
  doc_type: string;
  content_md: string;
  approved_by_user: boolean;
  generated_at: string | null;
}

export interface DecisionRow {
  item_kind: ReviewItemKind;
  item_id: string;
  decision: ReviewItemDecision;
  note: string | null;
  reviewer_id: string | null;
  reviewer_role: 'consultant' | 'admin';
  created_at: string;
}

/** document_holder_confirmations: the applicant's own "this passport is mine". */
export interface HolderConfirmationRow {
  application_id: string;
  document_id: string;
  confirmed_by: string | null;
  holder_name: string | null;
  stated_name: string | null;
  created_at: string;
}

/**
 * Service-role data access for the consultant review surface. Every method is
 * keyed on the application id as well as the item id, so a document id from
 * another application can never be resolved through an authorized route.
 */
export interface IReviewItemsRepository {
  listDocuments(applicationId: string): Promise<DocumentRow[]>;
  getDocument(
    applicationId: string,
    documentId: string,
  ): Promise<DocumentRow | null>;
  listVerifications(documentIds: string[]): Promise<VerificationRow[]>;
  listExtractedFields(applicationId: string): Promise<ExtractedFieldRow[]>;
  listGenerated(applicationId: string): Promise<GeneratedRow[]>;
  getGenerated(applicationId: string, id: string): Promise<GeneratedRow | null>;
  listDecisions(applicationId: string): Promise<DecisionRow[]>;
  listHolderConfirmations(
    applicationId: string,
  ): Promise<HolderConfirmationRow[]>;
  insertDecision(row: DecisionRow & { application_id: string }): Promise<void>;
  insertRevision(row: {
    generated_document_id: string;
    application_id: string;
    content_md: string;
    edited_by: string;
    edited_role: 'consultant' | 'admin';
    note: string | null;
  }): Promise<void>;
  updateGeneratedContent(
    applicationId: string,
    id: string,
    contentMd: string,
  ): Promise<void>;
  signedDocumentUrl(
    storagePath: string,
    ttlSeconds: number,
  ): Promise<string | null>;
  logDocumentAccess(row: {
    document_id: string;
    application_id: string;
    user_id: string;
    action: 'view';
  }): Promise<void>;
}

export const REVIEW_ITEMS_REPOSITORY = Symbol('IReviewItemsRepository');
