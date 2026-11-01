import type { AuditEvent } from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  AuditSeqConflictError,
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from '../src/modules/audit/audit.repository';

/** In-memory append-only repo — exercises the service's chain logic w/o a DB. */
class FakeAuditRepository implements IAuditRepository {
  rows: AuditEvent[] = [];
  private n = 0;

  async getChainHead(applicationId: string): Promise<ChainHead | null> {
    const appRows = this.rows.filter((r) => r.application_id === applicationId);
    if (appRows.length === 0) return null;
    const head = appRows.reduce((a, b) => (b.seq > a.seq ? b : a));
    return { seq: head.seq, rowHash: head.row_hash };
  }

  async appendEvent(row: NewAuditEventRow): Promise<AuditEvent> {
    const dup = this.rows.find(
      (r) => r.application_id === row.application_id && r.seq === row.seq,
    );
    if (dup) throw new AuditSeqConflictError();
    const full: AuditEvent = { id: `evt-${++this.n}`, ...row };
    this.rows.push(full);
    return full;
  }

  async getTrail(applicationId: string): Promise<AuditEvent[]> {
    return this.rows
      .filter((r) => r.application_id === applicationId)
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({ ...r }));
  }

  async findByIdempotencyKey(
    applicationId: string,
    key: string,
  ): Promise<AuditEvent | null> {
    return (
      this.rows.find(
        (r) =>
          r.application_id === applicationId &&
          r.payload?.idempotency_key === key,
      ) ?? null
    );
  }
}

const APP = 'app-1';

function makeService() {
  const repo = new FakeAuditRepository();
  return { svc: new AuditService(repo), repo };
}

describe('AuditService — canonicalization + hashing (B)', () => {
  it('canonicalization is key-order independent', () => {
    const { svc } = makeService();
    expect(svc.canonicalize({ a: 1, b: 2 })).toBe(
      svc.canonicalize({ b: 2, a: 1 }),
    );
    expect(svc.canonicalize({ x: { p: 1, q: 2 } })).toBe(
      svc.canonicalize({ x: { q: 2, p: 1 } }),
    );
  });

  it('payloadHash is stable + deterministic across key order', () => {
    const { svc } = makeService();
    expect(svc.payloadHash({ a: 1, b: 2 })).toBe(
      svc.payloadHash({ b: 2, a: 1 }),
    );
  });

  it('different payloads hash differently', () => {
    const { svc } = makeService();
    expect(svc.payloadHash({ a: 1 })).not.toBe(svc.payloadHash({ a: 2 }));
  });

  it('array order is significant', () => {
    const { svc } = makeService();
    expect(svc.canonicalize({ a: [1, 2] })).not.toBe(
      svc.canonicalize({ a: [2, 1] }),
    );
  });
});

describe('AuditService — append-only enforcement (C)', () => {
  it('rejects payloads carrying raw PII fields', async () => {
    const { svc } = makeService();
    await expect(
      svc.append({
        applicationId: APP,
        eventType: 'FIELD_EXTRACTED',
        actor: { id: null, role: 'system' },
        payload: { value: 'X1234567' },
      }),
    ).rejects.toThrow(/raw value field/);
  });

  it('rejects nested raw PII', async () => {
    const { svc } = makeService();
    await expect(
      svc.append({
        applicationId: APP,
        eventType: 'FIELD_EXTRACTED',
        actor: { id: null, role: 'system' },
        payload: { meta: { passport_number: 'X1' } },
      }),
    ).rejects.toThrow();
  });

  it('is idempotent on idempotencyKey (no duplicate append)', async () => {
    const { svc, repo } = makeService();
    const a = await svc.append({
      applicationId: APP,
      eventType: 'OCR_COMPLETED',
      actor: { id: null, role: 'system' },
      idempotencyKey: 'k1',
    });
    const b = await svc.append({
      applicationId: APP,
      eventType: 'OCR_COMPLETED',
      actor: { id: null, role: 'system' },
      idempotencyKey: 'k1',
    });
    expect(b.id).toBe(a.id);
    expect(repo.rows).toHaveLength(1);
  });

  it('exposes no update or delete method', () => {
    const { svc } = makeService();
    expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});

describe('AuditService — chain linking + integrity (D, F)', () => {
  async function seedThree(svc: AuditService) {
    await svc.append({
      applicationId: APP,
      eventType: 'DOCUMENT_UPLOADED',
      actor: { id: 'u1', role: 'applicant' },
    });
    await svc.append({
      applicationId: APP,
      eventType: 'OCR_COMPLETED',
      actor: { id: null, role: 'system' },
    });
    await svc.append({
      applicationId: APP,
      eventType: 'FIELD_EXTRACTED',
      actor: { id: null, role: 'system' },
      valueHash: 'vh1',
      refs: { fieldKey: 'passport_number' },
    });
  }

  it('links genesis -> seq1 -> seq2 -> seq3 and verifies intact', async () => {
    const { svc } = makeService();
    await seedThree(svc);
    const trail = await svc.getTrail(APP);

    expect(trail.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(trail[0].prev_hash).toBe(svc.genesisHash(APP));
    expect(trail[1].prev_hash).toBe(trail[0].row_hash);
    expect(trail[2].prev_hash).toBe(trail[1].row_hash);

    expect(await svc.verifyChain(APP)).toEqual({ intact: true });
  });

  it('detects payload tampering at the right seq', async () => {
    const { svc, repo } = makeService();
    await seedThree(svc);
    repo.rows[1].payload = { tampered: true }; // mutate seq 2 payload, leave hashes
    const result = svc.verifyTrail(APP, await svc.getTrail(APP));
    expect(result.intact).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
    expect(result.reason).toMatch(/payload_hash mismatch/);
  });

  it('detects row_hash tampering', async () => {
    const { svc, repo } = makeService();
    await seedThree(svc);
    repo.rows[2].row_hash = 'deadbeef';
    const result = svc.verifyTrail(APP, await svc.getTrail(APP));
    expect(result.intact).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
    expect(result.reason).toMatch(/row_hash mismatch/);
  });

  it('detects a deleted row (seq gap)', async () => {
    const { svc, repo } = makeService();
    await seedThree(svc);
    repo.rows.splice(1, 1); // delete seq 2
    const result = svc.verifyTrail(APP, await svc.getTrail(APP));
    expect(result.intact).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });
});

describe('AuditService — reconstruction (E)', () => {
  it('reconstructs what existed / who approved / what executed / when', async () => {
    const { svc } = makeService();
    await svc.append({
      applicationId: APP,
      eventType: 'FIELD_EXTRACTED',
      actor: { id: null, role: 'system' },
      valueHash: 'vh-pp',
      refs: { fieldKey: 'passport_number' },
      payload: { origin: 'ocr' },
    });
    await svc.append({
      applicationId: APP,
      eventType: 'USER_CONFIRMED',
      actor: { id: 'u1', role: 'applicant' },
      refs: { fieldKey: 'passport_number' },
    });
    await svc.append({
      applicationId: APP,
      eventType: 'CONSULTANT_APPROVED',
      actor: { id: 'c1', role: 'consultant' },
      refs: { fieldKey: 'passport_number' },
    });
    await svc.append({
      applicationId: APP,
      eventType: 'EXECUTION_COMPLETED',
      actor: { id: null, role: 'system' },
      refs: { fieldKey: 'passport_number' },
      payload: { outcome: 'PASS' },
    });

    const r = await svc.reconstruct(APP);
    expect(r.applicationId).toBe(APP);
    expect(r.whatDataExisted).toEqual([
      { fieldKey: 'passport_number', valueHash: 'vh-pp', origin: 'ocr' },
    ]);
    expect(r.whoApproved.map((a) => a.role)).toEqual([
      'applicant',
      'consultant',
    ]);
    expect(r.whatExecuted).toEqual([
      { fieldKey: 'passport_number', outcome: 'PASS', at: expect.any(String) },
    ]);
    expect(r.timeline.map((t) => t.eventType)).toEqual([
      'FIELD_EXTRACTED',
      'USER_CONFIRMED',
      'CONSULTANT_APPROVED',
      'EXECUTION_COMPLETED',
    ]);
  });
});
