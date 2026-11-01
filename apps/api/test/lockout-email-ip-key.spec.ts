import { SecurityService } from '../src/modules/iam/security.service';
import {
  MAX_FAILED_ATTEMPTS,
  MAX_LOCKED_ADDRESSES,
} from '../src/modules/iam/iam.engine';
import type { IIamRepository } from '../src/modules/iam/iam.repository';

/**
 * SEC-001 — the real fix, not the throttle mitigation.
 *
 * THE ATTACK. `POST /auth/record-login` is unauthenticated and takes `success`
 * from the CLIENT. While `account_lockouts` was keyed on email alone, five
 * posts of `{email: <victim>, success: false}` locked a named person out of
 * their own account from anywhere on the internet. A per-route throttle cut the
 * rate but left the mechanism intact.
 *
 * THE FIX. Key on (email, ip). An attacker can now only lock the victim at the
 * ATTACKER'S address; the victim signing in from their own network is
 * untouched. Because that alone would let someone with many addresses take
 * MAX_FAILED_ATTEMPTS each, an email-wide ceiling still catches a distributed
 * attempt.
 *
 * These tests are the difference between the two behaviours. Re-keying on email
 * alone makes the first one fail.
 */
const NOW = new Date('2026-08-09T12:00:00.000Z');

/** In-memory stand-in keyed exactly as the table is. */
function makeRepo() {
  const rows = new Map<
    string,
    {
      failed_count: number;
      locked_until: string | null;
      last_failed_at: string | null;
    }
  >();
  const key = (email: string, ip: string) => `${email.toLowerCase()}|${ip}`;

  const repo = {
    recordLogin: jest.fn().mockResolvedValue(undefined),
    recordAuthEvent: jest.fn().mockResolvedValue(undefined),
    getLockout: jest.fn((email: string, ip: string) => {
      const r = rows.get(key(email, ip));
      return Promise.resolve(
        r ? { email, ip, updated_at: NOW.toISOString(), ...r } : null,
      );
    }),
    upsertLockout: jest.fn(
      (
        email: string,
        ip: string,
        state: {
          failed_count: number;
          locked_until: string | null;
          last_failed_at: string | null;
        },
      ) => {
        rows.set(key(email, ip), state);
        return Promise.resolve();
      },
    ),
    getEmailWideLockout: jest.fn((email: string, now: Date = NOW) => {
      let locked_addresses = 0;
      let locked_until: string | null = null;
      for (const [k, v] of rows) {
        if (!k.startsWith(`${email.toLowerCase()}|`)) continue;
        if (!v.locked_until) continue;
        if (new Date(v.locked_until).getTime() <= now.getTime()) continue;
        locked_addresses += 1;
        if (!locked_until || v.locked_until > locked_until)
          locked_until = v.locked_until;
      }
      return Promise.resolve({ locked_addresses, locked_until });
    }),
  };

  const proxy = new Proxy(repo as unknown as IIamRepository, {
    get(t, p: string) {
      const v = (t as unknown as Record<string, unknown>)[p];
      if (v) return v;
      throw new Error(`unexpected repo call: ${p}`);
    },
  });
  return { repo: proxy, rows };
}

const ATTACKER = '203.0.113.7';
const VICTIM = '198.51.100.20';

async function failFrom(
  svc: SecurityService,
  email: string,
  ip: string,
  times: number,
) {
  for (let i = 0; i < times; i += 1) {
    await svc.recordAttempt({ email, success: false, ip }, NOW);
  }
}

describe('SEC-001 — a remote attacker cannot lock a victim out of their own account', () => {
  it('locks the ATTACKER address after the threshold', async () => {
    const { repo } = makeRepo();
    const svc = new SecurityService(repo);

    await failFrom(svc, 'victim@example.com', ATTACKER, MAX_FAILED_ATTEMPTS);

    const attacker = await svc.lockoutStatus(
      'victim@example.com',
      ATTACKER,
      NOW,
    );
    expect(attacker.locked).toBe(true);
  });

  it('leaves the VICTIM able to sign in from their own address', async () => {
    // This is the whole finding. Keyed on email alone, this expectation is
    // false and the victim is locked out by someone else's failures.
    const { repo } = makeRepo();
    const svc = new SecurityService(repo);

    await failFrom(
      svc,
      'victim@example.com',
      ATTACKER,
      MAX_FAILED_ATTEMPTS * 3,
    );

    const victim = await svc.lockoutStatus('victim@example.com', VICTIM, NOW);
    expect(victim.locked).toBe(false);
  });

  it('still stops brute force from a single source', async () => {
    const { repo } = makeRepo();
    const svc = new SecurityService(repo);

    await failFrom(svc, 'target@example.com', ATTACKER, MAX_FAILED_ATTEMPTS);

    expect(
      (await svc.lockoutStatus('target@example.com', ATTACKER, NOW)).locked,
    ).toBe(true);
  });

  it('catches a DISTRIBUTED attempt through the email-wide ceiling', async () => {
    // Per-address keying alone would give an attacker with many addresses
    // MAX_FAILED_ATTEMPTS each, forever. The ceiling is the backstop.
    const { repo } = makeRepo();
    const svc = new SecurityService(repo);

    // Lock exactly the number of distinct addresses the ceiling allows.
    for (let i = 0; i < MAX_LOCKED_ADDRESSES; i += 1) {
      await failFrom(
        svc,
        'target@example.com',
        `203.0.113.${i + 1}`,
        MAX_FAILED_ATTEMPTS,
      );
    }

    // A fresh address now sees the account locked, because the email-wide
    // total has crossed the ceiling and a lock is in force.
    const fresh = await svc.lockoutStatus(
      'target@example.com',
      '192.0.2.99',
      NOW,
    );
    expect(fresh.locked).toBe(true);
  });

  it('a successful sign-in clears only that address', async () => {
    const { repo, rows } = makeRepo();
    const svc = new SecurityService(repo);

    await failFrom(svc, 'user@example.com', ATTACKER, 3);
    await failFrom(svc, 'user@example.com', VICTIM, 2);
    await svc.recordAttempt(
      { email: 'user@example.com', success: true, ip: VICTIM },
      NOW,
    );

    expect(rows.get('user@example.com|198.51.100.20')?.failed_count).toBe(0);
    // The attacker's counter is untouched — signing in elsewhere must not
    // hand an attacker a fresh set of attempts.
    expect(rows.get('user@example.com|203.0.113.7')?.failed_count).toBe(3);
  });
});
