import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthAuditEventType, LoginHistoryEntry } from '@visaai/types';
import {
  isLocked,
  LOCKOUT_MINUTES,
  MAX_LOCKED_ADDRESSES,
  nextLockoutState,
  UNKNOWN_IP,
} from './iam.engine';
import {
  IAM_REPOSITORY,
  type AuthAuditRecord,
  type IIamRepository,
} from './iam.repository';

export interface AttemptContext {
  email: string;
  success: boolean;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * SecurityService — brute-force lockout + login history + the auth audit trail.
 * VisaAI auth runs client-side via Supabase, so the web app reports the outcome
 * here (pre-check `lockoutStatus`, then `recordAttempt`). Lockout policy + state
 * transitions are the pure `iam.engine` functions; this service does the I/O.
 */
@Injectable()
export class SecurityService {
  private readonly log = new Logger(SecurityService.name);

  constructor(@Inject(IAM_REPOSITORY) private readonly repo: IIamRepository) {}

  /**
   * Pre-auth gate: is this caller locked out? (Generic — no account leak.)
   *
   * SEC-001: the answer depends on WHERE the request comes from. A lock earned
   * by one address must not tell a different address that the account is
   * locked, or the denial-of-service returns through the status endpoint.
   */
  async lockoutStatus(
    email: string,
    ip: string,
    now = new Date(),
  ): Promise<{ locked: boolean; retry_after_minutes: number | null }> {
    const state = await this.repo.getLockout(email, ip);
    if (isLocked(state, now)) {
      return { locked: true, retry_after_minutes: LOCKOUT_MINUTES };
    }
    // Backstop: many DISTINCT addresses locked against one account at once is a
    // distributed attempt, which per-address keying alone would never catch.
    const wide = await this.repo.getEmailWideLockout(email, now);
    if (wide.locked_addresses >= MAX_LOCKED_ADDRESSES) {
      return { locked: true, retry_after_minutes: LOCKOUT_MINUTES };
    }
    return { locked: false, retry_after_minutes: null };
  }

  /**
   * Record a login attempt: append login_history + auth_audit, and advance the
   * lockout counter. Returns whether the account is now locked.
   */
  async recordAttempt(
    ctx: AttemptContext,
    now = new Date(),
  ): Promise<{ locked: boolean }> {
    await this.repo.recordLogin({
      userId: ctx.userId ?? null,
      email: ctx.email,
      success: ctx.success,
      failureReason: ctx.success ? null : 'invalid_credentials',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // SEC-001: per (email, ip). ctx.ip comes from Nest's @Ip(), which can be
    // absent behind an odd proxy. Unknown sources share one bucket rather than
    // getting a free pass each — conservative, and it cannot be used against a
    // victim because it never touches the bucket for their real address.
    const sourceIp = ctx.ip ?? UNKNOWN_IP;
    const prev = await this.repo.getLockout(ctx.email, sourceIp);
    const next = nextLockoutState(prev, ctx.success, now);
    await this.repo.upsertLockout(ctx.email, sourceIp, {
      failed_count: next.failed_count,
      locked_until: next.locked_until,
      last_failed_at: next.last_failed_at,
    });

    await this.recordEvent({
      userId: ctx.userId ?? null,
      eventType: ctx.success ? 'login_success' : 'login_failure',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { email: ctx.email },
    });
    if (next.just_locked) {
      await this.recordEvent({
        userId: ctx.userId ?? null,
        eventType: 'account_locked',
        ip: ctx.ip,
        metadata: { email: ctx.email, minutes: LOCKOUT_MINUTES },
      });
      // SEC-002: the email is already recorded in auth_audit_log, which is
      // RLS-protected and service-role only. Repeating it in the application
      // log spreads PII to stdout — a far less controlled surface, and one an
      // aggregator may retain outside the erasure paths that privacy_requests
      // covers. A short digest is enough to correlate log lines with the audit
      // row without carrying the address itself.
      const emailDigest = createHash('sha256')
        .update(ctx.email.toLowerCase())
        .digest('hex')
        .slice(0, 12);
      this.log.warn(`account locked (brute-force): email#${emailDigest}`);
    }
    return { locked: next.locked_until != null };
  }

  loginHistory(userId: string, limit = 50): Promise<LoginHistoryEntry[]> {
    return this.repo.listLoginHistory(
      userId,
      Math.min(Math.max(limit, 1), 200),
    );
  }

  /** Generic auth-event recorder (logout, password_changed, mfa_enabled, ...). */
  recordEvent(
    rec: AuthAuditRecord & { eventType: AuthAuditEventType },
  ): Promise<void> {
    return this.repo.recordAuthEvent(rec);
  }
}
