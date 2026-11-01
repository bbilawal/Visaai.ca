import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageAttachment, VoiceMessage } from '@visaai/types';
import {
  type IAttachmentRepository,
  type InsertAttachmentInput,
  type InsertVoiceInput,
} from './attachment.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

@Injectable()
export class AttachmentRepository implements IAttachmentRepository {
  async insertAttachment(
    db: SupabaseClient,
    input: InsertAttachmentInput,
  ): Promise<MessageAttachment> {
    const res = await db
      .from('message_attachments')
      .insert({
        message_id: input.messageId,
        conversation_id: input.conversationId,
        storage_path: input.storagePath,
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        kind: input.kind,
      })
      .select('*')
      .single();
    return unwrap<MessageAttachment>(res, 'insertAttachment');
  }

  async insertVoice(
    db: SupabaseClient,
    input: InsertVoiceInput,
  ): Promise<VoiceMessage> {
    const res = await db
      .from('voice_messages')
      .insert({
        message_id: input.messageId,
        conversation_id: input.conversationId,
        storage_path: input.storagePath,
        mime_type: input.mimeType,
        duration_ms: input.durationMs,
        size_bytes: input.sizeBytes,
      })
      .select('*')
      .single();
    return unwrap<VoiceMessage>(res, 'insertVoice');
  }

  async getAttachment(
    db: SupabaseClient,
    attachmentId: string,
  ): Promise<MessageAttachment | null> {
    const res = await db
      .from('message_attachments')
      .select('*')
      .eq('id', attachmentId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as MessageAttachment) ?? null;
  }

  async getVoice(
    db: SupabaseClient,
    voiceId: string,
  ): Promise<VoiceMessage | null> {
    const res = await db
      .from('voice_messages')
      .select('*')
      .eq('id', voiceId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as VoiceMessage) ?? null;
  }
}
