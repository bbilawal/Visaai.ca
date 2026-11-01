import type { SupabaseClient } from '@supabase/supabase-js';
import type { EscalationRecord, EscalationType } from '@visaai/types';

export interface InsertEscalationInput {
  conversationId: string;
  applicationId: string;
  escalatedBy: string;
  escalationType: EscalationType;
  reason: string;
}

export interface IEscalationRepository {
  insert(
    db: SupabaseClient,
    input: InsertEscalationInput,
  ): Promise<EscalationRecord>;
  listByApplication(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<EscalationRecord[]>;
  getById(db: SupabaseClient, id: string): Promise<EscalationRecord | null>;
  markResolved(
    db: SupabaseClient,
    id: string,
    resolvedBy: string,
  ): Promise<EscalationRecord>;
}

export const ESCALATION_REPOSITORY = Symbol('IEscalationRepository');
