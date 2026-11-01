import type { AuditEvent } from '@visaai/types';
import type {
  ChainHead,
  IAuditRepository,
  NewAuditEventRow,
} from '../../src/modules/audit/audit.repository';

/**
 * Canonical in-memory IAuditRepository for tests.
 *
 * DUP-001: this class had been copy-pasted into seven spec files and had
 * DIVERGED into two versions. Six copies implemented `findByIdempotencyKey` as
 * `return null` — an unconditional miss — while `eligibility.spec.ts` actually
 * looked the key up.
 *
 * That is not cosmetic drift. A fake whose idempotency lookup always misses
 * cannot fail a test when idempotency is broken, so six suites were asserting
 * against a stand-in that could not detect the defect. This shared version
 * therefore takes the STRONGER implementation, not the majority one.
 *
 * If adopting it turns a green suite red, that is the point: the test was
 * relying on the inert behaviour.
 */
export class FakeAuditRepository implements IAuditRepository {
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

  /** Real lookup — see the class comment for why this is not `return null`. */
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
