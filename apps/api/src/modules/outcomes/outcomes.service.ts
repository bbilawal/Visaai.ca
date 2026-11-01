import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Outcome = 'approved' | 'refused' | 'withdrawn' | 'pending';

export interface ReportOutcomeInput {
  outcome: Outcome;
  decidedAt?: string | null; // YYYY-MM-DD
  refusalReasons?: string[]; // fixed-list codes only, never free text
}

// Fixed list so refusal_reasons never carries free-text PII.
const ALLOWED_REFUSAL_REASONS = new Set([
  'insufficient_funds',
  'weak_home_ties',
  'travel_history',
  'purpose_unclear',
  'inconsistent_info',
  'incomplete_docs',
  'other',
]);

@Injectable()
export class OutcomesService {
  /**
   * Records a self-reported decision. Uses the caller's RLS-scoped client
   * (F1) so the row can only be written under the user's own RLS context.
   */
  async report(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    input: ReportOutcomeInput,
  ) {
    const reasons = (input.refusalReasons ?? []).filter((r) =>
      ALLOWED_REFUSAL_REASONS.has(r),
    );

    const { data, error } = await db
      .from('application_outcomes')
      .upsert(
        {
          application_id: applicationId,
          user_id: userId,
          outcome: input.outcome,
          decided_at: input.decidedAt ?? null,
          refusal_reasons: reasons.length ? reasons : null,
        },
        { onConflict: 'application_id' },
      )
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async get(db: SupabaseClient, applicationId: string) {
    const { data } = await db
      .from('application_outcomes')
      .select('*')
      .eq('application_id', applicationId)
      .maybeSingle();
    return data;
  }
}
