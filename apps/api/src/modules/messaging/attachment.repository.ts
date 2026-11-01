import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AttachmentKind,
  MessageAttachment,
  VoiceMessage,
} from '@visaai/types';

export interface InsertAttachmentInput {
  messageId: string;
  conversationId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
}

export interface InsertVoiceInput {
  messageId: string;
  conversationId: string;
  storagePath: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
}

export interface IAttachmentRepository {
  insertAttachment(
    db: SupabaseClient,
    input: InsertAttachmentInput,
  ): Promise<MessageAttachment>;
  insertVoice(
    db: SupabaseClient,
    input: InsertVoiceInput,
  ): Promise<VoiceMessage>;
  /** Fetch one attachment (RLS-scoped). Returns null if not visible to caller. */
  getAttachment(
    db: SupabaseClient,
    attachmentId: string,
  ): Promise<MessageAttachment | null>;
  getVoice(db: SupabaseClient, voiceId: string): Promise<VoiceMessage | null>;
}

export const ATTACHMENT_REPOSITORY = Symbol('IAttachmentRepository');
