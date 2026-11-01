import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { SupabaseModule } from '../shared/supabase/supabase.module';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { DocTemplatesModule } from './doc-templates.module';
import { DocRefreshService } from './doc-refresh.service';
import { DocTemplatesService } from './doc-templates.service';
import { DocumentTemplateStore } from './doc-template.store';
import { DocRefreshProcessor } from './doc-refresh.processor';

/**
 * DI regression guard for the CROSS-MODULE wiring.
 *
 * This module deliberately does not re-provide the crawling primitives: it
 * imports FormsModule for RobotsGate, the FORM_HTTP fetch identity, the shared
 * revision ledger and the health watchdog, so that both caches share one
 * robots.txt cache, one ledger and one watchdog. That only works while
 * FormsModule keeps EXPORTING them — drop any one export and the app fails at
 * boot on the VPS with "Nest can't resolve dependencies of DocRefreshService".
 *
 * forms.module.spec.ts cannot catch that: it compiles FormsModule alone, where
 * an unexported provider still resolves internally. This test is the one that
 * fails in CI instead.
 */
describe('DocTemplatesModule DI graph', () => {
  it('resolves its providers through FormsModule exports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // Both modules register their own BullMQ queues; forRoot only supplies
        // connection config — no live Redis is needed to compile the graph.
        BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
        SupabaseModule,
        // PlanGuard on the controller needs EntitlementService, which is
        // @Global in the real app but must be supplied explicitly here.
        EntitlementModule,
        DocTemplatesModule,
      ],
    })
      .overrideProvider(SupabaseService)
      .useValue({ admin: {}, forUser: () => ({}) })
      .compile();

    expect(moduleRef.get(DocRefreshService)).toBeInstanceOf(DocRefreshService);
    expect(moduleRef.get(DocTemplatesService)).toBeInstanceOf(
      DocTemplatesService,
    );
    expect(moduleRef.get(DocumentTemplateStore)).toBeInstanceOf(
      DocumentTemplateStore,
    );
    // The processor is where the health watchdog is injected, so resolving it
    // proves TemplateHealthService crossed the module boundary too.
    expect(moduleRef.get(DocRefreshProcessor)).toBeInstanceOf(
      DocRefreshProcessor,
    );

    await moduleRef.close();
  });
});
