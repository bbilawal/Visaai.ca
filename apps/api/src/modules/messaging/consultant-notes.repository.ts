import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsultantNote } from '@visaai/types';

export interface InsertNoteInput {
  conversationId: string;
  applicationId: string;
  authorId: string;
  body: string;
}

export interface IConsultantNotesRepository {
  insert(db: SupabaseClient, input: InsertNoteInput): Promise<ConsultantNote>;
  listByConversation(
    db: SupabaseClient,
    conversationId: string,
  ): Promise<ConsultantNote[]>;
  updateBody(
    db: SupabaseClient,
    noteId: string,
    body: string,
  ): Promise<ConsultantNote>;
}

export const CONSULTANT_NOTES_REPOSITORY = Symbol('IConsultantNotesRepository');
