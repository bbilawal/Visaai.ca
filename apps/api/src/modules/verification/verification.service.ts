import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActorRef,
  AuditEventType,
  FieldVerification,
  SectionVerification,
  SeedFieldInput,
  ValueHash,
  VerificationReadiness,
  VerificationState,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { VERIFICATION_REPOSITORY } from './verification.repository';
import type { IVerificationRepository } from './verification.repository';

/** Canonical state order (weakest -> strongest). */
const STATE_ORDER: VerificationState[] = [
  'EXTRACTED',
  'USER_CONFIRMED',
  'CONSULTANT_REVIEWED',
  'CONSULTANT_APPROVED',
  'EXECUTION_READY',
  'EXECUTED',
];

const STATE_INDEX: Record<VerificationState, number> = STATE_ORDER.reduce(
  (acc, s, i) => ((acc[s] = i), acc),
  {} as Record<VerificationState, number>,
);

/** Strict linear forward chain: each state may advance only to its successor. */
const ALLOWED_NEXT: Record<VerificationState, VerificationState | undefined> = {
  EXTRACTED: 'USER_CONFIRMED',
  USER_CONFIRMED: 'CONSULTANT_REVIEWED',
  CONSULTANT_REVIEWED: 'CONSULTANT_APPROVED',
  CONSULTANT_APPROVED: 'EXECUTION_READY',
  EXECUTION_READY: 'EXECUTED',
  EXECUTED: undefined,
};

/** Sections that must be consultant-approved for execution readiness. */
const REQUIRED_SECTIONS = [
  'passport',
  'address',
  'travel_history',
  'employment',
  'identity',
];

/**
 * VerificationService — the state-machine gatekeeper.
 *
 * Owns transition validation, drift detection/invalidation, section rollups,
 * and the execution-readiness gate. Every transition emits an audit event.
 * NOT wired into OCR/extraction/consultant/extension/execution (frozen).
 */
@Injectable()
export class VerificationService {
  constructor(
    @Inject(VERIFICATION_REPOSITORY)
    private readonly repo: IVerificationRepository,
    private readonly audit: AuditService,
  ) {}

  // ---- A/B. transition validation (pure) -------------------------------
  isValidTransition(from: VerificationState, to: VerificationState): boolean {
    return ALLOWED_NEXT[from] === to;
  }

  assertValidTransition(from: VerificationState, to: VerificationState): void {
    if (!this.isValidTransition(from, to)) {
      throw new BadRequestException(
        `invalid verification transition: ${from} -> ${to}`,
      );
    }
  }

  // ---- seeding (initial EXTRACTED rows; not a transition -> no audit) ---
  async ensureFields(
    applicationId: string,
    fields: SeedFieldInput[],
  ): Promise<void> {
    await this.repo.upsertSeed(applicationId, fields);
  }

  // ---- forward transitions (each audited, F) ---------------------------
  async confirmField(
    applicationId: string,
    fieldKey: string,
    actor: ActorRef,
    valueHash: ValueHash,
  ): Promise<FieldVerification> {
    return this.advance(
      applicationId,
      fieldKey,
      'USER_CONFIRMED',
      'USER_CONFIRMED',
      actor,
      valueHash,
      {
        value_hash: valueHash,
        user_confirmed_by: actor.id,
        user_confirmed_at: new Date().toISOString(),
      },
    );
  }

  async reviewField(
    applicationId: string,
    fieldKey: string,
    consultantId: string,
    valueHash: ValueHash,
  ): Promise<FieldVerification> {
    return this.advance(
      applicationId,
      fieldKey,
      'CONSULTANT_REVIEWED',
      'CONSULTANT_REVIEWED',
      { id: consultantId, role: 'consultant' },
      valueHash,
      {
        consultant_reviewed_by: consultantId,
        consultant_reviewed_at: new Date().toISOString(),
      },
    );
  }

  async approveField(
    applicationId: string,
    fieldKey: string,
    consultantId: string,
    valueHash: ValueHash,
  ): Promise<FieldVerification> {
    return this.advance(
      applicationId,
      fieldKey,
      'CONSULTANT_APPROVED',
      'CONSULTANT_APPROVED',
      { id: consultantId, role: 'consultant' },
      valueHash,
      {
        consultant_approved_by: consultantId,
        consultant_approved_at: new Date().toISOString(),
      },
    );
  }

  /** Validated forward step + guarded persist + audit. */
  private async advance(
    applicationId: string,
    fieldKey: string,
    to: VerificationState,
    auditType: AuditEventType,
    actor: ActorRef,
    valueHash: ValueHash | null,
    patch: Partial<FieldVerification>,
  ): Promise<FieldVerification> {
    const current = await this.repo.getByField(applicationId, fieldKey);
    if (!current)
      throw new NotFoundException(`field_verification not found: ${fieldKey}`);

    this.assertValidTransition(current.state, to);

    let row: FieldVerification;
    try {
      row = await this.repo.transition(
        applicationId,
        fieldKey,
        current.state,
        to,
        patch,
      );
    } catch {
      // Guarded update affected 0 rows -> state moved under us.
      throw new ConflictException(
        `stale verification transition for ${fieldKey} (expected ${current.state})`,
      );
    }

    await this.audit.append({
      applicationId,
      eventType: auditType,
      actor,
      valueHash,
      refs: { fieldKey },
      fromState: current.state,
      toState: to,
      payload: { section: row.section ?? null },
    });

    return row;
  }

  // ---- C. drift detection + downstream invalidation --------------------
  /**
   * If the live value_hash differs from the recorded one and the field has
   * advanced past EXTRACTED, reset it to EXTRACTED (invalidate downstream) and
   * emit a FIELD_EDITED drift event. Returns the reset row, or null on no-op.
   * Actor timestamps are intentionally retained so the reset is detectable as
   * drift (vs a never-confirmed field) by the readiness gate.
   */
  async onValueChanged(
    applicationId: string,
    fieldKey: string,
    newValueHash: ValueHash,
  ): Promise<FieldVerification | null> {
    const current = await this.repo.getByField(applicationId, fieldKey);
    if (!current) return null;
    if (current.value_hash === newValueHash) return null;
    if (current.state === 'EXTRACTED') {
      // Nothing downstream to invalidate; just rebaseline the hash.
      return this.repo.transition(
        applicationId,
        fieldKey,
        'EXTRACTED',
        'EXTRACTED',
        {
          value_hash: newValueHash,
        },
      );
    }

    const row = await this.repo.transition(
      applicationId,
      fieldKey,
      current.state,
      'EXTRACTED',
      {
        value_hash: newValueHash,
      },
    );

    await this.audit.append({
      applicationId,
      eventType: 'FIELD_EDITED',
      actor: { id: null, role: 'system' },
      valueHash: newValueHash,
      refs: { fieldKey },
      fromState: current.state,
      toState: 'EXTRACTED',
      payload: { reason: 'value drift', invalidated_from: current.state },
    });

    return row;
  }

  // ---- D. section rollups ----------------------------------------------
  async getStates(applicationId: string): Promise<FieldVerification[]> {
    return this.repo.getStates(applicationId);
  }

  /** Section state = weakest (min) field state in the section. */
  sectionStateFromFields(fields: FieldVerification[]): VerificationState {
    if (fields.length === 0) return 'EXTRACTED';
    return fields.reduce<VerificationState>(
      (min, f) => (STATE_INDEX[f.state] < STATE_INDEX[min] ? f.state : min),
      'EXECUTED',
    );
  }

  async getSectionRollup(
    applicationId: string,
  ): Promise<SectionVerification[]> {
    const states = await this.repo.getStates(applicationId);
    const bySection = new Map<string | null, FieldVerification[]>();
    for (const f of states) {
      const arr = bySection.get(f.section ?? null) ?? [];
      arr.push(f);
      bySection.set(f.section ?? null, arr);
    }

    const rollups: SectionVerification[] = [];
    for (const [section, fields] of bySection) {
      const sectionState = this.sectionStateFromFields(fields);
      rollups.push({
        application_id: applicationId,
        section,
        section_state: sectionState,
        field_count: fields.length,
        ready_count: fields.filter(
          (f) => STATE_INDEX[f.state] >= STATE_INDEX['EXECUTION_READY'],
        ).length,
      });
    }
    return rollups;
  }

  // ---- E. execution readiness gate -------------------------------------
  async evaluateExecutionReadiness(
    applicationId: string,
  ): Promise<VerificationReadiness> {
    const states = await this.repo.getStates(applicationId);
    const rollups = await this.getSectionRollup(applicationId);
    const rollupBySection = new Map(rollups.map((r) => [r.section, r]));

    const blockedSections: string[] = [];
    for (const section of REQUIRED_SECTIONS) {
      const r = rollupBySection.get(section);
      if (
        !r ||
        STATE_INDEX[r.section_state] < STATE_INDEX['CONSULTANT_APPROVED']
      ) {
        blockedSections.push(section);
      }
    }
    const requiredSectionsApproved = blockedSections.length === 0;

    const consultantApprovalPresent = states.some(
      (f) => STATE_INDEX[f.state] >= STATE_INDEX['CONSULTANT_APPROVED'],
    );

    // Drift = a field knocked back to EXTRACTED that was previously confirmed/approved.
    const driftedFields = states
      .filter(
        (f) =>
          f.state === 'EXTRACTED' &&
          (f.user_confirmed_at != null || f.consultant_approved_at != null),
      )
      .map((f) => f.field_key);
    const noDrift = driftedFields.length === 0;

    return {
      applicationId,
      ready: requiredSectionsApproved && consultantApprovalPresent && noDrift,
      requiredSectionsApproved,
      consultantApprovalPresent,
      noDrift,
      blockedSections,
      driftedFields,
    };
  }
}
