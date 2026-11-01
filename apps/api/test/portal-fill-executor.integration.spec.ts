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
import {
  ExtensionBridgeExecutor,
  DisconnectedTransport,
  type IExtensionTransport,
} from '../src/modules/portal-fill/field-executor.port';
import { PortalFillOrchestrator } from '../src/modules/portal-fill/portal-fill-orchestrator';

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
const verified = (fieldKey: string): FieldExecResult => ({
  fieldKey,
  outcome: 'verified',
  actualValueHash: `vh:${fieldKey}`,
  selectorFound: true,
});
const failed = (
  fieldKey: string,
  reason: FieldExecResult['reason'],
): FieldExecResult => ({
  fieldKey,
  outcome: 'failed',
  reason,
  selectorFound: reason !== 'selector_missing',
});

function rig(transport: IExtensionTransport, timeoutMs = 50) {
  const auditRepo = new FakeAuditRepository();
  const bridge = new ExtensionBridgeExecutor(transport, timeoutMs);
  const orch = new PortalFillOrchestrator(bridge, new AuditService(auditRepo));
  return { bridge, orch, auditRepo };
}

describe('Phase 7H — ExtensionBridgeExecutor + orchestrator integration', () => {
  it('happy path -> COMPLETED', async () => {
    const transport = {
      send: jest.fn(async (i: SignedWriteIntent) => verified(i.fieldKey)),
    };
    const { orch, auditRepo } = rig(transport);
    const r = await orch.run(APP, EXEC, PLAN, ACTOR);
    expect(r).toMatchObject({
      state: 'COMPLETED',
      verified: ['dob', 'passport_number'],
    });
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(auditRepo.rows.map((e) => e.event_type)).toContain(
      'EXECUTION_COMPLETED',
    );
  });

  it('selector_missing halts (single-cursor: field 2 never reached)', async () => {
    const transport = {
      send: jest.fn(async () => failed('dob', 'selector_missing')),
    };
    const { orch } = rig(transport);
    const r = await orch.run(APP, EXEC, PLAN, ACTOR);
    expect(r).toMatchObject({
      state: 'FAILED',
      haltReason: 'selector_missing',
      verified: [],
    });
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('value_mismatch halts; prior field verified', async () => {
    const transport = {
      send: jest.fn(async (i: SignedWriteIntent) =>
        i.fieldKey === 'dob'
          ? verified('dob')
          : failed('passport_number', 'value_mismatch'),
      ),
    };
    const { orch } = rig(transport);
    const r = await orch.run(APP, EXEC, PLAN, ACTOR);
    expect(r).toMatchObject({
      state: 'FAILED',
      haltReason: 'value_mismatch',
      verified: ['dob'],
    });
  });

  it('DOM mutation after write halts', async () => {
    const transport = {
      send: jest.fn(async (i: SignedWriteIntent) =>
        i.fieldKey === 'dob'
          ? verified('dob')
          : failed('passport_number', 'portal_mutation'),
      ),
    };
    const { orch } = rig(transport);
    expect(await orch.run(APP, EXEC, PLAN, ACTOR)).toMatchObject({
      state: 'FAILED',
      haltReason: 'portal_mutation',
    });
  });

  it('timeout fails closed (reason timeout, distinct)', async () => {
    const transport = {
      send: jest.fn(
        () =>
          new Promise<FieldExecResult>(() => {
            /* never resolves */
          }),
      ),
    };
    const { orch } = rig(transport, 30);
    expect(await orch.run(APP, EXEC, [intent('dob')], ACTOR)).toMatchObject({
      state: 'FAILED',
      haltReason: 'timeout',
    });
  });

  it('transport throw -> transport_error (distinct from timeout)', async () => {
    const transport = {
      send: jest.fn(async () => {
        throw new Error('socket boom');
      }),
    };
    const { bridge } = rig(transport);
    expect(await bridge.executeField(intent('dob'))).toMatchObject({
      outcome: 'failed',
      reason: 'transport_error',
      selectorFound: false,
    });
  });

  it('replay protection: re-sent (executionId,fieldKey) fails without calling transport', async () => {
    const transport = {
      send: jest.fn(async (i: SignedWriteIntent) => verified(i.fieldKey)),
    };
    const { bridge } = rig(transport);
    expect((await bridge.executeField(intent('dob'))).outcome).toBe('verified');
    expect(await bridge.executeField(intent('dob'))).toMatchObject({
      outcome: 'failed',
      reason: 'replay',
    });
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  // Prod 2026-10-15 (first IRCC fill): nationality feeds two selects and DOB
  // three; the replay key was executionId:fieldKey, so the second write of the
  // same value was refused as a replay and the run stopped after one field.
  it('one value written to several controls is not a replay; the same control twice is', async () => {
    const transport = {
      send: jest.fn(async (i: SignedWriteIntent) => verified(i.fieldKey)),
    };
    const { bridge, orch, auditRepo } = rig(transport);
    const a = { ...intent('nationality'), selector: '#codePassport_select' };
    const b = { ...intent('nationality'), selector: '#nationalityPassport_select' };
    const r = await orch.run(APP, EXEC, [a, b], ACTOR);
    expect(r).toMatchObject({ state: 'COMPLETED' });
    expect(transport.send).toHaveBeenCalledTimes(2);
    const verifiedEvents = auditRepo.rows.filter(
      (e: { event_type: string }) => e.event_type === 'FIELD_VERIFIED',
    );
    expect(verifiedEvents).toHaveLength(2);
    expect(await bridge.executeField(b)).toMatchObject({ reason: 'replay' });
  });

  it('normalizes output (no blind passthrough; re-keys to the intent field)', async () => {
    // verified WITH the matching hash, but wrong fieldKey + junk keys on the wire.
    const transport = {
      send: jest.fn(
        async () =>
          ({
            fieldKey: 'WRONG',
            outcome: 'verified',
            actualValueHash: 'vh:dob',
            selectorFound: true,
            junk: 1,
          }) as unknown as FieldExecResult,
      ),
    };
    const { bridge } = rig(transport);
    const r = await bridge.executeField(intent('dob'));
    expect(r.fieldKey).toBe('dob'); // re-keyed to the intent, not the wire value
    expect(r.outcome).toBe('verified');
    expect(Object.keys(r).sort()).toEqual([
      'actualValueHash',
      'fieldKey',
      'outcome',
      'selectorFound',
    ]); // junk removed
  });

  it('rejects a SPOOFED verified result whose hash != expected (worker compromise)', async () => {
    const transport = {
      send: jest.fn(async () => ({
        fieldKey: 'dob',
        outcome: 'verified' as const,
        actualValueHash: 'SPOOFED',
        selectorFound: true,
      })),
    };
    const { bridge } = rig(transport);
    const r = await bridge.executeField(intent('dob'));
    expect(r).toMatchObject({ outcome: 'failed', reason: 'value_mismatch' });
  });

  it('DisconnectedTransport is fail-closed (no throw) -> transport_error', async () => {
    const bridge = new ExtensionBridgeExecutor(new DisconnectedTransport());
    expect(await bridge.executeField(intent('dob'))).toMatchObject({
      outcome: 'failed',
      reason: 'transport_error',
      selectorFound: false,
    });
  });
});
