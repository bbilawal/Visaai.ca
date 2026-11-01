import type { ConfigService } from '@nestjs/config';
import type { AuditEvent, ReadbackTokenPayload } from '@visaai/types';
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
  async findByIdempotencyKey(): Promise<AuditEvent | null> {
    return null;
  }
}

const APP = 'app-1';
const LH = 'locked-hash-1';
const config = { get: () => 'unit-secret' } as unknown as ConfigService<Env>;

function tokenSvc() {
  return new ReadbackTokenService(config);
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

interface Overrides {
  review?: unknown;
  lockValid?: boolean;
  lockReasons?: string[];
  approved?: boolean;
  fieldStale?: boolean;
  noDrift?: boolean;
  eligible?: boolean;
  eligThrows?: boolean;
}

function makeExecution(o: Overrides = {}) {
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo);
  const rbt = tokenSvc();
  const preflight = {
    getReview: jest
      .fn()
      .mockResolvedValue(
        o.review ?? { id: 'pf-1', status: 'completed', locked_diff_hash: LH },
      ),
    validateLock: jest.fn().mockResolvedValue({
      valid: o.lockValid ?? true,
      reasons: o.lockReasons ?? [],
    }),
  };
  const consultant = {
    getApplicationApproval: jest.fn().mockResolvedValue({
      applicationId: APP,
      applicationApproved: o.approved ?? true,
      fields: [
        {
          fieldKey: 'f',
          decision: 'approved',
          approved: true,
          stale: o.fieldStale ?? false,
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
      noDrift: o.noDrift ?? true,
      blockedSections: [],
      driftedFields: [],
    }),
  };
  const eligibility = {
    evaluate: o.eligThrows
      ? jest.fn().mockRejectedValue(new Error('token validator not wired'))
      : jest.fn().mockResolvedValue({
          applicationId: APP,
          eligible: o.eligible ?? true,
          conditions: {
            paymentCompleted: true,
            consultantApprovalValid: true,
            preflightLockValid: true,
            executionTokenValid: true,
          },
          reasons: o.eligible === false ? ['token_invalid'] : [],
        }),
  };
  // In-memory single-use ledger (replay protection).
  const used = new Set<string>();
  const tokenStore: IExecutionTokenStore = {
    consume: jest.fn(async (hash: string) => {
      if (used.has(hash)) return false;
      used.add(hash);
      return true;
    }),
  };
  const svc = new ExecutionService(
    rbt,
    preflight as unknown as PreflightService,
    consultant as unknown as ConsultantApprovalService,
    verification as unknown as VerificationService,
    eligibility as unknown as ExecutionEligibilityService,
    audit,
    tokenStore,
  );
  return { svc, rbt, auditRepo, tokenStore };
}

const types = (r: FakeAuditRepository) => r.rows.map((e) => e.event_type);

describe('ExecutionService — single execution choke point (Phase 3G)', () => {
  it('starts execution when token valid + all live checks pass (one EXECUTION_STARTED)', async () => {
    const { svc, rbt, auditRepo } = makeExecution();
    const token = rbt.mint(basePayload());
    const out = await svc.execute(APP, token);
    expect(out).toEqual({ started: true, reasons: [] });
    expect(types(auditRepo)).toEqual(['EXECUTION_STARTED']);
    expect(
      auditRepo.rows.filter((e) => e.event_type === 'EXECUTION_STARTED'),
    ).toHaveLength(1);
  });

  it('rejects a forged/invalid readback token (readback_stale, no STARTED)', async () => {
    const { svc, auditRepo } = makeExecution();
    const out = await svc.execute(APP, 'not.a.valid.token');
    expect(out.started).toBe(false);
    expect(out.reasons).toContain('readback_stale');
    expect(types(auditRepo)).toEqual(['EXECUTION_FAILED']);
  });

  it('rejects when applicationId does not match the token binding', async () => {
    const { svc, rbt } = makeExecution();
    const token = rbt.mint(basePayload());
    const out = await svc.execute('other-app', token);
    expect(out.started).toBe(false);
    expect(out.reasons).toContain('readback_stale');
  });

  it('blocks when the lock changed since issuance', async () => {
    const { svc, rbt } = makeExecution({
      review: {
        id: 'pf-1',
        status: 'completed',
        locked_diff_hash: 'DIFFERENT',
      },
    });
    const out = await svc.execute(APP, rbt.mint(basePayload()));
    expect(out.started).toBe(false);
    expect(out.reasons).toContain('lock_changed');
  });

  it('blocks on consultant state change (revoked/stale/not approved)', async () => {
    const { svc, rbt } = makeExecution({ approved: false });
    const out = await svc.execute(APP, rbt.mint(basePayload()));
    expect(out.started).toBe(false);
    expect(out.reasons).toContain('consultant_state_changed');
  });

  it('blocks on verification drift', async () => {
    const { svc, rbt } = makeExecution({ noDrift: false });
    const out = await svc.execute(APP, rbt.mint(basePayload()));
    expect(out.started).toBe(false);
    expect(out.reasons).toContain('verification_drift');
  });

  it('blocks when live eligibility recomputes false (not cached)', async () => {
    const { svc, rbt } = makeExecution({ eligible: false });
    const out = await svc.execute(APP, rbt.mint(basePayload()));
    expect(out.started).toBe(false);
    expect(out.reasons).toContain('eligibility_recomputed_false');
  });

  it('fails closed when eligibility evaluation throws (e.g. token validator unwired)', async () => {
    const { svc, rbt, auditRepo } = makeExecution({ eligThrows: true });
    const out = await svc.execute(APP, rbt.mint(basePayload()));
    expect(out.started).toBe(false);
    expect(out.reasons).toContain('eligibility_recomputed_false');
    expect(types(auditRepo)).not.toContain('EXECUTION_STARTED');
  });

  it('never emits EXECUTION_STARTED on any failure path', async () => {
    const { svc, rbt, auditRepo } = makeExecution({
      lockValid: false,
      lockReasons: ['provenance_or_mapping_changed'],
    });
    await svc.execute(APP, rbt.mint(basePayload()));
    expect(types(auditRepo)).toEqual(['EXECUTION_FAILED']);
  });

  it('rejects token replay: a second execution with the same token is blocked', async () => {
    const { svc, rbt, auditRepo } = makeExecution();
    const token = rbt.mint(basePayload());
    const first = await svc.execute(APP, token);
    const second = await svc.execute(APP, token);
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.reasons).toContain('replay_detected');
    // exactly one EXECUTION_STARTED across both attempts
    expect(
      auditRepo.rows.filter((e) => e.event_type === 'EXECUTION_STARTED'),
    ).toHaveLength(1);
    expect(
      auditRepo.rows.filter((e) => e.event_type === 'EXECUTION_FAILED'),
    ).toHaveLength(1);
  });

  it('does not consume the token when validation fails (legit retry possible)', async () => {
    const { svc, rbt, tokenStore } = makeExecution({ noDrift: false });
    await svc.execute(APP, rbt.mint(basePayload()));
    expect(tokenStore.consume).not.toHaveBeenCalled(); // consume only on the success commit
  });
});

describe('ReadbackTokenService', () => {
  it('mints and verifies a round-trip token', () => {
    const t = tokenSvc();
    const payload = t.verify(t.mint(basePayload()));
    expect(payload).toMatchObject({ applicationId: APP, lockedDiffHash: LH });
  });
  it('rejects a tampered token', () => {
    const t = tokenSvc();
    const token = t.mint(basePayload());
    const tampered = token.slice(0, -3) + 'xyz';
    expect(t.verify(tampered)).toBeNull();
  });
  it('rejects a malformed token', () => {
    expect(tokenSvc().verify('garbage')).toBeNull();
  });
});
