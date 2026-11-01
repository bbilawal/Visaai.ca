import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { SupabaseModule } from '../shared/supabase/supabase.module';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AiModule } from '../shared/ai/ai.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { PreflightModule } from '../preflight/preflight.module';
import { PreflightFieldEditService } from '../preflight/preflight-field-edit.service';

/** PrefillModule imports PreflightModule only for the form-saved hook; stub it
 * so this spec keeps compiling PrefillModule's own graph, not the whole app. */
@Module({
  providers: [{ provide: PreflightFieldEditService, useValue: {} }],
  exports: [PreflightFieldEditService],
})
class PreflightStubModule {}
import { FormTemplateStore } from '../forms/form-template.store';
import { PrefillModule } from './prefill.module';
import { PrefillService } from './prefill.service';

/**
 * DI regression guard.
 *
 * Task 10 gave `PrefillModule` an injected constructor
 * (`FormTemplateStore`) and an `OnModuleInit` hook that wires the IMM 5257
 * template loader at boot. `FormTemplateStore` is exported by `FormsModule`,
 * so `PrefillModule` must import `FormsModule` or Nest cannot resolve the
 * dependency and the app fails to boot with "Nest can't resolve dependencies
 * of PrefillModule ... FormTemplateStore".
 *
 * `di-graph.spec.ts` (Phase 2C — Gate 2) imports a fixed module subset and
 * references neither `PrefillModule` nor `AppModule`, so it cannot catch
 * this. This file exists specifically to close that gap, mirroring
 * `forms.module.spec.ts`'s pattern.
 *
 * `EntitlementModule` is required here for the same reason it is in
 * `forms.module.spec.ts`: `PrefillController` carries `@UseGuards(JwtGuard,
 * PlanGuard)`, and `PlanGuard`'s constructor needs `EntitlementService`. In
 * the real app `EntitlementModule` is `@Global` and registered once by
 * `AppModule`, but this isolated test graph has no `AppModule`, so it must
 * supply that `@Global` module itself.
 *
 * `AiModule` is required because `PrefillService` injects `AiUsageMeter`,
 * which `AiModule` provides `@Global`ly in the real app.
 */
describe('PrefillModule DI graph', () => {
  it('boots and resolves PrefillService and FormTemplateStore', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // FormsModule (imported by PrefillModule) registers its own BullMQ
        // queue; forRoot only needs connection config, no live Redis is
        // required to compile the graph and resolve providers.
        BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
        SupabaseModule,
        AiModule,
        EntitlementModule,
        PrefillModule,
      ],
    })
      .overrideModule(PreflightModule)
      .useModule(PreflightStubModule)
      .overrideProvider(SupabaseService)
      .useValue({ admin: {}, forUser: () => ({}) })
      .compile();

    expect(moduleRef.get(PrefillService)).toBeInstanceOf(PrefillService);
    expect(moduleRef.get(FormTemplateStore)).toBeInstanceOf(FormTemplateStore);

    await moduleRef.close();
  });
});
