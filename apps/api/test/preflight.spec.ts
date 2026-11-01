import type {
  ActorRef,
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
import type { PreflightMappingService } from '../src/modules/preflight/preflight-mapping.service';
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

// ---------- harness ----------
const APP = 'app-1';
const C1: ActorRef = { id: 'cons-1', role: 'consultant' };
const ADMIN: ActorRef = { id: 'admin-1', role: 'admin' };

function make() {
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo);
  const prov = new ProvenanceService(new FakeProvenanceRepository(), audit);
  const verif = new VerificationService(
    new FakeVerificationRepository(),
    audit,
  );
  const consRepo = new FakeConsultantRepository();
  const cons = new ConsultantApprovalService(consRepo, prov, audit, {
    creditExpertReview: () => Promise.resolve({ recorded: false }),
  } as unknown as PlanReviewPayoutService);
  // What the server derives at complete() time (the saved form). Tests that
  // simulate "the values moved under the consultant" mutate it.
  const derived = { mappings: MAPPINGS };
  const preflightRepo = new FakePreflightRepository();
  const svc = new PreflightService(preflightRepo, prov, verif, cons, audit, {
    forApplication: async () => derived.mappings,
  } as unknown as PreflightMappingService);
  return {
    svc,
    prov,
    verif,
    cons,
    consRepo,
    auditRepo,
    derived,
    preflightRepo,
  };
}

/** make() with C1 actively assigned (to APP and the cross-app fixture). */
function makeAssigned() {
  const ctx = make();
  void ctx.consRepo.insertAssignment(APP, C1.id!);
  void ctx.consRepo.insertAssignment('app-2', C1.id!);
  return ctx;
}

const CHECKS: PreflightCheckKey[] = [
  'passport_reviewed',
  'dates_reviewed',
  'travel_history_reviewed',
  'addresses_reviewed',
  'employment_reviewed',
  'final_approval',
];

async function setAllChecks(svc: PreflightService, reviewId: string) {
  for (const c of CHECKS) await svc.recordCheck(reviewId, c, true, APP, C1);
}

const MAPPINGS: PreflightMappingInput[] = [
  {
    fieldKey: 'passport_number',
    targetField: '#passportNum',
    mappedValue: 'X1',
    category: 'passport',
  },
];

async function seedProv(
  prov: ProvenanceService,
  fieldKey: string,
  value: string,
) {
  await prov.createFieldProvenance({
    applicationId: APP,
    fieldKey,
    origin: 'intake',
    value,
  });
  return prov.valueHash(value);
}

describe('PreflightService — diff assembly (A)', () => {
  it('assembles an immutable, hash-only diff (no raw values)', async () => {
    const { svc, prov } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const diff = await svc.assembleDiff(APP, MAPPINGS);
    expect(diff.entries[0]).toEqual({
      fieldKey: 'passport_number',
      targetField: '#passportNum',
      category: 'passport',
      sourceValueHash: prov.valueHash('X1'),
      mappedValueHash: prov.valueHash('X1'),
    });
    expect(JSON.stringify(diff.entries)).not.toContain('X1'); // hashes only
    expect(diff.diffHash).toBe(
      (await svc.assembleDiff(APP, MAPPINGS)).diffHash,
    ); // deterministic
  });
});

describe('PreflightService — the lock covers how a target is operated', () => {
  it('a radio click and a value write to the same target hash differently', async () => {
    const { svc } = makeAssigned();
    const asValue = await svc.assembleDiff(APP, [
      {
        fieldKey: 'has_national_id',
        targetField: '#r',
        mappedValue: 'Yes',
        category: 'passport',
        page: '/p',
      },
    ]);
    const asRadio = await svc.assembleDiff(APP, [
      {
        fieldKey: 'has_national_id',
        targetField: '#r',
        mappedValue: 'Yes',
        category: 'passport',
        page: '/p',
        op: 'radio',
      },
    ]);
    expect(asRadio.entries[0]).toMatchObject({ op: 'radio' });
    expect(asValue.entries[0]).not.toHaveProperty('op');
    expect(asRadio.diffHash).not.toBe(asValue.diffHash);
    // Display-only flags are not hashed.
    const declared = await svc.assembleDiff(APP, [
      {
        fieldKey: 'has_national_id',
        targetField: '#r',
        mappedValue: 'Yes',
        category: 'passport',
        page: '/p',
        op: 'radio',
        declaration: true,
        label: 'x',
      },
    ]);
    expect(declared.diffHash).toBe(asRadio.diffHash);
  });
});

describe('PreflightService — completion + lock (B, C, D, F)', () => {
  it('completes only with all checks + active consultant, locks a snapshot hash', async () => {
    const { svc, prov, cons, auditRepo } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');

    const review = await svc.start(APP, C1);
    await expect(svc.complete(review.id, MAPPINGS, C1, APP)).rejects.toThrow(
      /all six checks/,
    );

    await setAllChecks(svc, review.id);
    const done = await svc.complete(review.id, MAPPINGS, C1, APP);
    expect(done.status).toBe('completed');
    expect(done.locked_diff_hash).toBeTruthy();

    expect(
      auditRepo.rows.filter((e) => e.event_type === 'PREFLIGHT_STARTED'),
    ).toHaveLength(1);
    expect(
      auditRepo.rows.filter((e) => e.event_type === 'PREFLIGHT_COMPLETED'),
    ).toHaveLength(1);
    expect((await new AuditService(auditRepo).verifyChain(APP)).intact).toBe(
      true,
    );
  });

  it('refuses completion without an active consultant', async () => {
    // An admin can run the review, but the lock still needs an assignee.
    const { svc, prov } = make();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, ADMIN);
    for (const c of CHECKS)
      await svc.recordCheck(review.id, c, true, APP, ADMIN);
    await expect(svc.complete(review.id, MAPPINGS, ADMIN, APP)).rejects.toThrow(
      /no active consultant/,
    );
  });
});

describe('PreflightService — lock validation valid path (E)', () => {
  it('validates an unchanged completed lock', async () => {
    const { svc, prov, cons } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, C1);
    await setAllChecks(svc, review.id);
    await svc.complete(review.id, MAPPINGS, C1, APP);

    const v = await svc.validateLock(review.id, MAPPINGS, APP);
    expect(v).toEqual({ valid: true, reasons: [] });
  });
});

describe('PreflightService — lock invalidation (E)', () => {
  async function completed() {
    const ctx = makeAssigned();
    await seedProv(ctx.prov, 'passport_number', 'X1');
    const review = await ctx.svc.start(APP, C1);
    await setAllChecks(ctx.svc, review.id);
    await ctx.svc.complete(review.id, MAPPINGS, C1, APP);
    return { ...ctx, reviewId: review.id };
  }

  it('invalidates on provenance change + stale approval', async () => {
    const { svc, prov, cons, reviewId } = await completed();
    // a consultant approval bound to X1, then provenance changes -> stale + content drift
    await cons.approveField(
      APP,
      C1.id!,
      'passport_number',
      prov.valueHash('X1'),
    );
    await prov.supersedeFieldProvenance({
      applicationId: APP,
      fieldKey: 'passport_number',
      origin: 'intake',
      value: 'X2',
    });

    const v = await svc.validateLock(reviewId, MAPPINGS, APP);
    expect(v.valid).toBe(false);
    expect(v.reasons).toEqual(
      expect.arrayContaining([
        'stale_approval',
        'provenance_or_mapping_changed',
      ]),
    );
  });

  it('invalidates on consultant reassignment', async () => {
    const { svc, cons, reviewId } = await completed();
    await cons.reassign(APP, 'cons-2');
    const v = await svc.validateLock(reviewId, MAPPINGS, APP);
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('consultant_reassigned');
  });

  it('invalidates on verification drift', async () => {
    const { svc, verif, reviewId } = await completed();
    await verif.ensureFields(APP, [
      { fieldKey: 'dob', section: 'dates', value: 'v' },
    ]);
    await verif.confirmField(APP, 'dob', { id: 'u1', role: 'applicant' }, 'h');
    await verif.onValueChanged(APP, 'dob', 'NEW'); // drift -> reset, timestamps retained

    const v = await svc.validateLock(reviewId, MAPPINGS, APP);
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('verification_drift');
  });
});

/**
 * P0: a `:reviewId` was never bound to the `:applicationId` it was addressed
 * under. Every repository method runs on the RLS-bypassing service-role client
 * keyed on the review id alone, so a caller who legitimately owned application
 * A could pass their own id in the path together with a review id belonging to
 * application B and act on the victim's review — ticking its pre-submission
 * checks or completing it, which mints the locked_diff_hash the execution path
 * treats as its trust anchor.
 */
describe('preflight review is bound to its application', () => {
  const OTHER_APP = 'app-2';

  it('refuses recordCheck when the review belongs to another application', async () => {
    const { svc } = makeAssigned();
    const review = await svc.start(APP, C1);
    await expect(
      svc.recordCheck(review.id, 'passport_reviewed', true, OTHER_APP, C1),
    ).rejects.toThrow(/preflight not found/i);
  });

  it('refuses complete when the review belongs to another application', async () => {
    const { svc } = makeAssigned();
    const review = await svc.start(APP, C1);
    await setAllChecks(svc, review.id);
    await expect(
      svc.complete(review.id, MAPPINGS, C1, OTHER_APP),
    ).rejects.toThrow(/preflight not found/i);
  });

  it('refuses validateLock when the review belongs to another application', async () => {
    const { svc } = makeAssigned();
    const review = await svc.start(APP, C1);
    await expect(
      svc.validateLock(review.id, MAPPINGS, OTHER_APP),
    ).rejects.toThrow(/preflight not found/i);
  });

  it('does not confirm the id exists elsewhere — same error as a missing review', async () => {
    // Distinguishing "wrong application" from "no such review" would confirm a
    // guessed review id for an attacker.
    const { svc } = makeAssigned();
    const review = await svc.start(APP, C1);
    const wrongApp = await svc
      .validateLock(review.id, MAPPINGS, OTHER_APP)
      .catch((e: Error) => e.message);
    const missing = await svc
      .validateLock('no-such-review', MAPPINGS, APP)
      .catch((e: Error) => e.message);
    expect(wrongApp).toBe(`preflight not found: ${review.id}`);
    expect(missing).toBe('preflight not found: no-such-review');
  });

  it('still allows the correct application through', async () => {
    const { svc } = makeAssigned();
    const review = await svc.start(APP, C1);
    await expect(
      svc.recordCheck(review.id, 'passport_reviewed', true, APP, C1),
    ).resolves.toMatchObject({ id: review.id });
  });
});

/**
 * getActive answered only `in_review` rows, so the moment a consultant locked a
 * review it vanished: the panel fell back to "Not started" and the applicant's
 * readback gate showed "Awaiting consultant review" forever — the lock was
 * unreachable from the UI. The current review is the in-review one, else the
 * latest completed (live) lock.
 */
describe('PreflightService — current review + re-review', () => {
  it('getActive returns the completed lock after completion', async () => {
    const { svc, prov, cons } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, C1);
    await setAllChecks(svc, review.id);
    await svc.complete(review.id, MAPPINGS, C1, APP);

    const current = await svc.getActive(APP);
    expect(current?.id).toBe(review.id);
    expect(current?.status).toBe('completed');
  });

  it('starting a new review invalidates the previous lock (one live lock at a time)', async () => {
    const { svc, prov, cons, auditRepo } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const first = await svc.start(APP, C1);
    await setAllChecks(svc, first.id);
    await svc.complete(first.id, MAPPINGS, C1, APP);

    const second = await svc.start(APP, C1);
    expect((await svc.getActive(APP))?.id).toBe(second.id);
    expect((await svc.getReview(first.id))?.status).toBe('invalidated');
    expect((await svc.validateLock(first.id, MAPPINGS, APP)).reasons).toContain(
      'already_invalidated',
    );
    const started = auditRepo.rows.filter(
      (e) => e.event_type === 'PREFLIGHT_STARTED',
    );
    expect(started[1].payload).toMatchObject({
      superseded_preflight_id: first.id,
    });
  });

  it('resetChecks clears the given category and the final approval on an in-review review', async () => {
    const { svc } = makeAssigned();
    const review = await svc.start(APP, C1);
    await setAllChecks(svc, review.id);
    const after = await svc.resetChecks(review.id, ['dates_reviewed']);
    expect(after.dates_reviewed).toBe(false);
    expect(after.final_approval).toBe(false);
    expect(after.passport_reviewed).toBe(true);
  });
});

/**
 * Review findings (2026-10-15): the review routes admitted the applicant, and
 * start retires the live lock — so an applicant could knock out the
 * consultant's lock at will. complete() also trusted the client's copy of the
 * mappings.
 */
describe('PreflightService — who may review, and what gets locked', () => {
  const APPLICANT: ActorRef = { id: 'appl-1', role: 'applicant' };

  it('refuses an applicant opening, ticking or locking a review', async () => {
    const { svc } = makeAssigned();
    await expect(svc.start(APP, APPLICANT)).rejects.toThrow(
      /assigned consultant/,
    );
    const review = await svc.start(APP, C1);
    await expect(
      svc.recordCheck(review.id, 'passport_reviewed', true, APP, APPLICANT),
    ).rejects.toThrow(/assigned consultant/);
    await expect(
      svc.complete(review.id, MAPPINGS, APPLICANT, APP),
    ).rejects.toThrow(/assigned consultant/);
  });

  it('refuses a consultant who is not the active assignee', async () => {
    const { svc } = makeAssigned();
    await expect(
      svc.start(APP, { id: 'cons-9', role: 'consultant' }),
    ).rejects.toThrow(/not the active assignee/);
  });

  it('an applicant cannot retire a live lock', async () => {
    const { svc, prov } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, C1);
    await setAllChecks(svc, review.id);
    await svc.complete(review.id, MAPPINGS, C1, APP);
    await expect(svc.start(APP, APPLICANT)).rejects.toThrow();
    expect((await svc.getReview(review.id))?.status).toBe('completed');
  });

  it('starting while a review is in progress is a 409, and touches nothing', async () => {
    const { svc } = makeAssigned();
    await svc.start(APP, C1);
    await expect(svc.start(APP, C1)).rejects.toMatchObject({ status: 409 });
  });

  it('complete() refuses when the values moved since the consultant loaded them', async () => {
    const { svc, prov, derived } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, C1);
    await setAllChecks(svc, review.id);
    derived.mappings = [{ ...MAPPINGS[0], mappedValue: 'X9' }]; // applicant saved
    await expect(
      svc.complete(review.id, MAPPINGS, C1, APP),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect((await svc.getReview(review.id))?.status).toBe('in_review');
  });

  // Prod 2026-10-15: an admin opened the review, the assigned consultant
  // ticked and locked it, and the lock carried the ADMIN as reviewer — so
  // validateLock reported consultant_reassigned and auto-fill never unlocked.
  it('a lock completed by the assigned consultant is bound to them and validates', async () => {
    const { svc, prov } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, ADMIN);
    await setAllChecks(svc, review.id);
    const done = await svc.complete(review.id, MAPPINGS, C1, APP);
    expect(done.reviewer_id).toBe(C1.id);
    expect(done.reviewer_role).toBe('consultant');
    const v = await svc.validateLock(review.id, MAPPINGS, APP);
    expect(v).toEqual({ valid: true, reasons: [] });
  });

  it('refuses a lock that would not be bound to the assigned consultant', async () => {
    const { svc, prov } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, ADMIN);
    await setAllChecks(svc, review.id);
    await expect(
      svc.complete(review.id, MAPPINGS, ADMIN, APP),
    ).rejects.toMatchObject({ status: 409 });
    expect((await svc.getReview(review.id))?.status).toBe('in_review');
  });

  // Prod 2026-10-15: every lock failed validation with
  // provenance_or_mapping_changed. The anchor hashed completedAt as JS wrote
  // it ("…24.900Z"), but PostgREST returns timestamptz as "…24.9+00:00", so
  // the re-derived hash never matched.
  it('validates a lock whose completed_at comes back in Postgres format', async () => {
    const { svc, prov, preflightRepo } = makeAssigned();
    await seedProv(prov, 'passport_number', 'X1');
    const review = await svc.start(APP, C1);
    await setAllChecks(svc, review.id);
    await svc.complete(review.id, MAPPINGS, C1, APP);
    const row = preflightRepo.rows.find((r) => r.id === review.id)!;
    const d = new Date(row.completed_at!);
    d.setUTCMilliseconds(900);
    row.completed_at = d.toISOString().replace('.900Z', '.9+00:00');
    // Re-hash the stored anchor as complete() would have at .900Z.
    const diff = await svc.assembleDiff(APP, MAPPINGS);
    row.locked_diff_hash = (
      svc as unknown as {
        computeSnapshotHash: (...a: (string | null)[]) => string;
      }
    ).computeSnapshotHash(diff.diffHash, APP, C1.id, d.toISOString());
    const v = await svc.validateLock(review.id, MAPPINGS, APP);
    expect(v).toEqual({ valid: true, reasons: [] });
  });
});
