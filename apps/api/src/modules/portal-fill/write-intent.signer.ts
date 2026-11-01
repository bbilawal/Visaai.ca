import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SignedWriteIntent, WritePlan } from '@visaai/types';
import type { Env } from '../../config/configuration';

/**
 * WriteIntentSigner (Phase 7D) — server-side only.
 *
 * Mints + verifies per-field signed write intents from a WritePlan, scoped to a
 * single execution run. The signature binds:
 *     executionId ‖ lockedDiffHash ‖ fieldKey ‖ expectedValueHash
 * so an intent cannot be (a) replayed under a different executionId,
 * (b) re-pointed to another field, (c) mutated in value, or (d) detached from
 * its preflight lock — any change invalidates `sig`. Only the holder of the
 * server secret can mint or verify; the extension cannot forge intents.
 *
 * This phase ships the signer ONLY: no executor, no DOM, no module wiring. It is
 * constructed/exercised directly (not yet DI-registered).
 */
@Injectable()
export class WriteIntentSigner {
  private readonly secret: string;

  constructor(config: ConfigService<Env>) {
    this.secret =
      (config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }) as string) ??
      'dev-secret';
  }

  /** Sign every entry of a plan for one execution run. */
  sign(plan: WritePlan, executionId: string): SignedWriteIntent[] {
    return plan.entries.map(
      (e): SignedWriteIntent => ({
        executionId,
        fieldKey: e.fieldKey,
        ...(e.page ? { page: e.page } : {}),
        selector: e.selector,
        mappedValue: e.mappedValue,
        expectedValueHash: e.expectedValueHash,
        category: e.category,
        ...(e.op ? { op: e.op } : {}),
        ...(e.reveal ? { reveal: true } : {}),
        ...(e.dialog ? { dialog: true } : {}),
        lockedDiffHash: plan.lockedDiffHash,
        sig: this.signOne(
          executionId,
          plan.lockedDiffHash,
          e.fieldKey,
          e.expectedValueHash,
        ),
      }),
    );
  }

  /** Re-derive the signature and constant-time compare. Server-side validation. */
  verify(intent: SignedWriteIntent): boolean {
    const expected = this.signOne(
      intent.executionId,
      intent.lockedDiffHash,
      intent.fieldKey,
      intent.expectedValueHash,
    );
    return this.safeEq(intent.sig, expected);
  }

  private signOne(
    executionId: string,
    lockedDiffHash: string,
    fieldKey: string,
    valueHash: string,
  ): string {
    return createHmac('sha256', this.secret)
      .update(`${executionId}|${lockedDiffHash}|${fieldKey}|${valueHash}`)
      .digest('base64url');
  }

  private safeEq(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
