import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DocumentRequest,
  DocumentRequestPriority,
  DocumentRequestStatus,
} from '@visaai/types';

export interface InsertDocumentRequestInput {
  conversationId: string;
  applicationId: string;
  requestedBy: string;
  documentType: string;
  label: string;
  notes: string | null;
  dueDate: string | null;
  priority: DocumentRequestPriority;
  checklistItemId: string | null;
}

export interface IDocumentRequestRepository {
  insert(
    db: SupabaseClient,
    input: InsertDocumentRequestInput,
  ): Promise<DocumentRequest>;
  listByApplication(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<DocumentRequest[]>;
  getById(db: SupabaseClient, id: string): Promise<DocumentRequest | null>;
  update(
    db: SupabaseClient,
    id: string,
    patch: {
      status?: DocumentRequestStatus;
      fulfilledAttachmentId?: string | null;
    },
  ): Promise<DocumentRequest>;
}

export const DOCUMENT_REQUEST_REPOSITORY = Symbol('IDocumentRequestRepository');
