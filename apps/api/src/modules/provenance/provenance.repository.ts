import type {
  ConfidenceBand,
  FieldProvenance,
  NewOcrRunInput,
  OcrRun,
  ProvenanceOrigin,
} from '@visaai/types';

/** A fully-resolved new field version (value already hashed by the service). */
export interface CreateVersionInput {
  applicationId: string;
  fieldKey: string;
  origin: ProvenanceOrigin;
  valueSnapshot: string | null;
  valueHash: string | null;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceBBox: unknown | null;
  ocrRunId: string | null;
  confidence: number | null;
  confidenceBand: ConfidenceBand | null;
}

/**
 * Data-access contract for ocr_runs + field_provenance.
 *
 * Field provenance is APPEND-ONLY and versioned: createVersion performs an
 * atomic "supersede current -> insert new current" (one current per field).
 * There is NO method to update or delete a value/source column; the only
 * mutation is the lineage pointer (superseded_by) set during createVersion.
 */
export interface IProvenanceRepository {
  insertOcrRun(
    input: NewOcrRunInput,
    rawTextHash: string | null,
  ): Promise<OcrRun>;

  /** Atomic: supersede the existing current row (if any) and insert the new current. */
  createVersion(input: CreateVersionInput): Promise<FieldProvenance>;

  getCurrent(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldProvenance | null>;

  /** Full version history for a field, oldest -> newest. */
  getHistory(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldProvenance[]>;

  /** All current rows sourced from a document (cascade source). */
  getByDocument(documentId: string): Promise<FieldProvenance[]>;

  /**
   * Retire a document's versions of every field NOT in `keep`, in one
   * transaction under the per-field lock (`field_provenance_retire`). A
   * retired row points at itself, so "current" readers drop it while the
   * read history keeps it; it is spliced out of its chain, so the field falls
   * back to its previous version or has none. A consultant-approved current
   * value is left alone and reported `skipped_approved`. Returns how many
   * versions each field lost.
   */
  retireDocumentFieldsExcept(
    applicationId: string,
    documentId: string,
    keep: string[],
  ): Promise<{ field_key: string; retired: number; skipped_approved: boolean }[]>;
}

export const PROVENANCE_REPOSITORY = Symbol('IProvenanceRepository');

