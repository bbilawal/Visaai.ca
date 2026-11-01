import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PreflightMappingInput,
  WritePlan,
  WritePlanEntry,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { PreflightService } from '../preflight/preflight.service';
import { ProvenanceService } from '../provenance/provenance.service';

/**
 * WritePlanBuilder (Phase 7D) — server-side derivation only.
 *
 * Turns the locked preflight + supplied mappings into a WritePlan that the
 * future signer/executor will consume. It is purely derivational + read-only:
 *   - NO executor, NO DOM, NO browser automation.
 *   - NO signing (next phase), NO audit emission, NO execution authority.
 *   - Emits NOTHING; mutates NOTHING.
 *
 * Safety binding: a plan is built ONLY when the supplied mappings reproduce the
 * review's `locked_diff_hash` (verified live via PreflightService.validateLock).
 * Any lock/consultant/drift change since the lock => rejected (no plan). This
 * re-anchors every future write to the Phase-3/4 trust anchor.
 */
@Injectable()
export class WritePlanBuilder {
  constructor(
    private readonly preflight: PreflightService,
    private readonly provenance: ProvenanceService,
    private readonly audit: AuditService,
  ) {}

  async build(
    applicationId: string,
    preflightReviewId: string,
    mappings: PreflightMappingInput[],
  ): Promise<WritePlan> {
    const review = await this.preflight.getReview(preflightReviewId);
    if (!review || review.status !== 'completed' || !review.locked_diff_hash) {
      throw new BadRequestException(
        'write plan requires a completed, locked preflight review',
      );
    }
    if (review.application_id !== applicationId) {
      throw new BadRequestException(
        'preflight review does not belong to this application',
      );
    }

    // Re-bind to the trust anchor: mappings must reproduce locked_diff_hash and
    // pass live consultant/drift/lock revalidation.
    const lock = await this.preflight.validateLock(
      preflightReviewId,
      mappings,
      applicationId,
    );
    if (!lock.valid) {
      throw new BadRequestException(
        `write plan rejected: ${lock.reasons.join(', ')}`,
      );
    }

    // Mapping order IS the write order, and it is not alphabetical: a radio
    // answer reveals its follow-up questions, and a dialog must open before
    // its fields exist and be saved after them. The mappings come out of the
    // signed readback token in the server's own (portal) order, so keeping it
    // is deterministic. The lock hash is order-independent (assembleDiff sorts).
    const entries: WritePlanEntry[] = mappings.map(
      (m): WritePlanEntry => ({
        fieldKey: m.fieldKey,
        ...(m.page ? { page: m.page } : {}),
        selector: m.targetField,
        mappedValue: m.mappedValue == null ? '' : String(m.mappedValue),
        expectedValueHash: this.provenance.valueHash(m.mappedValue),
        category: m.category,
        ...(m.op ? { op: m.op } : {}),
        ...(m.reveal ? { reveal: true } : {}),
        ...(m.dialog ? { dialog: true } : {}),
        ...(m.awaitOptions ? { awaitOptions: true } : {}),
      }),
    );

    // Deterministic plan hash (canonical) — the future signer signs over this.
    const planHash = this.audit.payloadHash({ entries });

    return {
      applicationId,
      preflightReviewId,
      lockedDiffHash: review.locked_diff_hash,
      entries,
      planHash,
    };
  }
}
