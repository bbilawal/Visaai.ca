import { Inject, Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SupabaseModule } from '../src/modules/shared/supabase/supabase.module';
import { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import { AuditModule } from '../src/modules/audit/audit.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceModule } from '../src/modules/provenance/provenance.module';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { VerificationModule } from '../src/modules/verification/verification.module';
import { VerificationService } from '../src/modules/verification/verification.service';
import { ConsultantModule } from '../src/modules/consultant/consultant.module';
// ARCH-003: the assignment event bus moved out of `realtime` into its own
// module to break the consultant <-> realtime cycle. It is @Global, so the
// composition lists it directly rather than inheriting it transitively.
import { EventBusModule } from '../src/modules/event-bus/event-bus.module';
import { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import { PreflightModule } from '../src/modules/preflight/preflight.module';
import { PreflightService } from '../src/modules/preflight/preflight.service';
import { EligibilityModule } from '../src/modules/eligibility/eligibility.module';
import { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import { AUDIT_REPOSITORY } from '../src/modules/audit/audit.repository';

/**
 * Phase 2C smoke test — proves the Gate 2 DI graph BOOTS: every repository
 * binds, every service resolves, no circular dependency, no constructor side
 * effect. SupabaseService is mocked so no env/network is required.
 */
describe('Phase 2C — Gate 2 DI graph', () => {
  async function boot() {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        SupabaseModule,
        AuditModule,
        ProvenanceModule,
        VerificationModule,
        EventBusModule,
        ConsultantModule,
        PreflightModule,
        EligibilityModule,
      ],
    })
      .overrideProvider(SupabaseService)
      .useValue({ admin: {}, forUser: () => ({}) })
      .compile();
  }

  it('boots and resolves all six Gate 2 services', async () => {
    const moduleRef = await boot();

    expect(moduleRef.get(AuditService)).toBeDefined();
    expect(moduleRef.get(ProvenanceService)).toBeDefined();
    expect(moduleRef.get(VerificationService)).toBeDefined();
    expect(moduleRef.get(ConsultantApprovalService)).toBeDefined();
    expect(moduleRef.get(PreflightService)).toBeDefined();
    expect(moduleRef.get(ExecutionEligibilityService)).toBeDefined();

    await moduleRef.close();
  });

  it('forbids other modules from injecting the audit repository (write enforcement)', async () => {
    // A foreign module imports AuditModule and tries to inject the audit repo.
    // AUDIT_REPOSITORY is NOT exported, so Nest must fail to resolve the graph.
    @Injectable()
    class AuditBypassProbe {
      constructor(@Inject(AUDIT_REPOSITORY) public readonly repo: unknown) {}
    }
    @Module({ imports: [AuditModule], providers: [AuditBypassProbe] })
    class ProbeModule {}

    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          SupabaseModule,
          ProbeModule,
        ],
      })
        .overrideProvider(SupabaseService)
        .useValue({ admin: {}, forUser: () => ({}) })
        .compile(),
    ).rejects.toThrow();
  });
});
