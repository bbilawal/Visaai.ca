import {
  BadRequestException,
  Body,
  Controller,
  Ip,
  Headers,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SecurityService } from './security.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { LockoutStatusDto, RecordLoginDto } from './iam.dto';

/**
 * Public (pre-auth) brute-force endpoints. VisaAI signs in client-side via
 * Supabase; the web app calls `lockout-status` before attempting sign-in and
 * `record-login` with the outcome. Responses are generic (no account-existence
 * leak). The lockout is an app-level layer on top of Supabase's own auth
 * throttling.
 *
 * SEC-001 — READ BEFORE CHANGING THESE LIMITS.
 *
 * `record-login` is unauthenticated and takes `success` from the CLIENT, and
 * `account_lockouts` is keyed on email alone (5 failures => 15 minutes). So a
 * caller can POST {email: <victim>, success: false} five times and lock that
 * account. Under the global 60/min budget one IP could lock roughly a dozen
 * named accounts per minute.
 *
 * FIXED. The lockout is now keyed on (email, ip), so an attacker can only lock
 * the victim at the ATTACKER'S OWN address — the victim signing in from their
 * own network is unaffected. Per-address keying alone would let someone with
 * many addresses take 5 attempts each, so an email-wide ceiling
 * (MAX_FAILED_ATTEMPTS_EMAIL_WIDE) still catches a distributed attempt.
 *
 * The per-route throttles below stay: they were the mitigation, and they remain
 * a sensible limit on an unauthenticated endpoint that a real client calls once
 * per sign-in.
 *
 * The migration (20260809160000_lockout_key_email_ip.sql) is NOT yet applied to
 * production — blocked on BLK-1.
 */
@Controller('auth')
export class SecurityController {
  constructor(
    private readonly security: SecurityService,
    private readonly supabase: SupabaseService,
  ) {}

  // SEC-001 mitigation — see the class comment.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('lockout-status')
  status(@Body() body: unknown, @Ip() ip: string) {
    const parsed = LockoutStatusDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    // SEC-001: scoped to the caller's address, so a lock earned elsewhere is
    // not reported back here.
    return this.security.lockoutStatus(parsed.data.email, ip);
  }

  // SEC-001 mitigation — a real sign-in calls this once; 5/min is generous.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('record-login')
  async record(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const parsed = RecordLoginDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    // SEC-1002: this endpoint is unauthenticated and login happens client-side
    // via Supabase, so a naive `success` flag cannot be trusted. Two exploit
    // primitives are removed here:
    //  (1) self-reset — `nextLockoutState` clears the failed-attempt counter on
    //      success, so an attacker being throttled could POST {success:true} to
    //      unlock. We only accept success (and therefore reset) when the caller
    //      presents a VALID Supabase access token whose email matches.
    //  (2) forged attribution — `userId` was taken from the client and written
    //      into login_history / auth_audit_log. We never trust it; userId is
    //      derived solely from the verified token, else null.
    let verifiedSuccess = false;
    let verifiedUserId: string | null = null;
    if (parsed.data.success) {
      const token = authorization?.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const { data, error } = await this.supabase.admin.auth.getUser(token);
        const tokenEmail = data?.user?.email?.toLowerCase();
        if (
          !error &&
          data?.user &&
          tokenEmail &&
          tokenEmail === parsed.data.email.toLowerCase()
        ) {
          verifiedSuccess = true;
          verifiedUserId = data.user.id;
        }
      }
    }

    // An unverified "success" is treated as a non-event for the lockout counter:
    // it is neither a failure (so we do not lock a victim) nor a trusted success
    // (so it cannot clear an attacker's own counter).
    if (parsed.data.success && !verifiedSuccess) {
      return { locked: false };
    }

    return this.security.recordAttempt({
      email: parsed.data.email,
      success: verifiedSuccess,
      userId: verifiedUserId,
      ip,
      userAgent,
    });
  }
}
