import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DocumentRequest,
  DocumentRequestPriority,
  DocumentRequestStatus,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { MessagingService, type MessagingCaller } from './messaging.service';
import { MessagingEventBus } from './messaging-event-bus';
import {
  MESSAGING_REPOSITORY,
  type IMessagingRepository,
} from './messaging.repository';
import {
  DOCUMENT_REQUEST_REPOSITORY,
  type IDocumentRequestRepository,
} from './document-request.repository';

// Valid status transitions (the actor-role guard is applied separately).
const TRANSITIONS: Record<DocumentRequestStatus, DocumentRequestStatus[]> = {
  pending: ['submitted'],
  submitted: ['under_review', 'rejected', 'approved'],
  under_review: ['approved', 'rejected'],
  approved: [],
  rejected: ['submitted'], // user re-submits after corrections (Scenario 6)
};

function isStaff(caller: MessagingCaller): boolean {
  return caller.appRole === 'consultant' || caller.appRole === 'admin';
}

@Injectable()
export class DocumentRequestService {
  constructor(
    @Inject(DOCUMENT_REQUEST_REPOSITORY)
    private readonly repo: IDocumentRequestRepository,
    @Inject(MESSAGING_REPOSITORY)
    private readonly msgRepo: IMessagingRepository,
    private readonly messaging: MessagingService,
    private readonly bus: MessagingEventBus,
    private readonly supabase: SupabaseService,
  ) {}

  async create(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
    input: {
      documentType: string;
      label: string;
      notes?: string;
      dueDate?: string;
      priority?: DocumentRequestPriority;
      checklistItemId?: string;
    },
  ): Promise<DocumentRequest> {
    if (!isStaff(caller)) {
      throw new ForbiddenException('Only consultants may request documents');
    }
    const conversation = await this.messaging.ensureConversation(
      token,
      applicationId,
    );
    const db = this.supabase.forUser(token);
    const created = await this.repo.insert(db, {
      conversationId: conversation.id,
      applicationId,
      requestedBy: caller.id,
      documentType: input.documentType,
      label: input.label,
      notes: input.notes ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? 'normal',
      checklistItemId: input.checklistItemId ?? null,
    });
    await this.fanOut(
      applicationId,
      conversation.id,
      caller.id,
      'document_request.created',
    );
    return created;
  }

  list(token: string, applicationId: string): Promise<DocumentRequest[]> {
    return this.repo.listByApplication(
      this.supabase.forUser(token),
      applicationId,
    );
  }

  async fulfill(
    token: string,
    caller: MessagingCaller,
    requestId: string,
    input: { attachmentId: string },
  ): Promise<DocumentRequest> {
    const db = this.supabase.forUser(token);
    const req = await this.repo.getById(db, requestId); // forUser read = RLS access check
    if (!req) throw new NotFoundException('Document request not found');
    if (!TRANSITIONS[req.status].includes('submitted')) {
      throw new BadRequestException(
        `Cannot fulfill a request in status '${req.status}'`,
      );
    }
    // Writes go through service-role: direct authenticated UPDATE on
    // document_requests is revoked at the grant level (anti self-approval).
    const updated = await this.repo.update(this.supabase.admin, requestId, {
      status: 'submitted',
      fulfilledAttachmentId: input.attachmentId,
    });
    await this.fanOut(
      req.application_id,
      req.conversation_id,
      caller.id,
      'document_request.updated',
    );
    return updated;
  }

  async setStatus(
    token: string,
    caller: MessagingCaller,
    requestId: string,
    status: DocumentRequestStatus,
  ): Promise<DocumentRequest> {
    if (!isStaff(caller)) {
      throw new ForbiddenException(
        'Only consultants may change request status',
      );
    }
    const db = this.supabase.forUser(token);
    const req = await this.repo.getById(db, requestId); // forUser read = RLS access check
    if (!req) throw new NotFoundException('Document request not found');
    if (!TRANSITIONS[req.status].includes(status)) {
      throw new BadRequestException(
        `Invalid transition ${req.status} -> ${status}`,
      );
    }
    // Writes go through service-role (direct authenticated UPDATE is revoked).
    const updated = await this.repo.update(this.supabase.admin, requestId, {
      status,
    });
    await this.fanOut(
      req.application_id,
      req.conversation_id,
      caller.id,
      'document_request.updated',
    );
    return updated;
  }

  private async fanOut(
    applicationId: string,
    conversationId: string,
    actorId: string,
    type: 'document_request.created' | 'document_request.updated',
  ): Promise<void> {
    const recipients = await this.messaging.recipientIds(
      applicationId,
      actorId,
    );
    await this.msgRepo.insertNotifications(
      this.supabase.admin,
      recipients.map((userId) => ({
        userId,
        type,
        conversationId,
        messageId: null,
      })),
    );
    this.bus.emit({
      type,
      conversation_id: conversationId,
      application_id: applicationId,
      recipient_ids: recipients,
    });
  }
}
