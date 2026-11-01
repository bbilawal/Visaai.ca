import { ConflictException } from '@nestjs/common';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import { PlanReviewPayoutService } from '../src/modules/payouts/plan-review-payout.service';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';
import { FakeConsultantRepository } from './fakes/FakeConsultantRepository';

/**
 * Live 2026-10-20 (spousal app): two rejected values (bride_name,
 * bridegroom_name) made the rollup not-approved, yet "Approve application"
 * answered "Application approved" — twice. The consultant saw an approval the
 * applicant's side did not. The endpoint now refuses on the same field and
 * section rule the rollup applies, naming what to fix.
 */
const APP = 'app-1';
const C1 = 'cons-1';

function make() {
  const credit = jest.fn(() => Promise.resolve({ recorded: false }));
  const svc = new ConsultantApprovalService(
    new FakeConsultantRepository(),
    new ProvenanceService(
      new FakeProvenanceRepository(),
      new AuditService(new FakeAuditRepository()),
    ),
    new AuditService(new FakeAuditRepository()),
    { creditExpertReview: credit } as unknown as PlanReviewPayoutService,
  );
  svc.registerApplicationApprovalGate(() => Promise.resolve());
  svc.registerApplicationApprovalLockSource(() =>
    Promise.resolve({ requiresLock: false, lockedAt: null }),
  );
  svc.registerApplicationApprovalBlocker(() => Promise.resolve(null));
  return { svc, credit };
}

const appDecisions = async (svc: ConsultantApprovalService) =>
  (await svc.listDecisions(APP)).filter((d) => d.scope === 'application');

describe('ConsultantApprovalService — rejected values block the approval', () => {
  it('refuses with a 409 naming the rejected fields, and records nothing', async () => {
    const { svc, credit } = make();
    await svc.assign(APP, C1);
    await svc.rejectField(APP, C1, 'bride_name', 'different couple');
    await svc.rejectField(APP, C1, 'bridegroom_name', 'different couple');
    const err = await svc.approveApplication(APP, C1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const msg = (err as ConflictException).message;
    expect(msg).toContain('bride_name');
    expect(msg).toContain('bridegroom_name');
    expect(msg).toMatch(/not applicable/i);
    expect(await appDecisions(svc)).toHaveLength(0);
    expect(credit).not.toHaveBeenCalled();
  });

  it('approves once the rejected values are marked not applicable', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    await svc.rejectField(APP, C1, 'bride_name', 'different couple');
    await svc.markFieldNotApplicable(APP, C1, 'bride_name');
    await svc.approveApplication(APP, C1);
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      true,
    );
  });

  it('a revoked field approval blocks too', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    await svc.revoke(
      APP,
      C1,
      { scope: 'field', fieldKey: 'given_name' },
      'wrong value',
    );
    await expect(svc.approveApplication(APP, C1)).rejects.toThrow(/given_name/);
  });

  it('a stale field approval (the value changed since) blocks', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    // No current value matches this hash: the approved value has moved on.
    await svc.approveField(APP, C1, 'given_name', 'old-hash' as never);
    await expect(svc.approveApplication(APP, C1)).rejects.toThrow(/given_name/);
  });

  it('a rejected section blocks', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    await svc.revoke(APP, C1, { scope: 'section', section: 'travel' }, 'redo');
    await expect(svc.approveApplication(APP, C1)).rejects.toThrow(/travel/);
  });
});
