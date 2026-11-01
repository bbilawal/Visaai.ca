import type {
  AuditEvent,
  FieldExecResult,
  SignedWriteIntent,
} from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from '../src/modules/audit/audit.repository';
import { PortalFillOrchestrator } from '../src/modules/portal-fill/portal-fill-orchestrator';
import type { IFieldExecutor } from '../src/modules/portal-fill/field-executor.port';

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

const APP = 'app-1';
const EXEC = 'exec-1';
const ACTOR = { id: 'u1', role: 'applicant' as const };

function intent(fieldKey: string): SignedWriteIntent {
  return {
    executionId: EXEC,
    fieldKey,
    selector: `#${fieldKey}`,
    mappedValue: 'v',
    expectedValueHash: `vh:${fieldKey}`,
    category: 'passport',
    lockedDiffHash: 'LOCK',
    sig: 'sig',
  };
}
const PLAN = [intent('dob'), intent('passport_number')];

function ok(fieldKey: string): FieldExecResult {
  return {
    fieldKey,
    outcome: 'verified',
    actualValueHash: `vh:${fieldKey}`,
    selectorFound: true,
  };
}
function fail(
  fieldKey: string,
  reason: FieldExecResult['reason'],
  selectorFound = true,
): FieldExecResult {
  return {
    fieldKey,
    outcome: 'failed',
    reason,
    selectorFound,
    actualValueHash: selectorFound ? 'vh:WRONG' : undefined,
  };
}

function make(executor: IFieldExecutor) {
  const auditRepo = new FakeAuditRepository();
  const svc = new PortalFillOrchestrator(executor, new AuditService(auditRepo));
  return { svc, auditRepo };
}
const types = (r: FakeAuditRepository) => r.rows.map((e) => e.event_type);

describe('PortalFillOrchestrator (Phase 7G)', () => {
  it('happy path: both fields verified -> COMPLETED', async () => {
    const exec = {
      executeField: jest
        .fn()
        .mockResolvedValueOnce(ok('dob'))
        .mockResolvedValueOnce(ok('passport_number')),
    };
    const { svc, auditRepo } = make(exec);
    const r = await svc.run(APP, EXEC, PLAN, ACTOR);
    expect(r).toMatchObject({
      state: 'COMPLETED',
      verified: ['dob', 'passport_number'],
    });
    expect(types(auditRepo)).toEqual([
      'PORTAL_FILL_STARTED',
      'FIELD_WRITE_ATTEMPT',
      'READBACK_COMPARE',
      'FIELD_VERIFIED',
      'FIELD_WRITE_ATTEMPT',
      'READBACK_COMPARE',
      'FIELD_VERIFIED',
      'PORTAL_FILL_COMPLETED',
      'EXECUTION_COMPLETED',
    ]);
    expect(exec.executeField).toHaveBeenCalledTimes(2);
  });

  it('selector_missing on field 0 halts before any verify', async () => {
    const exec = {
      executeField: jest
        .fn()
        .mockResolvedValueOnce(fail('dob', 'selector_missing', false)),
    };
    const { svc, auditRepo } = make(exec);
    const r = await svc.run(APP, EXEC, PLAN, ACTOR);
    expect(r).toMatchObject({
      state: 'FAILED',
      verified: [],
      failedField: 'dob',
      haltReason: 'selector_missing',
    });
    expect(exec.executeField).toHaveBeenCalledTimes(1); // single-cursor: never reaches field 1
    expect(types(auditRepo)).not.toContain('FIELD_VERIFIED');
    expect(types(auditRepo)).toContain('EXECUTION_FAILED');
  });

  it('value_mismatch on field 1 halts; field 0 stays verified', async () => {
    const exec = {
      executeField: jest
        .fn()
        .mockResolvedValueOnce(ok('dob'))
        .mockResolvedValueOnce(fail('passport_number', 'value_mismatch')),
    };
    const { svc, auditRepo } = make(exec);
    const r = await svc.run(APP, EXEC, PLAN, ACTOR);
    expect(r).toMatchObject({
      state: 'FAILED',
      verified: ['dob'],
      failedField: 'passport_number',
      haltReason: 'value_mismatch',
    });
    expect(types(auditRepo)).not.toContain('PORTAL_FILL_COMPLETED');
  });

  it('portal_mutation on field 1 halts', async () => {
    const exec = {
      executeField: jest
        .fn()
        .mockResolvedValueOnce(ok('dob'))
        .mockResolvedValueOnce(fail('passport_number', 'portal_mutation')),
    };
    const { svc } = make(exec);
    const r = await svc.run(APP, EXEC, PLAN, ACTOR);
    expect(r).toMatchObject({
      state: 'FAILED',
      haltReason: 'portal_mutation',
      verified: ['dob'],
    });
  });

  it('fails closed when the executor throws (infrastructure failure)', async () => {
    const exec = {
      executeField: jest
        .fn()
        .mockRejectedValueOnce(new Error('executor unreachable')),
    };
    const { svc, auditRepo } = make(exec);
    const r = await svc.run(APP, EXEC, PLAN, ACTOR);
    expect(r.state).toBe('FAILED');
    expect(r.verified).toEqual([]);
    expect(types(auditRepo)).toContain('EXECUTION_FAILED');
    expect(types(auditRepo)).not.toContain('EXECUTION_COMPLETED');
  });

  it('NEVER emits EXECUTION_STARTED (that is ExecutionService authority)', async () => {
    const exec = { executeField: jest.fn().mockResolvedValue(ok('dob')) };
    const { svc, auditRepo } = make(exec);
    await svc.run(APP, EXEC, [intent('dob')], ACTOR);
    expect(types(auditRepo)).not.toContain('EXECUTION_STARTED');
  });

  it('emits no submit/navigate events and keeps the audit chain intact', async () => {
    const exec = {
      executeField: jest
        .fn()
        .mockResolvedValueOnce(ok('dob'))
        .mockResolvedValueOnce(ok('passport_number')),
    };
    const { svc, auditRepo } = make(exec);
    await svc.run(APP, EXEC, PLAN, ACTOR);
    for (const t of types(auditRepo))
      expect(t).not.toMatch(/SUBMIT|NAVIGATE|PAY/i);
    expect((await new AuditService(auditRepo).verifyChain(APP)).intact).toBe(
      true,
    );
  });
});
