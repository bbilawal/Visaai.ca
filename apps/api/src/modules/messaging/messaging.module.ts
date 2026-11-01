import { Module } from '@nestjs/common';
import { GuardrailsModule } from '../shared/guardrails/guardrails.module';
import { MessagingController } from './messaging.controller';
import { MessagingSseController } from './messaging-sse.controller';
import { MessagingAttachmentsController } from './messaging-attachments.controller';
import { DocumentRequestController } from './document-request.controller';
import { ConsultantNotesController } from './consultant-notes.controller';
import { EscalationController } from './escalation.controller';
import { MessagingAiController } from './messaging-ai.controller';
import { MessagingService } from './messaging.service';
import { MessagingAiService } from './messaging-ai.service';
import { AttachmentService } from './attachment.service';
import { DocumentRequestService } from './document-request.service';
import { ConsultantNotesService } from './consultant-notes.service';
import { EscalationService } from './escalation.service';
import { MessagingEventBus } from './messaging-event-bus';
import { MessagingPresenceService } from './messaging-presence.service';
import { MESSAGING_REPOSITORY } from './messaging.repository';
import { MessagingRepository } from './messaging.repository.impl';
import { ATTACHMENT_REPOSITORY } from './attachment.repository';
import { AttachmentRepository } from './attachment.repository.impl';
import { DOCUMENT_REQUEST_REPOSITORY } from './document-request.repository';
import { DocumentRequestRepository } from './document-request.repository.impl';
import { CONSULTANT_NOTES_REPOSITORY } from './consultant-notes.repository';
import { ConsultantNotesRepository } from './consultant-notes.repository.impl';
import { ESCALATION_REPOSITORY } from './escalation.repository';
import { EscalationRepository } from './escalation.repository.impl';

/**
 * MessagingModule — per-application consultant↔user communication center.
 * P1 spine (conversations/messages/notifications/SSE) + P2 (attachments, voice,
 * document requests) + P3a (consultant notes, escalation, consultant_state).
 * SupabaseService + JwtGuard resolve from @Global modules.
 */
@Module({
  imports: [GuardrailsModule],
  controllers: [
    // MessagingSseController MUST precede MessagingController: its static
    // `GET /messaging/stream` would otherwise be captured by the latter's
    // `GET /messaging/:applicationId` param route (Nest registers controllers
    // in array order), routing the SSE open to getThread → "stream" cast as a
    // uuid → 500. Specific routes before param routes.
    MessagingSseController,
    MessagingController,
    MessagingAttachmentsController,
    DocumentRequestController,
    ConsultantNotesController,
    EscalationController,
    MessagingAiController,
  ],
  providers: [
    MessagingService,
    MessagingAiService,
    AttachmentService,
    DocumentRequestService,
    ConsultantNotesService,
    EscalationService,
    MessagingEventBus,
    MessagingPresenceService,
    { provide: MESSAGING_REPOSITORY, useClass: MessagingRepository },
    { provide: ATTACHMENT_REPOSITORY, useClass: AttachmentRepository },
    {
      provide: DOCUMENT_REQUEST_REPOSITORY,
      useClass: DocumentRequestRepository,
    },
    {
      provide: CONSULTANT_NOTES_REPOSITORY,
      useClass: ConsultantNotesRepository,
    },
    { provide: ESCALATION_REPOSITORY, useClass: EscalationRepository },
  ],
  exports: [MessagingService, MessagingEventBus, MessagingPresenceService],
})
export class MessagingModule {}
