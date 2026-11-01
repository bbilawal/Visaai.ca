import type {
  AuditEvent,
  EligibilityResult,
  ExecutionRequestInput,
} from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from '../src/modules/audit/audit.repository';
import { ExecutionRequestService } from '../src/modules/execution-request/execution-request.service';
import type { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import type { PreflightService } from '../src/modules/preflight/preflight.service';
import type { ReadbackTokenService } from '../src/modules/execution/readback-token.service';

class FakeAuditRepository implements IAuditRepository {
  rows: AuditEvent[] = [];
  private n = 0;
  async getChainHead(app: string): Promise<ChainHead | null> {
    const r = this.rows.filter((x) => x.application_id === app);
    if (!r.length) return null;
    const h = r.reduce((a, b) => (b.seq > a.seq ? b : a));
    return { seq: h.seq, rowHash: h.row_hash };
  }
  async appendEvent(row: NewAuditEventRow): Promise<AuditEvent> {
    const full: AuditEvent = { id: `evt-${++this.n}`, ...row };
    this.rows.push(full);
    return full;
  }
  async getTrail(app: string): Promise<AuditEvent[]> {
    return this.rows
      .filter((x) => x.application_id === app)
      .sort((a, b) => a.seq - b.seq);
  }
  async findByIdempotencyKey(
    app: string,
    key: string,
  ): Promise<AuditEvent | null> {
    return (
      this.rows.find(
        (r) => r.application_id === app && r.payload?.idempotency_key === key,
      ) ?? null
    );
  }
}

const INPUT: ExecutionRequestInput = {
  applicationId: 'app-1',
  preflightReviewId: 'pf-1',
  mappings: [],
  token: 'tok',
  sessionId: 'sess-1',
  userId: 'u1',
  userConfirmationFlag: true,
};

const ELIGIBLE: EligibilityResult = {
  applicationId: 'app-1',
  eligible: true,
  conditions: {
    paymentCompleted: true,
    consultantApprovalValid: true,
    preflightLockValid: true,
    executionTokenValid: true,
  },
  reasons: [],
};
const BLOCKED: EligibilityResult = {
  applicationId: 'app-1',
  eligible: false,
  conditions: {
    paymentCompleted: true,
    consultantApprovalValid: false,
    preflightLockValid: false,
    executionTokenValid: true,
  },
  reasons: ['consultant_stale', 'preflight_invalid'],
};

function make(evalResult: EligibilityResult) {
  const auditRepo = new FakeAuditRepository();
  const eligibility = {
    evaluate: jest.fn().mockResolvedValue(evalResult),
    assert: jest.fn(),
    isTokenValid: jest.fn(),
  };
  const preflight = {
    getReview: jest.fn().mockResolvedValue({
      id: 'pf-1',
      status: 'completed',
      locked_diff_hash: 'LH',
    }),
  };
  const readbackTokens = {
    mint: jest.fn().mockReturnValue('readback.tok'),
    verify: jest.fn(),
  };
  const svc = new ExecutionRequestService(
    eligibility as unknown as ExecutionEligibilityService,
    new AuditService(auditRepo),
    preflight as unknown as PreflightService,
    readbackTokens as unknown as ReadbackTokenService,
  );
  return { svc, eligibility, auditRepo, readbackTokens };
}

const types = (r: FakeAuditRepository) => r.rows.map((e) => e.event_type);

describe('ExecutionRequestService — server-authoritative gate (Phase 3F)', () => {
  it('blocks when readback not confirmed (and does not even evaluate)', async () => {
    const { svc, eligibility, auditRepo } = make(ELIGIBLE);
    const out = await svc.request({ ...INPUT, userConfirmationFlag: false });
    expect(out).toEqual({
      allowed: false,
      blockedReasons: ['readback_not_confirmed'],
      evaluationDetails: null,
    });
    expect(eligibility.evaluate).not.toHaveBeenCalled();
    expect(auditRepo.rows).toHaveLength(0);
  });

  it('allows when confirmed + eligible, emits events, mints bound readback token', async () => {
    const { svc, auditRepo, readbackTokens } = make(ELIGIBLE);
    const out = await svc.request(INPUT);
    expect(out.allowed).toBe(true);
    expect(out.blockedReasons).toEqual([]);
    expect(out.readbackToken).toBe('readback.tok');
    expect(readbackTokens.mint).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app-1',
        preflightReviewId: 'pf-1',
        lockedDiffHash: 'LH',
      }),
    );
    expect(types(auditRepo)).toEqual([
      'READBACK_CONFIRMED',
      'EXECUTION_REQUESTED',
    ]);
  });

  it('blocks when confirmed but ineligible, passing through reasons, no request events', async () => {
    const { svc, auditRepo } = make(BLOCKED);
    const out = await svc.request(INPUT);
    expect(out.allowed).toBe(false);
    expect(out.blockedReasons).toEqual([
      'consultant_stale',
      'preflight_invalid',
    ]);
    expect(types(auditRepo)).toEqual([]); // no READBACK_CONFIRMED / EXECUTION_REQUESTED on failure
  });

  it('never emits EXECUTION_STARTED (no execution from the gate)', async () => {
    const { svc, auditRepo } = make(ELIGIBLE);
    await svc.request(INPUT);
    expect(types(auditRepo)).not.toContain('EXECUTION_STARTED');
  });

  it('is idempotent across repeated requests', async () => {
    const { svc, auditRepo } = make(ELIGIBLE);
    await svc.request(INPUT);
    await svc.request(INPUT);
    expect(
      auditRepo.rows.filter((e) => e.event_type === 'EXECUTION_REQUESTED'),
    ).toHaveLength(1);
    expect(
      auditRepo.rows.filter((e) => e.event_type === 'READBACK_CONFIRMED'),
    ).toHaveLength(1);
    expect(
      (await new AuditService(auditRepo).verifyChain('app-1')).intact,
    ).toBe(true);
  });
});
