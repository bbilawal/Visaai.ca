import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ActorRef,
  ConfidenceBand,
  FieldProvenance,
  NewFieldProvenanceInput,
  NewOcrRunInput,
  OcrRun,
  ValueHash,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { PROVENANCE_REPOSITORY } from './provenance.repository';
import type {
  CreateVersionInput,
  IProvenanceRepository,
} from './provenance.repository';

const HIGH_CONFIDENCE = 0.85;
const MEDIUM_CONFIDENCE = 0.6;
const SYSTEM: ActorRef = { id: null, role: 'system' };

/**
 * ProvenanceService — source-of-truth trace layer above OCR/extraction.
 *
 * Records OCR runs, creates immutable field-provenance versions (supersede =>
 * new version, never in-place), owns value_hash generation (the cross-table
 * integrity spine), and emits an audit event for every provenance event.
 *
 * NOT wired into any OCR/extraction/pipeline call site (frozen). Pure service
 * logic + repository delegation only.
 */
@Injectable()
export class ProvenanceService {
  constructor(
    @Inject(PROVENANCE_REPOSITORY) private readonly repo: IProvenanceRepository,
    private readonly audit: AuditService,
  ) {}

  // ---- F. value_hash generation (the spine; reused everywhere) ----------
  /** Deterministic sha256 of the normalized value. Strings trimmed + NFC. */
  valueHash(value: string | number | null): ValueHash {
    const normalized =
      value == null
        ? ''
        : typeof value === 'number'
          ? String(value)
          : value.trim().normalize('NFC');
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  private bandFor(
    confidence: number | null | undefined,
  ): ConfidenceBand | null {
    if (confidence == null) return null;
    if (confidence >= HIGH_CONFIDENCE) return 'high';
    if (confidence >= MEDIUM_CONFIDENCE) return 'medium';
    return 'low';
  }

  // ---- A. recordOcrRun() -----------------------------------------------
  /** Persist one OCR pass and emit OCR_COMPLETED. */
  async recordOcrRun(input: NewOcrRunInput): Promise<OcrRun> {
    const rawTextHash = input.rawText
      ? createHash('sha256').update(input.rawText, 'utf8').digest('hex')
      : null;

    const run = await this.repo.insertOcrRun(input, rawTextHash);

    await this.audit.append({
      applicationId: input.applicationId,
      eventType: 'OCR_COMPLETED',
      actor: { id: null, role: 'system' },
      refs: { documentId: input.documentId, ocrRunId: run.id },
      payload: {
        provider: input.provider,
        provider_model: input.providerModel ?? null,
        region: input.region,
        status: input.status,
        page_count: input.pageCount ?? null,
      },
    });

    return run;
  }

  // ---- B. createFieldProvenance() (first/new version) ------------------
  async createFieldProvenance(
    input: NewFieldProvenanceInput,
  ): Promise<FieldProvenance> {
    return this.writeVersion(input, 'FIELD_EXTRACTED', false);
  }

  // ---- C. supersedeFieldProvenance() (explicit new version) ------------
  /** Requires a current version to exist; creates a superseding new version. */
  async supersedeFieldProvenance(
    input: NewFieldProvenanceInput,
    actor: ActorRef = SYSTEM,
  ): Promise<FieldProvenance> {
    const current = await this.repo.getCurrent(
      input.applicationId,
      input.fieldKey,
    );
    if (!current) {
      throw new BadRequestException(
        `cannot supersede ${input.fieldKey}: no current provenance version exists`,
      );
    }
    return this.writeVersion(input, 'FIELD_EDITED', true, actor);
  }

  /** Shared write path: hash value, enforce OCR linkage, create version, audit. */
  private async writeVersion(
    input: NewFieldProvenanceInput,
    eventType: 'FIELD_EXTRACTED' | 'FIELD_EDITED',
    superseded: boolean,
    actor: ActorRef = SYSTEM,
  ): Promise<FieldProvenance> {
    // Every OCR-origin version must carry its run id (run-identity is mandatory).
    if (input.origin === 'ocr' && !input.ocrRunId) {
      throw new BadRequestException(
        `ocr-origin provenance for ${input.fieldKey} requires ocrRunId`,
      );
    }

    const valueHash = input.value == null ? null : this.valueHash(input.value);
    const confidenceBand = this.bandFor(input.confidence);

    const versionInput: CreateVersionInput = {
      applicationId: input.applicationId,
      fieldKey: input.fieldKey,
      origin: input.origin,
      valueSnapshot: input.value == null ? null : String(input.value),
      valueHash,
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourcePage: input.sourcePage ?? null,
      sourceBBox: input.sourceBBox ?? null,
      ocrRunId: input.ocrRunId ?? null,
      confidence: input.confidence ?? null,
      confidenceBand,
    };

    const row = await this.repo.createVersion(versionInput);

    // G. provenance -> audit. value carried as value_hash only (no raw PII).
    await this.audit.append({
      applicationId: input.applicationId,
      eventType,
      actor,
      valueHash,
      refs: {
        fieldKey: input.fieldKey,
        documentId: input.sourceDocumentId ?? null,
        ocrRunId: input.ocrRunId ?? null,
      },
      payload: {
        origin: input.origin,
        source_page: input.sourcePage ?? null,
        has_bbox: !!input.sourceBBox,
        confidence_band: confidenceBand,
        provenance_id: row.id,
        superseded,
      },
    });

    return row;
  }

  // ---- D. getCurrentFieldVersion() -------------------------------------
  async getCurrentFieldVersion(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldProvenance | null> {
    return this.repo.getCurrent(applicationId, fieldKey);
  }

  // ---- E. getFieldHistory() --------------------------------------------
  async getFieldHistory(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldProvenance[]> {
    return this.repo.getHistory(applicationId, fieldKey);
  }

  /** All current provenance rows sourced from a document (cascade source). */
  async getByDocument(documentId: string): Promise<FieldProvenance[]> {
    return this.repo.getByDocument(documentId);
  }
}
