import type { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AutomationService } from '../src/modules/automation/automation.service';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { SessionTokenService } from '../src/modules/automation/session-token.service';
import type { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import { TokenValidator } from '../src/modules/eligibility/token-validator.adapter';
import type { Env } from '../src/config/configuration';

/**
 * Prod 2026-10-15: POST /execution/request always answered token_invalid.
 * createSession handed back only the Redis connect token (a random UUID), but
 * the eligibility gate validates an HMAC execution token bound to
 * session/app/user — which nothing minted at session setup.
 */
describe('createSession mints the execution token the gate validates', () => {
  it('returns an executionToken that TokenValidator accepts', async () => {
    const session = { id: 'sess-1', application_id: 'app-1', status: 'pending' };
    const admin = {
      from: (t: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 'p' }] }) }),
            }),
            maybeSingle: () =>
              Promise.resolve({
                data: t === 'submission_sessions' ? session : null,
                error: null,
              }),
          }),
        }),
      }),
    };
    const supabase = { admin } as unknown as SupabaseService;
    const db = {
      from: (t: string) =>
        t === 'applications'
          ? { select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'app-1' } }) }) }) }) }
          : { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'sess-1' }, error: null }) }) }) },
    } as unknown as SupabaseClient;
    const config = {
      get: (k: string) => (k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'secret' : undefined),
    } as unknown as ConfigService<Env>;
    const validator = new TokenValidator(config, supabase);
    const svc = new AutomationService(
      supabase,
      { mint: async () => 'connect-uuid' } as unknown as SessionTokenService,
      {} as unknown as ExecutionEligibilityService,
      config,
      validator,
    );

    const out = await svc.createSession(db, 'app-1', 'user-1');

    expect(out.token).toBe('connect-uuid');
    expect(
      await validator.isValid(out.executionToken, 'sess-1', 'app-1', 'user-1'),
    ).toBe(true);
    expect(await validator.isValid(out.token, 'sess-1', 'app-1', 'user-1')).toBe(false);
  });
});
