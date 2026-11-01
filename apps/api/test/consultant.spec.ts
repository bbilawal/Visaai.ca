import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';
import { FakeConsultantRepository } from './fakes/FakeConsultantRepository';
import { PlanReviewPayoutService } from '../src/modules/payouts/plan-review-payout.service';

const APP = 'app-1';
const C1 = 'cons-1';
const C2 = 'cons-2';

function make() {
  const prov = new ProvenanceService(
    new FakeProvenanceRepository(),
    new AuditService(new FakeAuditRepository()),
  );
  const auditRepo = new FakeAuditRepository();
  const repo = new FakeConsultantRepository();
  const svc = new ConsultantApprovalService(
    repo,
    prov,
    new AuditService(auditRepo),
    {
      creditExpertReview: () => Promise.resolve({ recorded: false }),
    } as unknown as PlanReviewPayoutService,
  );
  // The pre-submission lock gate is PreflightModule's (approval-lock.gate.spec);
  // approval fails closed without one, so register a pass-through here. Same
  // for the lock an approval must postdate: no portal fill, nothing to cover.
  svc.registerApplicationApprovalGate(() => Promise.resolve());
  svc.registerApplicationApprovalLockSource(() =>
    Promise.resolve({ requiresLock: false, lockedAt: null }),
  );
  return { svc, repo, prov, auditRepo };
}

/** Seed a current provenance value for a field; returns its value_hash. */
async function seedField(
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

describe('ConsultantApprovalService — assignment lifecycle (A)', () => {
  it('assigns, reassigns, and keeps history', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    expect((await svc.getAssignment(APP))!.consultant_id).toBe(C1);

    await svc.reassign(APP, C2);
    expect((await svc.getAssignment(APP))!.consultant_id).toBe(C2);

    const history = await svc.getAssignmentHistory(APP);
    expect(history).toHaveLength(2);
    expect(history[0].status).toBe('released');
    expect(history[1].status).toBe('active');
  });

  it('refuses a second active assignment (use reassign)', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    await expect(svc.assign(APP, C2)).rejects.toThrow(/already has an active/);
  });
});

describe('ConsultantApprovalService — decision recording (B)', () => {
  it('records review/approve/reject and enforces assignment + reason', async () => {
    const { svc, prov } = make();
    await svc.assign(APP, C1);
    const vh = await seedField(prov, 'passport_number', 'X1');

    await svc.reviewField(APP, C1, 'passport_number', vh);
    await svc.approveField(APP, C1, 'passport_number', vh);
    const decisions = await svc.listDecisions(APP);
    expect(decisions.map((d) => d.decision)).toEqual(['reviewed', 'approved']);

    await expect(
      svc.approveField(APP, C2, 'passport_number', vh),
    ).rejects.toThrow(/not the active assignee/);
    await expect(
      svc.rejectField(APP, C1, 'passport_number', ''),
    ).rejects.toThrow(/requires a reason/);
  });
});

describe('ConsultantApprovalService — value-hash staleness (C)', () => {
  it('approval goes stale when the field value_hash changes', async () => {
    const { svc, prov } = make();
    await svc.assign(APP, C1);
    const vh1 = await seedField(prov, 'passport_number', 'X1');
    await svc.approveField(APP, C1, 'passport_number', vh1);

    let rollup = await svc.getApplicationApproval(APP);
    expect(rollup.fields[0]).toMatchObject({ approved: true, stale: false });

    // value changes -> new provenance version -> current hash differs
    await prov.supersedeFieldProvenance({
      applicationId: APP,
      fieldKey: 'passport_number',
      origin: 'intake',
      value: 'X2',
    });

    rollup = await svc.getApplicationApproval(APP);
    expect(rollup.fields[0]).toMatchObject({ approved: false, stale: true });
  });
});

describe('ConsultantApprovalService — rollups (D)', () => {
  it('rolls up field + section + application approval', async () => {
    const { svc, prov } = make();
    await svc.assign(APP, C1);
    const vh = await seedField(prov, 'passport_number', 'X1');

    await svc.approveField(APP, C1, 'passport_number', vh);
    await svc.approveSection(APP, C1, 'passport');
    await svc.approveApplication(APP, C1);

    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.fields[0].approved).toBe(true);
    expect(rollup.sections[0]).toMatchObject({
      section: 'passport',
      approved: true,
    });
    expect(rollup.applicationApproved).toBe(true);
  });
});

describe('ConsultantApprovalService — application-level decisions (B2)', () => {
  it('approve requires the active assignee and flips the rollup', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);

    await expect(svc.approveApplication(APP, C2)).rejects.toThrow(
      /not the active assignee/,
    );

    const dec = await svc.approveApplication(APP, C1);
    expect(dec).toMatchObject({ scope: 'application', decision: 'approved' });
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      true,
    );
  });

  it('reject requires a reason, enforces assignment, and blocks approval', async () => {
    const { svc, auditRepo } = make();
    await svc.assign(APP, C1);

    await expect(svc.rejectApplication(APP, C1, '   ')).rejects.toThrow(
      /requires a reason/,
    );
    await expect(svc.rejectApplication(APP, C2, 'bad')).rejects.toThrow(
      /not the active assignee/,
    );

    await svc.approveApplication(APP, C1);
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      true,
    );

    const dec = await svc.rejectApplication(APP, C1, 'insufficient evidence');
    expect(dec).toMatchObject({
      scope: 'application',
      decision: 'rejected',
      reason: 'insufficient evidence',
    });
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      false,
    );

    const evt = auditRepo.rows.find((e) => e.payload?.action === 'rejected');
    expect(evt).toBeDefined();
    expect(evt!.event_type).toBe('FIELD_EDITED');
  });
});

describe('ConsultantApprovalService — revocation (E)', () => {
  it('revocation invalidates downstream application approval', async () => {
    const { svc, prov, auditRepo } = make();
    await svc.assign(APP, C1);
    const vh = await seedField(prov, 'passport_number', 'X1');
    await svc.approveField(APP, C1, 'passport_number', vh);
    await svc.approveApplication(APP, C1);
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      true,
    );

    await svc.revoke(
      APP,
      C1,
      { scope: 'field', fieldKey: 'passport_number' },
      'document tampered',
    );

    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.fields[0].decision).toBe('revoked');
    expect(rollup.fields[0].approved).toBe(false);
    expect(rollup.applicationApproved).toBe(false);

    const evt = auditRepo.rows.find((e) => e.payload?.action === 'revoked');
    expect(evt).toBeDefined();
    expect(evt!.event_type).toBe('FIELD_EDITED');
  });
});

describe('ConsultantApprovalService — audit emission (F)', () => {
  it('emits correct event types and keeps the chain intact', async () => {
    const { svc, prov, auditRepo } = make();
    await svc.assign(APP, C1);
    const vh = await seedField(prov, 'f', 'v');
    await svc.reviewField(APP, C1, 'f', vh);
    await svc.approveField(APP, C1, 'f', vh);
    await svc.rejectField(APP, C1, 'g', 'bad scan');
    await svc.revoke(APP, C1, { scope: 'field', fieldKey: 'f' }, 'withdrawn');

    expect(auditRepo.rows.map((e) => e.event_type)).toEqual([
      'CONSULTANT_REVIEWED',
      'CONSULTANT_APPROVED',
      'FIELD_EDITED',
      'FIELD_EDITED',
    ]);
    expect((await new AuditService(auditRepo).verifyChain(APP)).intact).toBe(
      true,
    );
  });
});

/**
 * Dry run 2026-10-14 (#32): OCR read junk into fields that do not apply to the
 * application (a sponsor job title, a currency "V"). The only way to say "do
 * not use this" was Reject — which blocks portal auto-fill for the WHOLE
 * application. 'not_applicable' records the same judgement without the block.
 */
describe('ConsultantApprovalService — not applicable (G)', () => {
  it('records a not_applicable decision for the active assignee only', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    const row = await svc.markFieldNotApplicable(
      APP,
      C1,
      'sponsor_occupation',
      'OCR junk from an unrelated document',
    );
    expect(row.decision).toBe('not_applicable');
    expect(row.field_key).toBe('sponsor_occupation');
    await expect(
      svc.markFieldNotApplicable(APP, C2, 'sponsor_occupation'),
    ).rejects.toThrow(/not the active assignee/);
  });

  it('does NOT block the application approval (reject does)', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    await svc.markFieldNotApplicable(APP, C1, 'currency');
    await svc.approveApplication(APP, C1);
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(true);
    expect(rollup.fields[0]).toMatchObject({
      fieldKey: 'currency',
      decision: 'not_applicable',
      approved: false,
      stale: false,
    });

    await svc.rejectField(APP, C1, 'currency', 'wrong');
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      false,
    );
  });

  it('lists the fields whose LATEST decision is not_applicable', async () => {
    const { svc, prov } = make();
    await svc.assign(APP, C1);
    const vh = await seedField(prov, 'given_name', 'ADA');
    await svc.markFieldNotApplicable(APP, C1, 'currency');
    await svc.markFieldNotApplicable(APP, C1, 'given_name');
    // A later approval supersedes the not-applicable call (latest wins).
    await svc.approveField(APP, C1, 'given_name', vh);
    expect([...(await svc.notApplicableFieldKeys(APP))]).toEqual(['currency']);
  });
});

describe('an application decision stops the SLA clock (dry run 2026-10-16)', () => {
  it('approving stamps completed_at, so the expiry sweep cannot release it', async () => {
    const { svc, repo } = make();
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    const mine = await repo.getActiveAssignmentFor(APP, C1);
    expect(mine?.completed_at).toEqual(expect.any(String));
  });

  it('rejecting stamps completed_at too', async () => {
    const { svc, repo } = make();
    await svc.assign(APP, C1);
    await svc.rejectApplication(APP, C1, 'missing documents');
    const mine = await repo.getActiveAssignmentFor(APP, C1);
    expect(mine?.completed_at).toEqual(expect.any(String));
  });
});
