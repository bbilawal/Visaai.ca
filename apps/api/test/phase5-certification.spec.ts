import type { AuditEvent, ReadbackTokenPayload } from '@visaai/types';
import type { ConfigService } from '@nestjs/config';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from '../src/modules/audit/audit.repository';
import { ReadbackTokenService } from '../src/modules/execution/readback-token.service';
import { ExecutionService } from '../src/modules/execution/execution.service';
import type { IExecutionTokenStore } from '../src/modules/execution/execution-token.store';
import type { PreflightService } from '../src/modules/preflight/preflight.service';
import type { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import type { VerificationService } from '../src/modules/verification/verification.service';
import type { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import type { Env } from '../src/config/configuration';

const APP = 'app-1';
const LH = 'locked-hash-1';
const config = { get: () => 'cert-secret' } as unknown as ConfigService<Env>;

class CapAuditRepo implements IAuditRepository {
  rows: AuditEvent[] = [];
  failOn: string | null = null;
  private n = 0;
  async getChainHead(app: string): Promise<ChainHead | null> {
    const r = this.rows.filter((x) => x.application_id === app);
    if (!r.length) return null;
    const h = r.reduce((a, b) => (b.seq > a.seq ? b : a));
    return { seq: h.seq, rowHash: h.row_hash };
  }
  async appendEvent(row: NewAuditEventRow): Promise<AuditEvent> {
    if (this.failOn && row.event_type === this.failOn)
      throw new Error('audit write failure');
    const full: AuditEvent = { id: `evt-${++this.n}`, ...row };
    this.rows.push(full);
    return full;
  }
  async getTrail(app: string): Promise<AuditEvent[]> {
    return this.rows
      .filter((x) => x.application_id === app)
      .sort((a, b) => a.seq - b.seq);
  }
  async findByIdempotencyKey(): Promise<AuditEvent | null> {
    return null;
  }
}

function basePayload(): Omit<ReadbackTokenPayload, 'issuedAt'> {
  return {
    applicationId: APP,
    preflightReviewId: 'pf-1',
    sessionId: 'sess-1',
    userId: 'u1',
    executionToken: 'etok',
    lockedDiffHash: LH,
    mappings: [],
  };
}

function passingDeps(auditRepo: CapAuditRepo) {
  const rbt = new ReadbackTokenService(config);
  const used = new Set<string>();
  const tokenStore: IExecutionTokenStore = {
    consume: jest.fn(async (h: string) =>
      used.has(h) ? false : (used.add(h), true),
    ),
  };
  const preflight = {
    getReview: jest.fn().mockResolvedValue({
      id: 'pf-1',
      status: 'completed',
      locked_diff_hash: LH,
    }),
    validateLock: jest.fn().mockResolvedValue({ valid: true, reasons: [] }),
  };
  const consultant = {
    getApplicationApproval: jest.fn().mockResolvedValue({
      applicationId: APP,
      applicationApproved: true,
      fields: [
        {
          fieldKey: 'f',
          decision: 'approved',
          approved: true,
          stale: false,
          approvedValueHash: 'h',
        },
      ],
      sections: [],
    }),
  };
  const verification = {
    evaluateExecutionReadiness: jest.fn().mockResolvedValue({
      applicationId: APP,
      ready: true,
      requiredSectionsApproved: true,
      consultantApprovalPresent: true,
      noDrift: true,
      blockedSections: [],
      driftedFields: [],
    }),
  };
  const eligibility = {
    evaluate: jest.fn().mockResolvedValue({
      applicationId: APP,
      eligible: true,
      conditions: {
        paymentCompleted: true,
        consultantApprovalValid: true,
        preflightLockValid: true,
        executionTokenValid: true,
      },
      reasons: [],
    }),
  };
  const svc = new ExecutionService(
    rbt,
    preflight as unknown as PreflightService,
    consultant as unknown as ConsultantApprovalService,
    verification as unknown as VerificationService,
    eligibility as unknown as ExecutionEligibilityService,
    new AuditService(auditRepo),
    tokenStore,
  );
  return { svc, rbt, tokenStore };
}

const startedCount = (r: CapAuditRepo) =>
  r.rows.filter((e) => e.event_type === 'EXECUTION_STARTED').length;

describe('Phase 5 — Scope E: concurrency safety', () => {
  it('two concurrent executes with the SAME token yield exactly one EXECUTION_STARTED', async () => {
    const auditRepo = new CapAuditRepo();
    const { svc, rbt } = passingDeps(auditRepo);
    const token = rbt.mint(basePayload());

    const [a, b] = await Promise.all([
      svc.execute(APP, token),
      svc.execute(APP, token),
    ]);
    const started = [a, b].filter((r) => r.started);
    const replayed = [a, b].filter(
      (r) => !r.started && r.reasons.includes('replay_detected'),
    );

    expect(started).toHaveLength(1);
    expect(replayed).toHaveLength(1);
    expect(startedCount(auditRepo)).toBe(1); // no double EXECUTION_STARTED
  });

  it('distinct tokens each start once (deterministic final state)', async () => {
    const auditRepo = new CapAuditRepo();
    const { svc, rbt } = passingDeps(auditRepo);
    const t1 = rbt.mint(basePayload());
    const t2 = rbt.mint({ ...basePayload(), sessionId: 'sess-2' });
    const [a, b] = await Promise.all([
      svc.execute(APP, t1),
      svc.execute(APP, t2),
    ]);
    expect(a.started && b.started).toBe(true);
    expect(startedCount(auditRepo)).toBe(2);
  });
});

describe('Phase 5 — Scope B: fail closed on audit write failure', () => {
  it('execution does NOT silently start if the EXECUTION_STARTED audit write fails', async () => {
    const auditRepo = new CapAuditRepo();
    auditRepo.failOn = 'EXECUTION_STARTED';
    const { svc, rbt } = passingDeps(auditRepo);
    await expect(svc.execute(APP, rbt.mint(basePayload()))).rejects.toThrow(
      /audit write failure/,
    );
    // No EXECUTION_STARTED row was persisted -> execution did not start.
    expect(startedCount(auditRepo)).toBe(0);
  });
});
