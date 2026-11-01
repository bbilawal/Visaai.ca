import { SecurityController } from '../src/modules/iam/security.controller';

/**
 * SEC-1002 regression: the unauthenticated /auth/record-login endpoint must
 * neither reset the brute-force lockout nor attribute login history to a user
 * unless the caller proves a real Supabase login with a valid token.
 */
function make(getUser: jest.Mock) {
  const security = {
    recordAttempt: jest.fn().mockResolvedValue({ locked: false }),
  };
  const supabase = { admin: { auth: { getUser } } };
  const ctrl = new SecurityController(security as never, supabase as never);
  return { ctrl, security, getUser };
}

describe('SecurityController record-login (SEC-1002)', () => {
  it('ignores an unverified success (no token) — does not reset the lockout', async () => {
    const getUser = jest.fn();
    const { ctrl, security } = make(getUser);
    const out = await ctrl.record(
      { email: 'victim@test.com', success: true },
      '1.2.3.4',
      'ua',
      undefined,
    );
    expect(out).toEqual({ locked: false });
    expect(security.recordAttempt).not.toHaveBeenCalled(); // no counter reset
    expect(getUser).not.toHaveBeenCalled();
  });

  it('ignores a success whose token email does not match the claimed email', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'u-attacker', email: 'attacker@test.com' } },
      error: null,
    });
    const { ctrl, security } = make(getUser);
    const out = await ctrl.record(
      { email: 'victim@test.com', success: true },
      '1.2.3.4',
      'ua',
      'Bearer sometoken',
    );
    expect(out).toEqual({ locked: false });
    expect(security.recordAttempt).not.toHaveBeenCalled();
  });

  it('accepts a verified success and attributes userId from the token, not the client', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'u-real', email: 'real@test.com' } },
      error: null,
    });
    const { ctrl, security } = make(getUser);
    await ctrl.record(
      { email: 'real@test.com', success: true },
      '1.2.3.4',
      'ua',
      'Bearer goodtoken',
    );
    expect(security.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'real@test.com',
        success: true,
        userId: 'u-real',
      }),
    );
  });

  it('records a failure with userId=null (never trusts the client for attribution)', async () => {
    const getUser = jest.fn();
    const { ctrl, security } = make(getUser);
    await ctrl.record(
      { email: 'victim@test.com', success: false },
      '1.2.3.4',
      'ua',
      undefined,
    );
    expect(getUser).not.toHaveBeenCalled();
    expect(security.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'victim@test.com',
        success: false,
        userId: null,
      }),
    );
  });
});
