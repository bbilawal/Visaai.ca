import { SecurityService } from './security.service';
import { MAX_FAILED_ATTEMPTS } from './iam.engine';
import type { IIamRepository } from './iam.repository';

function makeRepo(over: Partial<IIamRepository> = {}): IIamRepository {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected repo call: ${n}`);
  };
  return new Proxy(over as IIamRepository, {
    get(target, prop: string) {
      return prop in target
        ? (target as unknown as Record<string, unknown>)[prop]
        : notImpl(prop);
    },
  });
}

const NOW = new Date('2026-06-28T12:00:00Z');

describe('SecurityService', () => {
  describe('lockoutStatus', () => {
    it('reports locked when locked_until is in the future', async () => {
      const future = new Date(NOW.getTime() + 60_000).toISOString();
      const svc = new SecurityService(
        makeRepo({
          getLockout: jest.fn().mockResolvedValue({
            email: 'a@b.c',
            failed_count: 0,
            locked_until: future,
          }),
        }),
      );
      const out = await svc.lockoutStatus('a@b.c', '1.2.3.4', NOW);
      expect(out.locked).toBe(true);
      expect(out.retry_after_minutes).toBeGreaterThan(0);
    });

    it('reports unlocked when no lockout', async () => {
      const svc = new SecurityService(
        makeRepo({
          getLockout: jest.fn().mockResolvedValue(null),
          getEmailWideLockout: jest
            .fn()
            .mockResolvedValue({ failed_total: 0, locked_until: null }),
        }),
      );
      expect(await svc.lockoutStatus('a@b.c', '1.2.3.4', NOW)).toEqual({
        locked: false,
        retry_after_minutes: null,
      });
    });
  });

  describe('recordAttempt', () => {
    it('success records login + resets lockout, no lock', async () => {
      const upsertLockout = jest.fn().mockResolvedValue(undefined);
      const recordLogin = jest.fn().mockResolvedValue(undefined);
      const recordAuthEvent = jest.fn().mockResolvedValue(undefined);
      const svc = new SecurityService(
        makeRepo({
          recordLogin,
          getLockout: jest
            .fn()
            .mockResolvedValue({ failed_count: 3, locked_until: null }),
          upsertLockout,
          recordAuthEvent,
        }),
      );
      const out = await svc.recordAttempt(
        { email: 'a@b.c', success: true, userId: 'u1', ip: '1.2.3.4' },
        NOW,
      );
      expect(out.locked).toBe(false);
      expect(recordLogin).toHaveBeenCalled();
      // SEC-001: the lockout row is keyed on (email, ip), so the address is
      // part of the write.
      expect(upsertLockout).toHaveBeenCalledWith(
        'a@b.c',
        '1.2.3.4',
        expect.objectContaining({ failed_count: 0, locked_until: null }),
      );
      expect(recordAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'login_success' }),
      );
    });

    it('failure at threshold locks the account and audits account_locked', async () => {
      const events: string[] = [];
      const svc = new SecurityService(
        makeRepo({
          recordLogin: jest.fn().mockResolvedValue(undefined),
          getLockout: jest.fn().mockResolvedValue({
            failed_count: MAX_FAILED_ATTEMPTS - 1,
            locked_until: null,
          }),
          upsertLockout: jest.fn().mockResolvedValue(undefined),
          recordAuthEvent: jest.fn((rec: { eventType: string }) => {
            events.push(rec.eventType);
            return Promise.resolve();
          }),
        }),
      );
      const out = await svc.recordAttempt(
        { email: 'a@b.c', success: false },
        NOW,
      );
      expect(out.locked).toBe(true);
      expect(events).toContain('login_failure');
      expect(events).toContain('account_locked');
    });
  });
});
