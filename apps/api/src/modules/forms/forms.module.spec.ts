import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { SupabaseModule } from '../shared/supabase/supabase.module';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { FormsModule } from './forms.module';
import { FormRefreshService } from './form-refresh.service';
import { FormTemplateStore } from './form-template.store';

/**
 * DI regression guard.
 *
 * `FormRefreshService` cannot take `RobotsGate`/`FetchLike` as constructor
 * defaults on a Nest-managed provider: Nest reads `design:paramtypes`
 * regardless of default values, tries to resolve `RobotsGate` as a provider,
 * and cannot resolve `FetchLike` at all (an interface erases to `Object`).
 * The app fails to boot with "Nest can't resolve dependencies of
 * FormRefreshService" if that mistake creeps back in. This test actually
 * compiles `FormsModule`'s real provider graph — including the `FORM_HTTP`
 * token and the `RobotsGate` factory provider — so a regression fails here
 * in CI instead of at boot on the VPS.
 *
 * `di-graph.spec.ts` (Phase 2C — Gate 2) does not import `FormsModule`, so it
 * cannot catch this; this file exists specifically to close that gap.
 */
describe('FormsModule DI graph', () => {
  it('boots and resolves FormRefreshService and FormTemplateStore', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // FormsModule registers its own BullMQ queue; forRoot only needs to
        // supply connection config, no live Redis is required to compile the
        // graph and resolve providers.
        BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
        SupabaseModule,
        // Task 8 added FormsController with @UseGuards(JwtGuard, PlanGuard).
        // PlanGuard's constructor needs EntitlementService. In the real app
        // EntitlementModule is @Global and registered once by AppModule, so
        // every module (including FormsModule) resolves it without an
        // explicit import — this isolated test graph has no AppModule, so it
        // must supply that @Global module itself or compile() throws "Nest
        // can't resolve dependencies of PlanGuard ... EntitlementService".
        EntitlementModule,
        FormsModule,
      ],
    })
      .overrideProvider(SupabaseService)
      .useValue({ admin: {}, forUser: () => ({}) })
      .compile();

    expect(moduleRef.get(FormRefreshService)).toBeInstanceOf(
      FormRefreshService,
    );
    expect(moduleRef.get(FormTemplateStore)).toBeInstanceOf(FormTemplateStore);

    await moduleRef.close();
  });
});
