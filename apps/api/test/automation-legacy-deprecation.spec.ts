import type { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AutomationService } from '../src/modules/automation/automation.service';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { SessionTokenService } from '../src/modules/automation/session-token.service';
import type { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import type { Env } from '../src/config/configuration';

function svcWithFlag(flag: boolean | undefined) {
  const config = {
    get: jest.fn().mockReturnValue(flag),
  } as unknown as ConfigService<Env>;
  return new AutomationService(
    {} as unknown as SupabaseService,
    {} as unknown as SessionTokenService,
    {} as unknown as ExecutionEligibilityService,
    config,
    { mint: () => 'exec', isValid: async () => true },
  );
}

describe('Phase 4B — legacy automation deprecation', () => {
  it('legacy write is OFF by default (flag undefined / not "true")', () => {
    expect(svcWithFlag(undefined).legacyWriteEnabled()).toBe(false);
    expect(svcWithFlag(false).legacyWriteEnabled()).toBe(false);
  });

  // Phase 7J's verified path (portal-fill:start) authenticates its socket with
  // the session token createSession mints, so minting must NOT be gated as
  // legacy — it was, and every launch got 410 in prod (2026-10-15). Minting
  // writes nothing to a portal; buildInstructions/automation:start stay gated.
  it('createSession is NOT legacy-gated: it reaches the ownership check', async () => {
    const svc = svcWithFlag(false);
    const single = jest.fn().mockResolvedValue({ data: null });
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single }) }) }) }),
    } as unknown as SupabaseClient;
    await expect(svc.createSession(db, 'app-1', 'user-1')).rejects.toThrow(
      'Access denied',
    );
    expect(single).toHaveBeenCalled();
  });

  it('buildInstructions is hard-deprecated when legacy write is off (no plan built)', async () => {
    const svc = svcWithFlag(false);
    await expect(svc.buildInstructions('app-1')).rejects.toThrow(
      'LEGACY_EXECUTION_DEPRECATED',
    );
  });

  it('flag reflects explicit enable', () => {
    expect(svcWithFlag(true).legacyWriteEnabled()).toBe(true);
  });
});
