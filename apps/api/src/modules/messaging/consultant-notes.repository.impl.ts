import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsultantNote } from '@visaai/types';
import {
  type IConsultantNotesRepository,
  type InsertNoteInput,
} from './consultant-notes.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

@Injectable()
export class ConsultantNotesRepository implements IConsultantNotesRepository {
  async insert(
    db: SupabaseClient,
    input: InsertNoteInput,
  ): Promise<ConsultantNote> {
    const res = await db
      .from('consultant_notes')
      .insert({
        conversation_id: input.conversationId,
        application_id: input.applicationId,
        author_id: input.authorId,
        body: input.body,
      })
      .select('*')
      .single();
    return unwrap<ConsultantNote>(res, 'insert note');
  }

  async listByConversation(
    db: SupabaseClient,
    conversationId: string,
  ): Promise<ConsultantNote[]> {
    const res = await db
      .from('consultant_notes')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as ConsultantNote[]) ?? [];
  }

  async updateBody(
    db: SupabaseClient,
    noteId: string,
    body: string,
  ): Promise<ConsultantNote> {
    const res = await db
      .from('consultant_notes')
      .update({ body, edited_at: new Date().toISOString() })
      .eq('id', noteId)
      .select('*')
      .single();
    return unwrap<ConsultantNote>(res, 'update note');
  }
}
