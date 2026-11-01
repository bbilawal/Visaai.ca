import { createHash } from 'node:crypto';
import type { AuditEvent } from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  AuditSeqConflictError,
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from '../src/modules/audit/audit.repository';

/**
 * AUDIT CHAIN PARITY — proves the reconciled DB verifier agrees with the app.
 *
 * Authority: the application TS `row_hash` (AuditService.computeRowHash) is the
 * WRITE AUTHORITY. The migration `20260627000002_audit_chain_reconcile.sql`
 * redefines `audit_verify_chain()` so its row_hash formula matches it byte-for-byte.
 *
 * This spec has no live DB. Instead it models the EXACT input string the SQL
 * `digest(...)` hashes (`sqlRowHashInput`) and the EXACT input string the app
 * hashes (`tsRowHashInput`), and proves:
 *   1. (anchor)  sha256(tsRowHashInput(row)) === row.row_hash, for rows produced
 *      by the REAL AuditService — so `tsRowHashInput` faithfully mirrors the app.
 *   2. (parity)  sqlRowHashInput(row) === tsRowHashInput(row) (byte-equal), hence
 *      identical sha256 — for both real rows and a deterministic, table-driven
 *      matrix of synthetic rows covering every coalesce/default/timestamp edge.
 *   3. (genesis) the SQL genesis link sha256(application_id) === svc.genesisHash.
 *   4. (caveat)  the SQL `to_char(... '.MS"Z"')` rendering is identity on the
 *      app's millisecond ISO-8601 'Z' timestamps (the documented parity boundary).
 */

const sha256hex = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Mirrors the app authority — AuditService.computeRowHash():
 *   [prevHash, seq, eventType, actorId??'system', actorRole,
 *    fieldKey??'', documentId??'', valueHash??'', payloadHash, occurredAt].join('|')
 */
function tsRowHashInput(e: AuditEvent): string {
  return [
    e.prev_hash,
    String(e.seq),
    e.event_type,
    e.actor_id ?? 'system',
    e.actor_role,
    e.field_key ?? '',
    e.document_id ?? '',
    e.value_hash ?? '',
    e.payload_hash,
    e.occurred_at,
  ].join('|');
}

/**
 * Emulates Postgres `to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.
 * For a millisecond-precision UTC instant this is byte-identical to JS
 * `Date#toISOString()` — which is what the app hashes. (.MS zero-pads to 3 digits.)
 */
function pgToCharIsoMs(ts: string): string {
  const d = new Date(ts);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` +
    `.${p(d.getUTCMilliseconds(), 3)}Z`
  );
}

/**
 * Mirrors the reconciled SQL `audit_verify_chain` row_hash concatenation:
 *   prev_hash || '|' || seq::text || '|' || event_type::text || '|' ||
 *   coalesce(actor_id::text,'system') || '|' || actor_role::text || '|' ||
 *   coalesce(field_key,'') || '|' || coalesce(document_id::text,'') || '|' ||
 *   coalesce(value_hash,'') || '|' || payload_hash || '|' ||
 *   to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 */
function sqlRowHashInput(e: AuditEvent): string {
  return [
    e.prev_hash,
    String(e.seq),
    e.event_type,
    e.actor_id ?? 'system',
    e.actor_role,
    e.field_key ?? '',
    e.document_id ?? '',
    e.value_hash ?? '',
    e.payload_hash,
    pgToCharIsoMs(e.occurred_at),
  ].join('|');
}

// In-memory append-only repo so we can drive the REAL AuditService write path.
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
    if (
      this.rows.find(
        (r) => r.application_id === row.application_id && r.seq === row.seq,
      )
    )
      throw new AuditSeqConflictError();
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

// A real lowercase UUID — mirrors Postgres `application_id::text`.
const APP = '11111111-2222-3333-4444-555555555555';

describe('audit chain parity — SQL verifier vs app row_hash authority', () => {
  // ---- 1 + parity: real app-written rows -------------------------------
  it('SQL formula reproduces the app row_hash for REAL appended rows', async () => {
    const repo = new FakeAuditRepository();
    const svc = new AuditService(repo);

    await svc.append({
      applicationId: APP,
      eventType: 'DOCUMENT_UPLOADED',
      actor: { id: 'aaaaaaaa-0000-0000-0000-000000000001', role: 'applicant' },
      refs: { documentId: 'dddddddd-0000-0000-0000-000000000009' },
    });
    await svc.append({
      applicationId: APP,
      eventType: 'OCR_COMPLETED',
      actor: { id: null, role: 'system' }, // actor_id null -> 'system'
    });
    await svc.append({
      applicationId: APP,
      eventType: 'FIELD_EXTRACTED',
      actor: { id: null, role: 'system' },
      valueHash: 'vh-passport',
      refs: { fieldKey: 'passport_number' },
      payload: { origin: 'ocr', nested: { z: 1, a: [3, 2, 1] } },
    });
    await svc.append({
      applicationId: APP,
      eventType: 'CONSULTANT_APPROVED',
      actor: { id: 'cccccccc-0000-0000-0000-000000000002', role: 'consultant' },
      refs: { fieldKey: 'passport_number' },
    });

    const trail = await svc.getTrail(APP);
    expect(trail).toHaveLength(4);

    for (const row of trail) {
      // anchor: my TS replica == the real service authority
      expect(sha256hex(tsRowHashInput(row))).toBe(row.row_hash);
      // the to_char emulation is identity on the app's ms ISO timestamps
      expect(pgToCharIsoMs(row.occurred_at)).toBe(row.occurred_at);
      // parity: SQL builder is byte-equal to the TS builder -> identical hash
      expect(sqlRowHashInput(row)).toBe(tsRowHashInput(row));
      expect(sha256hex(sqlRowHashInput(row))).toBe(row.row_hash);
    }

    // the app's own verifier accepts its own chain
    expect(svc.verifyTrail(APP, trail)).toEqual({ intact: true });
  });

  // ---- 3: genesis link parity ------------------------------------------
  it('SQL genesis digest(application_id) === app genesisHash', () => {
    const svc = new AuditService(new FakeAuditRepository());
    expect(sha256hex(APP)).toBe(svc.genesisHash(APP));
  });

  // ---- 4: timestamp caveat — to_char(.MS"Z") is identity on app ISO ----
  it.each([
    '2026-06-27T12:34:56.000Z', // ms = 000 (toISOString always pads)
    '2026-06-27T12:34:56.700Z', // trailing-zero ms (where ::text would trim to .7)
    '2026-06-27T12:34:56.010Z', // leading-zero ms
    '2026-06-27T12:34:56.789Z', // full ms
    '2026-06-27T00:00:00.500Z', // midnight + half second
  ])('to_char ISO-ms render is identity for %s', (iso) => {
    expect(pgToCharIsoMs(iso)).toBe(iso);
    expect(pgToCharIsoMs(iso)).toBe(new Date(iso).toISOString());
  });

  // ---- 2: deterministic, table-driven matrix of synthetic rows ----------
  type Case = {
    name: string;
    over: Partial<AuditEvent>;
  };

  const base: AuditEvent = {
    id: 'row-x',
    application_id: APP,
    seq: 1,
    event_type: 'FIELD_EXTRACTED',
    actor_id: null,
    actor_role: 'system',
    document_id: null,
    ocr_run_id: null,
    field_key: null,
    submission_session_id: null,
    from_state: null,
    to_state: null,
    payload: {},
    value_hash: null,
    payload_hash: 'a'.repeat(64),
    prev_hash: 'b'.repeat(64),
    row_hash: 'unused-in-this-test',
    hash_algo: 'sha256',
    canon_version: 1,
    extension_version: null,
    schema_version: null,
    occurred_at: '2026-06-27T12:34:56.789Z',
  };

  const cases: Case[] = [
    {
      name: 'all entity refs present + applicant actor',
      over: {
        seq: 7,
        event_type: 'CONSULTANT_APPROVED',
        actor_id: 'aaaaaaaa-0000-0000-0000-000000000001',
        actor_role: 'applicant',
        field_key: 'passport_number',
        document_id: 'dddddddd-0000-0000-0000-000000000009',
        value_hash: 'vh-1',
        occurred_at: '2026-06-27T12:34:56.789Z',
      },
    },
    {
      name: 'all-null defaults -> system / empty strings (ms .000)',
      over: {
        seq: 1,
        actor_id: null,
        actor_role: 'system',
        field_key: null,
        document_id: null,
        value_hash: null,
        occurred_at: '2026-06-27T12:34:56.000Z',
      },
    },
    {
      name: 'trailing-zero ms .700 (::text would trim; .MS must not)',
      over: {
        seq: 42,
        field_key: 'employer_name',
        value_hash: null,
        occurred_at: '2026-06-27T12:34:56.700Z',
      },
    },
    {
      name: 'leading-zero ms .010',
      over: { seq: 3, occurred_at: '2026-06-27T12:34:56.010Z' },
    },
    {
      name: 'actor_id null but document_id present (ms .123)',
      over: {
        seq: 9,
        actor_id: null,
        document_id: 'dddddddd-0000-0000-0000-00000000000a',
        occurred_at: '2026-06-27T01:02:03.123Z',
      },
    },
    {
      name: 'field_key explicit empty string (renders same as null)',
      over: { seq: 5, field_key: '', occurred_at: '2026-06-27T23:59:59.500Z' },
    },
    {
      name: 'consultant actor + value_hash present, no field_key',
      over: {
        seq: 100,
        event_type: 'CONSULTANT_REVIEWED',
        actor_id: 'cccccccc-0000-0000-0000-000000000002',
        actor_role: 'consultant',
        value_hash: 'vh-deadbeef',
        occurred_at: '2026-06-27T08:15:30.042Z',
      },
    },
  ];

  it.each(cases)(
    'SQL input string === TS input string -> identical row_hash [$name]',
    ({ over }) => {
      const row: AuditEvent = { ...base, ...over };
      expect(sqlRowHashInput(row)).toBe(tsRowHashInput(row));
      expect(sha256hex(sqlRowHashInput(row))).toBe(
        sha256hex(tsRowHashInput(row)),
      );
    },
  );
});
