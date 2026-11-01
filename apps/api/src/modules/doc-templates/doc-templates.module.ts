import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DOC_TEMPLATE_REFRESH_QUEUE } from '../shared/queue/queue.constants';
import { FormsModule } from '../forms/forms.module';
import { DocumentTemplateStore } from './doc-template.store';
import { DocRefreshService } from './doc-refresh.service';
import { DocRefreshProcessor } from './doc-refresh.processor';
import { DocRefreshScheduler } from './doc-refresh.scheduler';
import { DocTemplatesService } from './doc-templates.service';
import { DocTemplatesController } from './doc-templates.controller';

/**
 * Automatic official DOCUMENT delivery — checklists, photo specifications,
 * declaration templates and route guidance, cached the same way blank forms
 * already are.
 *
 * Imports FormsModule for the shared crawling primitives (RobotsGate and the
 * FORM_HTTP fetch implementation) rather than re-providing them. That is
 * deliberate: RobotsGate caches robots.txt per host for the life of the
 * process, and both jobs fetch from canada.ca. Two instances would double the
 * robots.txt traffic and could disagree about the same host after a transient
 * failure evicted one cache and not the other.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: DOC_TEMPLATE_REFRESH_QUEUE }),
    FormsModule,
  ],
  controllers: [DocTemplatesController],
  providers: [
    DocumentTemplateStore,
    DocRefreshService,
    DocRefreshProcessor,
    DocRefreshScheduler,
    DocTemplatesService,
  ],
  exports: [DocumentTemplateStore, DocRefreshService, DocTemplatesService],
})
export class DocTemplatesModule {}
