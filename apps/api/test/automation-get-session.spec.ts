import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AutomationService } from '../src/modules/automation/automation.service';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { SessionTokenService } from '../src/modules/automation/session-token.service';
import type { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import type { Env } from '../src/config/configuration';

/**
 * GET /automation/session/:id (the Submit page's status poll). A failed read
 * was answered 403 "Access denied" — the page then took the applicant for
 * someone else. A read error is 503; only no row / someone else's is 403.
 */
function svc() {
  return new AutomationService(
    {} as unknown as SupabaseService,
    {} as unknown as SessionTokenService,
    {} as unknown as ExecutionEligibilityService,
    { get: jest.fn() } as unknown as ConfigService<Env>,
    { mint: () => 'exec', isValid: () => Promise.resolve(true) },
  );
}
const dbReturning = (result: { data: unknown; error: unknown }) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: jest.fn().mockResolvedValue(result) }),
      }),
    }),
  }) as unknown as SupabaseClient;

describe('AutomationService.getSession', () => {
  it('a read error is 503, not 403', async () => {
    await expect(
      svc().getSession(
        dbReturning({ data: null, error: { message: 'timeout' } }),
        's1',
        'u1',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('no row is 403', async () => {
    await expect(
      svc().getSession(dbReturning({ data: null, error: null }), 's1', 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("someone else's session is 403", async () => {
    await expect(
      svc().getSession(
        dbReturning({
          data: { id: 's1', applications: { user_id: 'other' } },
          error: null,
        }),
        's1',
        'u1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the owner gets the session', async () => {
    const row = { id: 's1', status: 'active', applications: { user_id: 'u1' } };
    await expect(
      svc().getSession(dbReturning({ data: row, error: null }), 's1', 'u1'),
    ).resolves.toEqual(row);
  });
});
