import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { Env } from '../../config/configuration';
import type { ITokenValidator } from './eligibility.repository';

const TTL_MS = 30 * 60 * 1000; // execution token valid for 30 minutes
// submission_sessions statuses that represent a live, executable session.
const EXECUTABLE_STATUSES = new Set(['pending', 'active', 'paused']);

/**
 * Real execution-token validator (Phase 6B).
 *
 * The execution token is a stateless HMAC bound to (sessionId, applicationId,
 * userId, issuedAt). Validation is READ-ONLY and checks, in order:
 *   - signature + binding (session/app/user)            → tamper/mismatch fail
 *   - TTL from the signed issuedAt                       → expiration
 *   - the session row in `submission_sessions`          → real persistence
 *       · exists                                         → missing fail
 *       · application_id matches                         → application binding
 *       · status is executable (not complete/error)      → revocation
 *
 * Replay protection is intentionally NOT here — it lives in the single-use
 * readback-token ledger (`consumed_readback_tokens`). This validator is
 * idempotent (no consumption), so it is replay-protection *compatible*: it may
 * be evaluated repeatedly during a single execute() without burning anything.
 *
 * Fail-closed: any parse/verify/DB error returns false (never throws, never
 * assumes validity). No constructor side effects.
 */
@Injectable()
export class TokenValidator implements ITokenValidator {
  private readonly secret: string;

  constructor(
    config: ConfigService<Env>,
    private readonly supabase: SupabaseService,
  ) {
    this.secret =
      (config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }) as string) ??
      'dev-secret';
  }

  /** Mint a bound execution token (used at session setup / tests). */
  mint(
    sessionId: string,
    applicationId: string,
    userId: string,
    issuedAt = Date.now(),
  ): string {
    const body = `${sessionId}.${issuedAt}`;
    return `${body}.${this.sign(`${sessionId}|${applicationId}|${userId}|${issuedAt}`)}`;
  }

  async isValid(
    token: string,
    sessionId: string,
    applicationId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      if (!token) return false;
      const [sid, issuedAtStr, sig] = token.split('.');
      if (!sid || !issuedAtStr || !sig) return false;
      if (sid !== sessionId) return false;

      const issuedAt = Number(issuedAtStr);
      if (!Number.isFinite(issuedAt)) return false;

      // signature binds session + app + user + issuedAt
      const expected = this.sign(
        `${sessionId}|${applicationId}|${userId}|${issuedAt}`,
      );
      if (!this.safeEq(sig, expected)) return false;

      // expiration (from the signed, tamper-proof issuedAt)
      if (Date.now() - issuedAt > TTL_MS) return false;

      // real persistence: the session must exist, match the app, and be live
      const { data, error } = await this.supabase.admin
        .from('submission_sessions')
        .select('application_id, status')
        .eq('id', sessionId)
        .maybeSingle();
      if (error || !data) return false;
      const row = data;
      if (row.application_id !== applicationId) return false;
      if (!EXECUTABLE_STATUSES.has(row.status)) return false;

      return true;
    } catch {
      return false; // fail closed
    }
  }

  private sign(input: string): string {
    return createHmac('sha256', this.secret).update(input).digest('base64url');
  }

  private safeEq(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
