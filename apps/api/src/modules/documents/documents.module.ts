import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsProcessor } from './documents.processor';
import { TranslationService } from './translation/translation.service';
import { PrefillModule } from '../prefill/prefill.module';
import { ProvenanceModule } from '../provenance/provenance.module';
import { VerificationModule } from '../verification/verification.module';
import { DOCUMENT_QUEUE } from '../shared/queue/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: DOCUMENT_QUEUE }),
    PrefillModule,
    ProvenanceModule,
    VerificationModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsProcessor, TranslationService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
