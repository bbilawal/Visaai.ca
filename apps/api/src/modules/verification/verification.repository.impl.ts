import { Injectable } from '@nestjs/common';
import type {
  FieldVerification,
  SectionVerification,
  SeedFieldInput,
  VerificationState,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { IVerificationRepository } from './verification.repository';

/**
 * Supabase-backed IVerificationRepository (field_verifications +
 * section_verification view).
 *
 * `transition` is a GUARDED update (eq('state', expectedFrom)) so a stale
 * transition (state already moved) affects zero rows — the optimistic lock the
 * service relies on. Transition VALIDATION (which from->to are legal, tier
 * policy, drift) lives centrally in VerificationService, not here. This layer
 * only persists. No constructor side effects.
 */
@Injectable()
export class VerificationRepository implements IVerificationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async upsertSeed(
    applicationId: string,
    fields: SeedFieldInput[],
  ): Promise<void> {
    if (fields.length === 0) return;
    const rows = fields.map((f) => ({
      application_id: applicationId,
      field_key: f.fieldKey,
      section: f.section ?? null,
      state: 'EXTRACTED',
      value_snapshot: f.value == null ? null : String(f.value),
      value_hash: f.valueHash ?? null,
      source: f.source ?? null,
      source_document_id: f.sourceDocumentId ?? null,
    }));
    const { error } = await this.supabase.admin
      .from('field_verifications')
      .upsert(rows, {
        onConflict: 'application_id,field_key',
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`upsertSeed failed: ${error.message}`);
  }

  async getByField(
    applicationId: string,
    fieldKey: string,
  ): Promise<FieldVerification | null> {
    const { data, error } = await this.supabase.admin
      .from('field_verifications')
      .select('*')
      .eq('application_id', applicationId)
      .eq('field_key', fieldKey)
      .maybeSingle();
    if (error) throw new Error(`getByField failed: ${error.message}`);
    return data ?? null;
  }

  async getStates(applicationId: string): Promise<FieldVerification[]> {
    const { data, error } = await this.supabase.admin
      .from('field_verifications')
      .select('*')
      .eq('application_id', applicationId);
    if (error) throw new Error(`getStates failed: ${error.message}`);
    return data ?? [];
  }

  async getSectionRollup(
    applicationId: string,
  ): Promise<SectionVerification[]> {
    const { data, error } = await this.supabase.admin
      .from('section_verification')
      .select('*')
      .eq('application_id', applicationId);
    if (error) throw new Error(`getSectionRollup failed: ${error.message}`);
    return data ?? [];
  }

  async transition(
    applicationId: string,
    fieldKey: string,
    expectedFrom: VerificationState,
    to: VerificationState,
    patch: Partial<FieldVerification>,
  ): Promise<FieldVerification> {
    const { data, error } = await this.supabase.admin
      .from('field_verifications')
      .update({ ...patch, state: to })
      .eq('application_id', applicationId)
      .eq('field_key', fieldKey)
      .eq('state', expectedFrom)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(
        `transition failed (stale or missing): ${error?.message ?? 'no row'}`,
      );
    }
    return data;
  }

  async listByDocument(documentId: string): Promise<FieldVerification[]> {
    const { data, error } = await this.supabase.admin
      .from('field_verifications')
      .select('*')
      .eq('source_document_id', documentId);
    if (error) throw new Error(`listByDocument failed: ${error.message}`);
    return data ?? [];
  }
}
