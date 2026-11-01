import { ConflictException, Injectable } from '@nestjs/common';
import type {
  ActorRef,
  PreflightCheckKey,
  PreflightReview,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { IPreflightRepository } from './preflight.repository';

/**
 * Supabase-backed IPreflightRepository (preflight_reviews). The DB enforces
 * "completed requires all 6 checks + locked_diff_hash" via a CHECK constraint;
 * the all-checks VALIDATION is also done in PreflightService before markCompleted.
 * No constructor side effects.
 */
@Injectable()
export class PreflightRepository implements IPreflightRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async insert(
    applicationId: string,
    reviewer: ActorRef,
    submissionSessionId: string | null,
  ): Promise<PreflightReview> {
    const { data, error } = await this.supabase.admin
      .from('preflight_reviews')
      .insert({
        application_id: applicationId,
        submission_session_id: submissionSessionId,
        status: 'in_review',
        reviewer_id: reviewer.id,
        reviewer_role: reviewer.role,
      })
      .select('*')
      .single();
    // 23505 = the partial unique index "one in_review per application": a
    // concurrent start won the race. That is a conflict, not a server error.
    if (error?.code === '23505')
      throw new ConflictException(
        'A review is already in progress for this application. Reload to continue it.',
      );
    if (error || !data)
      throw new Error(`insert preflight failed: ${error?.message ?? 'no row'}`);
    return data;
  }

  async getActive(applicationId: string): Promise<PreflightReview | null> {
    const { data, error } = await this.supabase.admin
      .from('preflight_reviews')
      .select('*')
      .eq('application_id', applicationId)
      .in('status', ['in_review', 'completed'])
      .order('started_at', { ascending: false })
      .limit(5);
    if (error) throw new Error(`getActive failed: ${error.message}`);
    const rows = (data ?? []) as PreflightReview[];
    // At most one in_review exists (partial unique index); it always wins.
    return rows.find((r) => r.status === 'in_review') ?? rows[0] ?? null;
  }

  async getById(reviewId: string): Promise<PreflightReview | null> {
    const { data, error } = await this.supabase.admin
      .from('preflight_reviews')
      .select('*')
      .eq('id', reviewId)
      .maybeSingle();
    if (error) throw new Error(`getById failed: ${error.message}`);
    return data ?? null;
  }

  async setCheck(
    reviewId: string,
    check: PreflightCheckKey,
    value: boolean,
  ): Promise<PreflightReview> {
    const { data, error } = await this.supabase.admin
      .from('preflight_reviews')
      .update({ [check]: value })
      .eq('id', reviewId)
      .eq('status', 'in_review')
      .select('*')
      .single();
    if (error || !data)
      throw new Error(`setCheck failed: ${error?.message ?? 'no row'}`);
    return data;
  }

  async markCompleted(
    reviewId: string,
    lockedDiffHash: string,
    completedAt: string,
    reviewer: ActorRef,
  ): Promise<PreflightReview> {
    const { data, error } = await this.supabase.admin
      .from('preflight_reviews')
      .update({
        status: 'completed',
        locked_diff_hash: lockedDiffHash,
        completed_at: completedAt,
        reviewer_id: reviewer.id,
        reviewer_role: reviewer.role,
      })
      .eq('id', reviewId)
      .eq('status', 'in_review')
      .select('*')
      .single();
    if (error || !data)
      throw new Error(`markCompleted failed: ${error?.message ?? 'no row'}`);
    return data;
  }

  async markInvalidated(reviewId: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('preflight_reviews')
      .update({
        status: 'invalidated',
        invalidated_at: new Date().toISOString(),
      })
      .eq('id', reviewId);
    if (error) throw new Error(`markInvalidated failed: ${error.message}`);
  }
}
