import { Injectable } from '@nestjs/common';
import type { FieldProvenance, NewOcrRunInput, OcrRun } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  CreateVersionInput,
  IProvenanceRepository,
} from './provenance.repository';

/**
 * Supabase-backed IProvenanceRepository (ocr_runs + field_provenance).
 *
 * createVersion delegates to the SECURITY DEFINER `field_provenance_create_version`
 * RPC (migration 20260606000008), which atomically supersedes the current row
 * and inserts the new one — append-only, one current per (application, field).
 * This layer never issues a raw UPDATE/DELETE against value/source columns.
 * Service-role (admin) path. No constructor side effects.
 */
@Injectable()
export class ProvenanceRepository implements IProvenanceRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insertOcrRun(
    input: NewOcrRunInput,
    rawTextHash: string | null,
  ): Promise<OcrRun> {
    const { data, error } = await this.supabase.admin
      .from('ocr_runs')
      .insert({
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
      })
      .select('*')
      .single();
    if (error || !data)
      throw new Error(`insertOcrRun failed: ${error?.message ?? 'no row'}`);
    return data;
  }

  async createVersion(input: CreateVersionInput): Promise<FieldProvenance> {
    const { data, error } = await this.supabase.admin.rpc(
      'field_provenance_create_version',
      {
        p_application_id: input.applicationId,
        p_field_key: input.fieldKey,
        p_origin: input.origin,
        p_value_snapshot: input.valueSnapshot,
        p_value_hash: input.valueHash,
        p_source_document_id: input.sourceDocumentId,
        p_source_page: input.sourcePage,
        p_source_bbox: input.sourceBBox ?? null,
        p_ocr_run_id: input.ocrRunId,
        p_confidence: input.confidence,
        p_confidence_band: input.confidenceBand,
      },
    );
    if (error || !data)
      throw new Error(`createVersion failed: ${error?.message ?? 'no row'}`);
    return data;
  }

  async getCurrent(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldProvenance | null> {
    const { data, error } = await this.supabase.admin
      .from('field_provenance')
      .select('*')
      .eq('application_id', applicationId)
      .eq('field_key', fieldKey)
      .is('superseded_by', null)
      .maybeSingle();
    if (error) throw new Error(`getCurrent failed: ${error.message}`);
    return data ?? null;
  }

  async getHistory(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldProvenance[]> {
    const { data, error } = await this.supabase.admin
      .from('field_provenance')
      .select('*')
      .eq('application_id', applicationId)
      .eq('field_key', fieldKey)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`getHistory failed: ${error.message}`);
    return data ?? [];
  }

  async getByDocument(documentId: string): Promise<FieldProvenance[]> {
    const { data, error } = await this.supabase.admin
      .from('field_provenance')
      .select('*')
      .eq('source_document_id', documentId)
      .is('superseded_by', null);
    if (error) throw new Error(`getByDocument failed: ${error.message}`);
    return data ?? [];
  }
}
