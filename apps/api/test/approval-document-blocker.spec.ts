import { ConflictException } from '@nestjs/common';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import { PlanReviewPayoutService } from '../src/modules/payouts/plan-review-payout.service';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';
import { FakeConsultantRepository } from './fakes/FakeConsultantRepository';

/**
 * Live 2026-10-20: a document marked "Needs re-upload" did not block the
 * application approval (rejected/revoked fields and sections did). Modules
 * register approval blockers; any reason refuses the approval (409) and makes
 * the rollup not-approved.
 */
const APP = 'app-1';
const C1 = 'cons-1';
const REASON =
  'Cannot approve yet: a document has an open review request: passport.pdf (re-upload requested).';

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
  let blocker: string | null | Error = null;
  svc.registerApplicationApprovalBlocker(() =>
    blocker instanceof Error
      ? Promise.reject(blocker)
      : Promise.resolve(blocker),
  );
  return {
    svc,
    credit,
    setBlocker: (b: string | null | Error) => {
      blocker = b;
    },
  };
}

describe('ConsultantApprovalService — document approval blockers', () => {
  it('approves when no blocker reports a reason', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(true);
    expect(rollup.approvalBlockers).toEqual([]);
  });

  it('refuses the approval with a 409 carrying the reason, and records nothing', async () => {
    const { svc, credit, setBlocker } = make();
    await svc.assign(APP, C1);
    setBlocker(REASON);
    const err = await svc.approveApplication(APP, C1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(REASON);
    expect(
      (await svc.listDecisions(APP)).filter((d) => d.scope === 'application'),
    ).toHaveLength(0);
    expect(credit).not.toHaveBeenCalled();
  });

  it('a request made AFTER the approval makes the rollup not-approved', async () => {
    const { svc, setBlocker } = make();
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    setBlocker(REASON);
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(false);
    expect(rollup.approvalBlockers).toEqual([REASON]);
    // Not a stale lock: the consultant's fix is the document, not a re-lock.
    expect(rollup.applicationApprovalStale).toBe(false);
  });

  it('an unreadable blocker fails closed in the rollup', async () => {
    const { svc, setBlocker } = make();
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    setBlocker(new Error('db down'));
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(false);
    // A distinct reason: not a missing approval, not a document request.
    expect(rollup.approvalCheckUnavailable).toBe(true);
    expect(rollup.approvalBlockers).toEqual([]);
    expect(rollup.applicationApprovalStale).toBe(false);
  });

  it('a readable rollup reports the check as available', async () => {
    const { svc } = make();
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    expect((await svc.getApplicationApproval(APP)).approvalCheckUnavailable).toBe(
      false,
    );
  });

  it('an unreadable blocker refuses the approval', async () => {
    const { svc, setBlocker } = make();
    await svc.assign(APP, C1);
    setBlocker(new Error('db down'));
    await expect(svc.approveApplication(APP, C1)).rejects.toThrow('db down');
  });
});
