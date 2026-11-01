import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Consultation } from '@visaai/types';
import type {
  ConsultantSchedule,
  CreateConsultationInput,
  IConsultationsRepository,
} from './consultations.repository';

const LIVE_STATUSES = ['requested', 'confirmed'];

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

@Injectable()
export class ConsultationsRepository implements IConsultationsRepository {
  async getSchedule(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantSchedule | null> {
    const res = await db
      .from('consultant_availability')
      .select('consultant_id, timezone, working_hours, accepting_new')
      .eq('consultant_id', consultantId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    if (!res.data) return null;
    const row = res.data;
    return {
      consultantId: row.consultant_id,
      timezone: row.timezone ?? 'UTC',
      workingHours: row.working_hours ?? {},
      acceptingNew: row.accepting_new ?? false,
    };
  }

  async listBusy(
    db: SupabaseClient,
    consultantId: string,
    from: string,
    to: string,
  ): Promise<{ start: string; end: string }[]> {
    // Any booking that *overlaps* the window matters, including one that starts
    // before it — hence start < to AND end > from rather than a naive between.
    const res = await db
      .from('consultations')
      .select('scheduled_start, scheduled_end')
      .eq('consultant_id', consultantId)
      .in('status', LIVE_STATUSES)
      .lt('scheduled_start', to)
      .gt('scheduled_end', from);
    if (res.error) throw new Error(res.error.message);
    return (
      (res.data ?? []) as { scheduled_start: string; scheduled_end: string }[]
    ).map((r) => ({
      start: r.scheduled_start,
      end: r.scheduled_end,
    }));
  }

  async create(
    db: SupabaseClient,
    input: CreateConsultationInput,
  ): Promise<Consultation> {
    const res = await db
      .from('consultations')
      .insert({
        consultant_id: input.consultantId,
        user_id: input.userId,
        application_id: input.applicationId,
        provider: input.provider,
        scheduled_start: input.scheduledStart,
        scheduled_end: input.scheduledEnd,
        timezone: input.timezone,
        status: 'requested',
      })
      .select('*')
      .single();
    return unwrap<Consultation>(res, 'create consultation');
  }

  async listForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<Consultation[]> {
    const res = await db
      .from('consultations')
      .select('*')
      .eq('user_id', userId)
      .order('scheduled_start', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as Consultation[]) ?? [];
  }

  async getById(db: SupabaseClient, id: string): Promise<Consultation | null> {
    // RLS (consultations_participant_read) is what limits this to the caller's
    // own bookings — a non-participant simply sees no row.
    const res = await db
      .from('consultations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as Consultation | null) ?? null;
  }

  async updateStatus(
    db: SupabaseClient,
    id: string,
    status: string,
  ): Promise<Consultation> {
    const res = await db
      .from('consultations')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();
    return unwrap<Consultation>(res, 'update consultation status');
  }

  async reschedule(
    db: SupabaseClient,
    id: string,
    times: { scheduledStart: string; scheduledEnd: string; timezone: string },
  ): Promise<Consultation> {
    const res = await db
      .from('consultations')
      .update({
        scheduled_start: times.scheduledStart,
        scheduled_end: times.scheduledEnd,
        timezone: times.timezone,
        // A moved meeting needs the consultant to re-confirm.
        status: 'requested',
      })
      .eq('id', id)
      .select('*')
      .single();
    return unwrap<Consultation>(res, 'reschedule consultation');
  }
}
