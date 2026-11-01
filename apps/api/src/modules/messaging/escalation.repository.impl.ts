import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EscalationRecord } from '@visaai/types';
import {
  type IEscalationRepository,
  type InsertEscalationInput,
} from './escalation.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

@Injectable()
export class EscalationRepository implements IEscalationRepository {
  async insert(
    db: SupabaseClient,
    input: InsertEscalationInput,
  ): Promise<EscalationRecord> {
    const res = await db
      .from('escalation_history')
      .insert({
        conversation_id: input.conversationId,
        application_id: input.applicationId,
        escalated_by: input.escalatedBy,
        escalation_type: input.escalationType,
        reason: input.reason,
      })
      .select('*')
      .single();
    return unwrap<EscalationRecord>(res, 'insert escalation');
  }

  async listByApplication(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<EscalationRecord[]> {
    const res = await db
      .from('escalation_history')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as EscalationRecord[]) ?? [];
  }

  async getById(
    db: SupabaseClient,
    id: string,
  ): Promise<EscalationRecord | null> {
    const res = await db
      .from('escalation_history')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as EscalationRecord) ?? null;
  }

  async markResolved(
    db: SupabaseClient,
    id: string,
    resolvedBy: string,
  ): Promise<EscalationRecord> {
    const res = await db
      .from('escalation_history')
      .update({
        status: 'resolved',
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    return unwrap<EscalationRecord>(res, 'resolve escalation');
  }
}
