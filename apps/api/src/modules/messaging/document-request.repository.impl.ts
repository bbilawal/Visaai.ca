import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentRequest, DocumentRequestStatus } from '@visaai/types';
import {
  type IDocumentRequestRepository,
  type InsertDocumentRequestInput,
} from './document-request.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

@Injectable()
export class DocumentRequestRepository implements IDocumentRequestRepository {
  async insert(
    db: SupabaseClient,
    input: InsertDocumentRequestInput,
  ): Promise<DocumentRequest> {
    const res = await db
      .from('document_requests')
      .insert({
        conversation_id: input.conversationId,
        application_id: input.applicationId,
        requested_by: input.requestedBy,
        document_type: input.documentType,
        label: input.label,
        notes: input.notes,
        due_date: input.dueDate,
        priority: input.priority,
        checklist_item_id: input.checklistItemId,
      })
      .select('*')
      .single();
    return unwrap<DocumentRequest>(res, 'insert document_request');
  }

  async listByApplication(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<DocumentRequest[]> {
    const res = await db
      .from('document_requests')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as DocumentRequest[]) ?? [];
  }

  async getById(
    db: SupabaseClient,
    id: string,
  ): Promise<DocumentRequest | null> {
    const res = await db
      .from('document_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as DocumentRequest) ?? null;
  }

  async update(
    db: SupabaseClient,
    id: string,
    patch: {
      status?: DocumentRequestStatus;
      fulfilledAttachmentId?: string | null;
    },
  ): Promise<DocumentRequest> {
    const row: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.fulfilledAttachmentId !== undefined)
      row.fulfilled_attachment_id = patch.fulfilledAttachmentId;
    const res = await db
      .from('document_requests')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    return unwrap<DocumentRequest>(res, 'update document_request');
  }
}
