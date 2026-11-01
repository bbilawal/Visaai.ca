import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { PreflightMappingInput, PreflightReview } from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import { PlanReviewPayoutService } from '../src/modules/payouts/plan-review-payout.service';
import { ApprovalLockGate } from '../src/modules/preflight/approval-lock.gate';
import type { PreflightService } from '../src/modules/preflight/preflight.service';
import type { PreflightMappingService } from '../src/modules/preflight/preflight-mapping.service';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';
import { FakeConsultantRepository } from './fakes/FakeConsultantRepository';

/**
 * Live 2026-10-19: "Approve application" succeeded while the pre-submission
 * review was not locked (a new review had just been started). Approval turns
 * auto-fill on, so it now needs a currently valid lock whenever the route has
 * a portal fill to review.
 */
const APP = 'app-1';
const C1 = 'cons-1';
const MAPPING: PreflightMappingInput = {
  fieldKey: 'given_name',
  targetField: 'givenName',
  mappedValue: 'A',
  category: 'passport',
};

function review(over: Partial<PreflightReview>): PreflightReview {
  return {
    id: 'rev-1',
    application_id: APP,
    status: 'completed',
    locked_diff_hash: 'h',
    ...over,
  } as PreflightReview;
}

function make(opts: {
  mappings: PreflightMappingInput[];
  active: PreflightReview | null;
  valid?: { valid: boolean; reasons: string[] };
}) {
  const svc = new ConsultantApprovalService(
    new FakeConsultantRepository(),
    new ProvenanceService(
      new FakeProvenanceRepository(),
      new AuditService(new FakeAuditRepository()),
    ),
    new AuditService(new FakeAuditRepository()),
    {
      creditExpertReview: () => Promise.resolve({ recorded: false }),
    } as unknown as PlanReviewPayoutService,
  );
  const state = { active: opts.active };
  const preflight = {
    getActive: jest.fn(() => Promise.resolve(state.active)),
    validateLock: jest
      .fn()
      .mockResolvedValue(opts.valid ?? { valid: true, reasons: [] }),
  };
  const mappings = {
    forApplication: jest.fn().mockResolvedValue(opts.mappings),
  };
  const gate = new ApprovalLockGate(
    svc,
    preflight as unknown as PreflightService,
    mappings as unknown as PreflightMappingService,
  );
  gate.onModuleInit();
  return { svc, preflight, mappings, state };
}

describe('ApprovalLockGate — approve needs a valid pre-submission lock', () => {
  it('approves when the lock is completed and still valid', async () => {
    const { svc, preflight } = make({
      mappings: [MAPPING],
      active: review({}),
    });
    await svc.assign(APP, C1);
    await expect(svc.approveApplication(APP, C1)).resolves.toMatchObject({
      decision: 'approved',
    });
    expect(preflight.validateLock).toHaveBeenCalledWith(
      'rev-1',
      [MAPPING],
      APP,
    );
  });

  it('rejects when no review was ever started', async () => {
    const { svc } = make({ mappings: [MAPPING], active: null });
    await svc.assign(APP, C1);
    await expect(svc.approveApplication(APP, C1)).rejects.toThrow(
      /Lock the pre-submission review first/,
    );
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      false,
    );
  });

  it('rejects while a review is in progress (not locked)', async () => {
    const { svc, preflight } = make({
      mappings: [MAPPING],
      active: review({ status: 'in_review', locked_diff_hash: null }),
    });
    await svc.assign(APP, C1);
    await expect(svc.approveApplication(APP, C1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(preflight.validateLock).not.toHaveBeenCalled();
  });

  it('rejects when the lock is no longer valid', async () => {
    const { svc } = make({
      mappings: [MAPPING],
      active: review({}),
      valid: { valid: false, reasons: ['provenance_or_mapping_changed'] },
    });
    await svc.assign(APP, C1);
    await expect(svc.approveApplication(APP, C1)).rejects.toThrow(
      /no longer valid \(provenance_or_mapping_changed\)/,
    );
  });

  it('approves a route without a portal fill (nothing to lock)', async () => {
    const { svc, preflight } = make({ mappings: [], active: null });
    await svc.assign(APP, C1);
    await expect(svc.approveApplication(APP, C1)).resolves.toMatchObject({
      decision: 'approved',
    });
    expect(preflight.getActive).not.toHaveBeenCalled();
  });

  it('still authorizes first: a non-assignee gets 403, not the lock message', async () => {
    const { svc } = make({ mappings: [MAPPING], active: null });
    await svc.assign(APP, C1);
    await expect(svc.approveApplication(APP, 'cons-2')).rejects.toThrow(
      /not the active assignee/,
    );
  });

  it('leaves reject allowed without a lock', async () => {
    const { svc } = make({ mappings: [MAPPING], active: null });
    await svc.assign(APP, C1);
    await expect(
      svc.rejectApplication(APP, C1, 'needs changes'),
    ).resolves.toMatchObject({ decision: 'rejected' });
  });
});

/**
 * Live 2026-10-19: approved in the morning; the data changed, the review was
 * re-locked at 15:19 and the new approval failed — yet the Submit page still
 * read "Approved" and launched auto-fill off the morning approval. An
 * application approval only counts when decided at or after the live lock.
 */
describe('application approval must postdate the live lock', () => {
  const later = (iso: string, ms: number) =>
    new Date(Date.parse(iso) + ms).toISOString();

  it('an approval older than the lock (T1 < T2) does not count', async () => {
    const { svc, state } = make({ mappings: [MAPPING], active: review({}) });
    await svc.assign(APP, C1);
    const t1 = (await svc.approveApplication(APP, C1)).decided_at;
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      false, // the fixture lock has no completed_at: no live lock
    );
    state.active = review({ completed_at: later(t1, 500) });
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(false);
    expect(rollup.applicationApprovalStale).toBe(true);
  });

  it('an approval at or after the lock (T3 >= T2) counts', async () => {
    const { svc, state } = make({ mappings: [MAPPING], active: review({}) });
    await svc.assign(APP, C1);
    const t1 = (await svc.approveApplication(APP, C1)).decided_at;
    state.active = review({ completed_at: later(t1, 500) });
    const t3 = (await svc.approveApplication(APP, C1)).decided_at;
    expect(Date.parse(t3)).toBeGreaterThan(Date.parse(t1) + 500);
    let rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(true);
    expect(rollup.applicationApprovalStale).toBe(false);

    state.active = review({ completed_at: t3 }); // same instant still counts
    rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(true);
  });

  it('does not count while a new review is in progress (old lock retired)', async () => {
    const { svc, state } = make({ mappings: [MAPPING], active: review({}) });
    await svc.assign(APP, C1);
    const t1 = (await svc.approveApplication(APP, C1)).decided_at;
    state.active = review({ completed_at: later(t1, -500) });
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      true,
    );
    state.active = review({ status: 'in_review', locked_diff_hash: null });
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(false);
    expect(rollup.applicationApprovalStale).toBe(true);
  });

  it('a route without a portal fill keeps counting any approval (no lock)', async () => {
    const { svc } = make({ mappings: [], active: null });
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(true);
    expect(rollup.applicationApprovalStale).toBe(false);
  });

  it('fails closed when the lock cannot be read', async () => {
    const { svc, mappings } = make({ mappings: [], active: null });
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    mappings.forApplication.mockRejectedValue(new Error('db down'));
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(false);
    // Infrastructure, not the consultant's to fix: not reported as stale.
    expect(rollup.applicationApprovalStale).toBe(false);
  });
});

describe('ConsultantApprovalService — approval fails closed without a gate', () => {
  it('refuses approval (503) when no approval gate is registered', async () => {
    const svc = new ConsultantApprovalService(
      new FakeConsultantRepository(),
      new ProvenanceService(
        new FakeProvenanceRepository(),
        new AuditService(new FakeAuditRepository()),
      ),
      new AuditService(new FakeAuditRepository()),
      {
        creditExpertReview: () => Promise.resolve({ recorded: false }),
      } as unknown as PlanReviewPayoutService,
    );
    await svc.assign(APP, C1);
    await expect(svc.approveApplication(APP, C1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect((await svc.getApplicationApproval(APP)).applicationApproved).toBe(
      false,
    );
  });

  it('does not count an approval when no lock source is registered (not stale)', async () => {
    const svc = new ConsultantApprovalService(
      new FakeConsultantRepository(),
      new ProvenanceService(
        new FakeProvenanceRepository(),
        new AuditService(new FakeAuditRepository()),
      ),
      new AuditService(new FakeAuditRepository()),
      {
        creditExpertReview: () => Promise.resolve({ recorded: false }),
      } as unknown as PlanReviewPayoutService,
    );
    svc.registerApplicationApprovalGate(() => Promise.resolve());
    await svc.assign(APP, C1);
    await svc.approveApplication(APP, C1);
    const rollup = await svc.getApplicationApproval(APP);
    expect(rollup.applicationApproved).toBe(false);
    expect(rollup.applicationApprovalStale).toBe(false);
  });
});
