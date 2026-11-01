import type {
  ActorRef,
  EligibilityCheckInput,
  FieldVerification,
  PreflightCheckKey,
  PreflightMappingInput,
  SectionVerification,
  SeedFieldInput,
  VerificationState,
} from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { VerificationService } from '../src/modules/verification/verification.service';
import type { IVerificationRepository } from '../src/modules/verification/verification.repository';
import { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import { PreflightService } from '../src/modules/preflight/preflight.service';
import { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import type {
  IPaymentReadModel,
  ITokenValidator,
} from '../src/modules/eligibility/eligibility.repository';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';
import { FakePreflightRepository } from './fakes/FakePreflightRepository';
import { FakeConsultantRepository } from './fakes/FakeConsultantRepository';
import { PlanReviewPayoutService } from '../src/modules/payouts/plan-review-payout.service';

/**
 * DUP-001: deliberately NOT shared. The copy in
 * extraction-verification.integration.spec.ts makes `transition()` THROW as a
 * tripwire proving seeding never transitions. These tests exercise real state
 * transitions, so they need a working one. Same name, opposite purpose —
 * merging them would destroy one assertion or the other.
 */
class FakeVerificationRepository implements IVerificationRepository {
  rows = new Map<string, FieldVerification>();
  private k(a: string, f: string) {
    return `${a}::${f}`;
  }
  async upsertSeed(app: string, fields: SeedFieldInput[]): Promise<void> {
    for (const f of fields)
      if (!this.rows.has(this.k(app, f.fieldKey)))
        this.rows.set(this.k(app, f.fieldKey), blankVerif(app, f));
  }
  async getByField(
    app: string,
    field: string,
  ): Promise<FieldVerification | null> {
    const r = this.rows.get(this.k(app, field));
    return r ? { ...r } : null;
  }
  async getStates(app: string): Promise<FieldVerification[]> {
    return [...this.rows.values()]
      .filter((r) => r.application_id === app)
      .map((r) => ({ ...r }));
  }
  async getSectionRollup(): Promise<SectionVerification[]> {
    return [];
  }
  async transition(
    app: string,
    field: string,
    from: VerificationState,
    to: VerificationState,
    patch: Partial<FieldVerification>,
  ): Promise<FieldVerification> {
    const r = this.rows.get(this.k(app, field));
    if (!r || r.state !== from) throw new Error('stale');
    Object.assign(r, patch, { state: to });
    return { ...r };
  }
  async listByDocument(): Promise<FieldVerification[]> {
    return [];
  }
}

// ---------- fakes ----------

function blankVerif(app: string, f: SeedFieldInput): FieldVerification {
  const now = new Date().toISOString();
  return {
    id: `${app}:${f.fieldKey}`,
    application_id: app,
    field_key: f.fieldKey,
    section: f.section ?? null,
    state: 'EXTRACTED',
    value_snapshot: null,
    value_hash: null,
    source: null,
    source_document_id: null,
    user_confirmed_by: null,
    user_confirmed_at: null,
    consultant_reviewed_by: null,
    consultant_reviewed_at: null,
    consultant_approved_by: null,
    consultant_approved_at: null,
    executed_at: null,
    created_at: now,
    updated_at: now,
  };
}

class FakePayment implements IPaymentReadModel {
  ok = true;
  async hasPaidPrefill(): Promise<boolean> {
    return this.ok;
  }
}
class FakeToken implements ITokenValidator {
  ok = true;
  mint(): string {
    return 'exec-token';
  }
  async isValid(): Promise<boolean> {
    return this.ok;
  }
}

// ---------- harness ----------
const APP = 'app-1';
const C1: ActorRef = { id: 'cons-1', role: 'consultant' };
const MAPPINGS: PreflightMappingInput[] = [
  {
    fieldKey: 'passport_number',
    targetField: '#passportNum',
    mappedValue: 'X1',
    category: 'passport',
  },
];
const CHECKS: PreflightCheckKey[] = [
  'passport_reviewed',
  'dates_reviewed',
  'travel_history_reviewed',
  'addresses_reviewed',
  'employment_reviewed',
  'final_approval',
];

async function buildEligible() {
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo);
  const prov = new ProvenanceService(new FakeProvenanceRepository(), audit);
  const verif = new VerificationService(
    new FakeVerificationRepository(),
    audit,
  );
  const cons = new ConsultantApprovalService(
    new FakeConsultantRepository(),
    prov,
    audit,
    {
      creditExpertReview: () => Promise.resolve({ recorded: false }),
    } as unknown as PlanReviewPayoutService,
  );
  // The pre-submission lock gate is PreflightModule's (approval-lock.gate.spec);
  // approval fails closed without one, so register a pass-through here. Same
  // for the lock an approval must postdate: no portal fill, nothing to cover.
  cons.registerApplicationApprovalGate(() => Promise.resolve());
  cons.registerApplicationApprovalLockSource(() =>
    Promise.resolve({ requiresLock: false, lockedAt: null }),
  );
  const preflight = new PreflightService(
    new FakePreflightRepository(),
    prov,
    verif,
    cons,
    audit,
    // complete() re-derives the mappings server-side; here they are the fixture.
    { forApplication: async () => MAPPINGS } as never,
  );
  const payment = new FakePayment();
  const token = new FakeToken();
  const svc = new ExecutionEligibilityService(
    payment,
    token,
    cons,
    preflight,
    audit,
  );

  await prov.createFieldProvenance({
    applicationId: APP,
    fieldKey: 'passport_number',
    origin: 'intake',
    value: 'X1',
  });
  await cons.assign(APP, C1.id!);
  await cons.approveField(APP, C1.id!, 'passport_number', prov.valueHash('X1'));
  await cons.approveApplication(APP, C1.id!);
  const review = await preflight.start(APP, C1);
  for (const c of CHECKS)
    await preflight.recordCheck(review.id, c, true, APP, C1);
  await preflight.complete(review.id, MAPPINGS, C1, APP);

  const input: EligibilityCheckInput = {
    applicationId: APP,
    preflightReviewId: review.id,
    mappings: MAPPINGS,
    token: 'tok',
    sessionId: 'sess-1',
    userId: 'u1',
  };
  return {
    svc,
    input,
    payment,
    token,
    prov,
    verif,
    cons,
    preflight,
    auditRepo,
  };
}

function execReadyCount(auditRepo: FakeAuditRepository) {
  return auditRepo.rows.filter((e) => e.event_type === 'EXECUTION_READY')
    .length;
}

describe('ExecutionEligibilityService — all predicates pass (A, B, E)', () => {
  it('is eligible and emits EXECUTION_READY', async () => {
    const { svc, input, auditRepo } = await buildEligible();
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.conditions).toEqual({
      paymentCompleted: true,
      consultantApprovalValid: true,
      preflightLockValid: true,
      executionTokenValid: true,
    });
    expect(execReadyCount(auditRepo)).toBe(1);
  });
});

describe('ExecutionEligibilityService — predicate failures (C)', () => {
  it('payment failure', async () => {
    const { svc, input, payment, auditRepo } = await buildEligible();
    payment.ok = false;
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('payment_missing');
    expect(r.conditions.paymentCompleted).toBe(false);
    expect(execReadyCount(auditRepo)).toBe(0);
  });

  it('consultant failure (application approval revoked)', async () => {
    const { svc, input, cons } = await buildEligible();
    await cons.revoke(APP, C1.id!, { scope: 'application' }, 'withdrawn');
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('consultant_missing');
  });

  // Live 2026-10-20 follow-up: a document the consultant sent back blocks the
  // approval — with its own reason, not "consultant has not approved".
  it('open document request: document_review_open, not consultant_missing', async () => {
    const { svc, input, cons } = await buildEligible();
    cons.registerApplicationApprovalBlocker(() =>
      Promise.resolve('Cannot approve yet: passport.pdf (re-upload requested).'),
    );
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('document_review_open');
    expect(r.reasons).not.toContain('consultant_missing');
  });

  it('unreadable review state: approval_check_unavailable, not consultant_missing', async () => {
    const { svc, input, cons } = await buildEligible();
    cons.registerApplicationApprovalBlocker(() =>
      Promise.reject(new Error('db down')),
    );
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('approval_check_unavailable');
    expect(r.reasons).not.toContain('consultant_missing');
  });

  it('preflight failure (review never completed)', async () => {
    const { svc, input } = await buildEligible();
    const r = await svc.evaluate({
      ...input,
      preflightReviewId: 'does-not-exist',
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('preflight_incomplete');
  });

  it('lock invalidation (provenance change after completion)', async () => {
    const { svc, input, prov } = await buildEligible();
    await prov.supersedeFieldProvenance({
      applicationId: APP,
      fieldKey: 'passport_number',
      origin: 'intake',
      value: 'X2',
    });
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining(['preflight_invalid', 'consultant_stale']),
    );
    expect(r.conditions.preflightLockValid).toBe(false);
  });

  it('verification drift', async () => {
    const { svc, input, verif } = await buildEligible();
    await verif.ensureFields(APP, [
      { fieldKey: 'dob', section: 'dates', value: 'v' },
    ]);
    await verif.confirmField(APP, 'dob', { id: 'u1', role: 'applicant' }, 'h');
    await verif.onValueChanged(APP, 'dob', 'NEW');
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('verification_drift');
  });

  it('token invalid', async () => {
    const { svc, input, token } = await buildEligible();
    token.ok = false;
    const r = await svc.evaluate(input);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('token_invalid');
    expect(r.conditions.executionTokenValid).toBe(false);
  });
});

describe('ExecutionEligibilityService — audit + no side effects (D, E)', () => {
  it('EXECUTION_READY is emitted once (idempotent) and chain stays intact', async () => {
    const { svc, input, auditRepo } = await buildEligible();
    await svc.evaluate(input);
    await svc.evaluate(input);
    expect(execReadyCount(auditRepo)).toBe(1);
    expect((await new AuditService(auditRepo).verifyChain(APP)).intact).toBe(
      true,
    );
  });

  it('blocked evaluation has no side effects (no audit, no state change)', async () => {
    const { svc, input, payment, cons, preflight, auditRepo } =
      await buildEligible();
    payment.ok = false;
    const decisionsBefore = (await cons.listDecisions(APP)).length;
    const lockBefore = await preflight.getActive(APP); // null (completed, not in_review)

    await svc.evaluate(input);
    await svc.evaluate(input);

    expect(execReadyCount(auditRepo)).toBe(0);
    expect((await cons.listDecisions(APP)).length).toBe(decisionsBefore); // approvals unchanged
    expect(await preflight.getActive(APP)).toEqual(lockBefore); // no new review created (getActive now returns the live completed lock, as a copy)
  });

  it('assert throws when blocked', async () => {
    const { svc, input, token } = await buildEligible();
    token.ok = false;
    await expect(svc.assert(input)).rejects.toThrow(/not eligible/);
  });
});
