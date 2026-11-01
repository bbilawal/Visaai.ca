import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EscalationRecord, EscalationType } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { MessagingService, type MessagingCaller } from './messaging.service';
import {
  ESCALATION_REPOSITORY,
  type IEscalationRepository,
} from './escalation.repository';

function isStaff(caller: MessagingCaller): boolean {
  return caller.appRole === 'consultant' || caller.appRole === 'admin';
}

@Injectable()
export class EscalationService {
  constructor(
    @Inject(ESCALATION_REPOSITORY) private readonly repo: IEscalationRepository,
    private readonly messaging: MessagingService,
    private readonly supabase: SupabaseService,
  ) {}

  async escalate(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
    input: { type: EscalationType; reason: string },
  ): Promise<EscalationRecord> {
    if (!isStaff(caller))
      throw new ForbiddenException('Only consultants may escalate');
    const conversation = await this.messaging.ensureConversation(
      token,
      applicationId,
    );
    return this.repo.insert(this.supabase.forUser(token), {
      conversationId: conversation.id,
      applicationId,
      escalatedBy: caller.id,
      escalationType: input.type,
      reason: input.reason,
    });
  }

  async list(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
  ): Promise<EscalationRecord[]> {
    if (!isStaff(caller))
      throw new ForbiddenException('Only consultants may view escalations');
    return this.repo.listByApplication(
      this.supabase.forUser(token),
      applicationId,
    );
  }

  async resolve(
    token: string,
    caller: MessagingCaller,
    escalationId: string,
  ): Promise<EscalationRecord> {
    if (!isStaff(caller))
      throw new ForbiddenException('Only consultants may resolve escalations');
    const db = this.supabase.forUser(token);
    const rec = await this.repo.getById(db, escalationId);
    if (!rec) throw new NotFoundException('Escalation not found');
    if (rec.status !== 'open')
      throw new BadRequestException(`Escalation is already ${rec.status}`);
    return this.repo.markResolved(db, escalationId, caller.id);
  }
}
