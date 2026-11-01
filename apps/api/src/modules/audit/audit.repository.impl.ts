import { Injectable } from '@nestjs/common';
import type { AuditEvent } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  AuditSeqConflictError,
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from './audit.repository';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Supabase-backed IAuditRepository.
 *
 * APPEND-ONLY: only inserts and reads. No update/delete code path exists here.
 * The table additionally rejects UPDATE/DELETE (triggers) and the chain math is
 * owned by AuditService — this layer just persists the precomputed row via the
 * service-role (admin) client. Provided only inside AuditModule; not exported.
 *
 * No side effects in the constructor.
 */
@Injectable()
export class AuditRepository implements IAuditRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getChainHead(applicationId: string): Promise<ChainHead | null> {
    const { data, error } = await this.supabase.admin
      .from('audit_events')
      .select('seq, row_hash')
      .eq('application_id', applicationId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`getChainHead failed: ${error.message}`);
    if (!data) return null;
    const row = data;
    return { seq: row.seq, rowHash: row.row_hash };
  }

  async appendEvent(row: NewAuditEventRow): Promise<AuditEvent> {
    const { data, error } = await this.supabase.admin
      .from('audit_events')
      .insert(row)
      .select('*')
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION)
        throw new AuditSeqConflictError(error.message);
      throw new Error(`appendEvent failed: ${error.message}`);
    }
    return data;
  }

  async getTrail(applicationId: string): Promise<AuditEvent[]> {
    const { data, error } = await this.supabase.admin
      .from('audit_events')
      .select('*')
      .eq('application_id', applicationId)
      .order('seq', { ascending: true });
    if (error) throw new Error(`getTrail failed: ${error.message}`);
    return data ?? [];
  }

  async findByIdempotencyKey(
    applicationId: string,
    key: string,
  ): Promise<AuditEvent | null> {
    const { data, error } = await this.supabase.admin
      .from('audit_events')
      .select('*')
      .eq('application_id', applicationId)
      .eq('payload->>idempotency_key', key)
      .maybeSingle();
    if (error) throw new Error(`findByIdempotencyKey failed: ${error.message}`);
    return data ?? null;
  }
}
