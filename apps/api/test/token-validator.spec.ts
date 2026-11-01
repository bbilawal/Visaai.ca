import type { ConfigService } from '@nestjs/config';
import { TokenValidator } from '../src/modules/eligibility/token-validator.adapter';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { Env } from '../src/config/configuration';

const APP = 'app-1';
const SESSION = 'sess-1';
const USER = 'u1';

const config = { get: () => 'unit-secret' } as unknown as ConfigService<Env>;

/** Supabase mock whose submission_sessions row is configurable. */
function supa(row: { application_id: string; status: string } | null) {
  return {
    admin: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
      }),
    },
  } as unknown as SupabaseService;
}

function make(
  row: { application_id: string; status: string } | null = {
    application_id: APP,
    status: 'active',
  },
) {
  return new TokenValidator(config, supa(row));
}

describe('TokenValidator (Phase 6B)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('valid token passes', async () => {
    const v = make();
    const token = v.mint(SESSION, APP, USER);
    expect(await v.isValid(token, SESSION, APP, USER)).toBe(true);
  });

  it('missing token fails', async () => {
    const v = make();
    expect(await v.isValid('', SESSION, APP, USER)).toBe(false);
  });

  it('expired token fails', async () => {
    const v = make();
    const token = v.mint(SESSION, APP, USER); // issuedAt = now
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000); // +31 min > TTL
    expect(await v.isValid(token, SESSION, APP, USER)).toBe(false);
  });

  it('revoked / terminal session fails', async () => {
    const v = make({ application_id: APP, status: 'complete' });
    const token = v.mint(SESSION, APP, USER);
    expect(await v.isValid(token, SESSION, APP, USER)).toBe(false);
  });

  it('missing session row fails', async () => {
    const v = make(null);
    const token = v.mint(SESSION, APP, USER);
    expect(await v.isValid(token, SESSION, APP, USER)).toBe(false);
  });

  it('mismatched application fails (signature binding)', async () => {
    const v = make();
    const token = v.mint(SESSION, APP, USER); // bound to app-1
    expect(await v.isValid(token, SESSION, 'app-2', USER)).toBe(false);
  });

  it('mismatched application fails (DB binding)', async () => {
    const v = make({ application_id: 'other-app', status: 'active' });
    const token = v.mint(SESSION, APP, USER);
    expect(await v.isValid(token, SESSION, APP, USER)).toBe(false);
  });

  it('tampered token fails', async () => {
    const v = make();
    const token = v.mint(SESSION, APP, USER);
    expect(await v.isValid(token.slice(0, -2) + 'xx', SESSION, APP, USER)).toBe(
      false,
    );
  });

  it('session-id mismatch fails', async () => {
    const v = make();
    const token = v.mint(SESSION, APP, USER);
    expect(await v.isValid(token, 'other-session', APP, USER)).toBe(false);
  });

  it('replay-compatible: validates repeatedly without consuming (no single-use here)', async () => {
    const v = make();
    const token = v.mint(SESSION, APP, USER);
    expect(await v.isValid(token, SESSION, APP, USER)).toBe(true);
    expect(await v.isValid(token, SESSION, APP, USER)).toBe(true); // idempotent
  });
});
