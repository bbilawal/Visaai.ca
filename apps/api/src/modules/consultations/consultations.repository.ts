import type { SupabaseClient } from '@supabase/supabase-js';
import type { Consultation } from '@visaai/types';
import type { WorkingHours } from './slots';

export interface ConsultantSchedule {
  consultantId: string;
  timezone: string;
  workingHours: WorkingHours;
  acceptingNew: boolean;
}

export interface CreateConsultationInput {
  consultantId: string;
  userId: string;
  applicationId: string | null;
  provider: 'zoom' | 'google_meet' | 'ms_teams';
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
}

export interface IConsultationsRepository {
  /** Availability row + accepting_new flag, or null when the consultant has none. */
  getSchedule(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantSchedule | null>;
  /** Live (requested/confirmed) bookings for a consultant inside a window. */
  listBusy(
    db: SupabaseClient,
    consultantId: string,
    from: string,
    to: string,
  ): Promise<{ start: string; end: string }[]>;
  create(
    db: SupabaseClient,
    input: CreateConsultationInput,
  ): Promise<Consultation>;
  listForUser(db: SupabaseClient, userId: string): Promise<Consultation[]>;
  getById(db: SupabaseClient, id: string): Promise<Consultation | null>;
  updateStatus(
    db: SupabaseClient,
    id: string,
    status: string,
  ): Promise<Consultation>;
  reschedule(
    db: SupabaseClient,
    id: string,
    times: { scheduledStart: string; scheduledEnd: string; timezone: string },
  ): Promise<Consultation>;
}

export const CONSULTATIONS_REPOSITORY = Symbol('IConsultationsRepository');
