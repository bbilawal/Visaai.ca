import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  FORM_REFRESH_QUEUE,
  TEMPLATE_SWEEP_QUEUE,
} from '../shared/queue/queue.constants';
import { defaultHttp, type FetchLike } from './http';
import { RobotsGate } from './robots';
import { FormTemplateStore } from './form-template.store';
import { TemplateRevisionStore } from './template-revision.store';
import { TemplateHealthService } from './template-health.service';
import { FormRefreshService, FORM_HTTP } from './form-refresh.service';
import { FormRefreshProcessor } from './form-refresh.processor';
import { FormRefreshScheduler } from './form-refresh.scheduler';
import { TemplateSweepService } from './sweep/sweep.service';
import { TemplateSweepProcessor } from './sweep/sweep.processor';
import { TemplateSweepScheduler } from './sweep/sweep.scheduler';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';
import { TemplateOpsController } from './template-ops.controller';

/**
 * Automatic official-form delivery, plus the shared machinery both caches use:
 * the robots gate, the fetch identity, the revision ledger, the health
 * watchdog, and the weekly new-artifact sweep.
 *
 * SupabaseService and NotificationEventBus resolve from @Global scope; the
 * jobs run on the global BullMQ connection (QueueModule).
 *
 * The fetch implementation is a token, not a default parameter: Nest reads
 * design:paramtypes regardless of defaults, and a `FetchLike` interface erases
 * to Object, which it cannot resolve. Injecting it also means a test or a
 * future per-portal transport can swap it without touching the service.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: FORM_REFRESH_QUEUE }),
    BullModule.registerQueue({ name: TEMPLATE_SWEEP_QUEUE }),
  ],
  controllers: [FormsController, TemplateOpsController],
  providers: [
    { provide: FORM_HTTP, useValue: defaultHttp },
    {
      provide: RobotsGate,
      useFactory: (http: FetchLike) => new RobotsGate(http),
      inject: [FORM_HTTP],
    },
    FormTemplateStore,
    TemplateRevisionStore,
    TemplateHealthService,
    FormRefreshService,
    FormRefreshProcessor,
    FormRefreshScheduler,
    TemplateSweepService,
    TemplateSweepProcessor,
    TemplateSweepScheduler,
    FormsService,
  ],
  // RobotsGate and FORM_HTTP are exported so the document-template job shares
  // ONE robots.txt cache and one fetch identity with this one. Both jobs crawl
  // canada.ca; two gates would double that host's robots.txt traffic and could
  // disagree about it after a transient failure evicted one cache and not the
  // other. TemplateRevisionStore and TemplateHealthService are exported for the
  // same reason — one ledger, one watchdog, both caches.
  exports: [
    FormTemplateStore,
    FormRefreshService,
    FormsService,
    RobotsGate,
    FORM_HTTP,
    TemplateRevisionStore,
    TemplateHealthService,
  ],
})
export class FormsModule {}
