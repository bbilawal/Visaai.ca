/**
 * Canonical in-memory IProvenanceRepository.
 *
 * DUP-001: six copies across six spec files in FOUR versions, differing not in
 * shape (all five methods present everywhere) but in how many were actually
 * implemented — 2, 3, 3 and 5. A copy whose getHistory() returns [] cannot fail
 * a test when history is broken. This is the fullest version.
 */
import type { FieldProvenance, NewOcrRunInput, OcrRun } from '@visaai/types';
import type {
  CreateVersionInput,
  IProvenanceRepository,
} from '../../src/modules/provenance/provenance.repository';

export class FakeProvenanceRepository implements IProvenanceRepository {
  ocrRuns: OcrRun[] = [];
  rows: FieldProvenance[] = [];
  private n = 0;
  private rn = 0;

  async insertOcrRun(
    input: NewOcrRunInput,
    rawTextHash: string | null,
  ): Promise<OcrRun> {
    const run: OcrRun = {
      id: `run-${++this.rn}`,
      document_id: input.documentId,
      application_id: input.applicationId,
      provider: input.provider,
      provider_model: input.providerModel ?? null,
      region: input.region,
      status: input.status,
      page_count: input.pageCount ?? null,
      raw_text_hash: rawTextHash,
      started_at: input.startedAt ?? null,
      completed_at: input.completedAt ?? null,
      created_at: new Date().toISOString(),
    };
    this.ocrRuns.push(run);
    return run;
  }

  async createVersion(input: CreateVersionInput): Promise<FieldProvenance> {
    const newId = `fp-${++this.n}`;
    // supersede the existing current (mutates only the lineage pointer)
    this.rows
      .filter(
        (r) =>
          r.application_id === input.applicationId &&
          r.field_key === input.fieldKey &&
          r.superseded_by === null,
      )
      .forEach((r) => {
        r.superseded_by = newId;
      });
    const row: FieldProvenance = {
      id: newId,
      application_id: input.applicationId,
      field_key: input.fieldKey,
      origin: input.origin,
      value_snapshot: input.valueSnapshot,
      value_hash: input.valueHash,
      source_document_id: input.sourceDocumentId,
      source_page: input.sourcePage,
      source_bbox: (input.sourceBBox as FieldProvenance['source_bbox']) ?? null,
      ocr_run_id: input.ocrRunId,
      extraction_timestamp: new Date().toISOString(),
      confidence: input.confidence,
      confidence_band: input.confidenceBand,
      superseded_by: null,
      created_at: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async getCurrent(
    app: string,
    field: string,
  ): Promise<FieldProvenance | null> {
    return (
      this.rows.find(
        (r) =>
          r.application_id === app &&
          r.field_key === field &&
          r.superseded_by === null,
      ) ?? null
    );
  }
  async getHistory(app: string, field: string): Promise<FieldProvenance[]> {
    return this.rows.filter(
      (r) => r.application_id === app && r.field_key === field,
    );
  }
  async getByDocument(documentId: string): Promise<FieldProvenance[]> {
    return this.rows.filter(
      (r) => r.source_document_id === documentId && r.superseded_by === null,
    );
  }
}
