import { Module } from '@nestjs/common';
import { ConsultantModule } from '../consultant/consultant.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ReviewItemsController } from './review-items.controller';
import { ReviewItemsService } from './review-items.service';
import { REVIEW_ITEMS_REPOSITORY } from './review-items.repository';
import { ReviewItemsRepository } from './review-items.repository.impl';

/**
 * Consultant review of every uploaded document and generated item.
 * Requires migration 20261015120000_consultant_item_reviews (application_item_reviews
 * + generated_document_revisions). AuditService via the @Global AuditModule.
 */
@Module({
  imports: [ConsultantModule, MessagingModule],
  controllers: [ReviewItemsController],
  providers: [
    ReviewItemsService,
    { provide: REVIEW_ITEMS_REPOSITORY, useClass: ReviewItemsRepository },
  ],
})
export class ReviewItemsModule {}
