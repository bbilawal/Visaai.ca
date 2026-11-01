import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { ConsultantNote } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { MessagingService, type MessagingCaller } from './messaging.service';
import {
  CONSULTANT_NOTES_REPOSITORY,
  type IConsultantNotesRepository,
} from './consultant-notes.repository';

function isStaff(caller: MessagingCaller): boolean {
  return caller.appRole === 'consultant' || caller.appRole === 'admin';
}

/**
 * Internal consultant notes. STAFF-ONLY: the isStaff guard returns 403 for
 * users, and the consultant_notes RLS has no owner arm (defense-in-depth). All
 * access uses forUser — the RLS is the isolation boundary.
 */
@Injectable()
export class ConsultantNotesService {
  constructor(
    @Inject(CONSULTANT_NOTES_REPOSITORY)
    private readonly repo: IConsultantNotesRepository,
    private readonly messaging: MessagingService,
    private readonly supabase: SupabaseService,
  ) {}

  async create(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
    body: string,
  ): Promise<ConsultantNote> {
    if (!isStaff(caller))
      throw new ForbiddenException('Only consultants may add internal notes');
    const conversation = await this.messaging.ensureConversation(
      token,
      applicationId,
    );
    return this.repo.insert(this.supabase.forUser(token), {
      conversationId: conversation.id,
      applicationId,
      authorId: caller.id,
      body,
    });
  }

  async list(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
  ): Promise<ConsultantNote[]> {
    if (!isStaff(caller))
      throw new ForbiddenException('Only consultants may read internal notes');
    const conversation = await this.messaging.ensureConversation(
      token,
      applicationId,
    );
    return this.repo.listByConversation(
      this.supabase.forUser(token),
      conversation.id,
    );
  }

  async update(
    token: string,
    caller: MessagingCaller,
    noteId: string,
    body: string,
  ): Promise<ConsultantNote> {
    if (!isStaff(caller))
      throw new ForbiddenException('Only consultants may edit internal notes');
    return this.repo.updateBody(this.supabase.forUser(token), noteId, body);
  }
}
