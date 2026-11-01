import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  AuditAppendInput,
  AuditEvent,
  AuditEventType,
  ChainVerifyResult,
  EvidenceReconstruction,
  ProvenanceOrigin,
} from '@visaai/types';
import { AUDIT_REPOSITORY, AuditSeqConflictError } from './audit.repository';
import type { IAuditRepository, NewAuditEventRow } from './audit.repository';

const HASH_ALGO = 'sha256';
const CANON_VERSION = 1;
const MAX_APPEND_RETRIES = 5;

/** Payload key names that would smuggle raw PII into the audit log. Hash only. */
const PII_DENYLIST = new Set([
  'value',
  'raw',
  'raw_value',
  'rawvalue',
  'full_value',
  'pii',
  'ssn',
  'passport_number',
  'dob',
  'date_of_birth',
]);

const DATA_EVENTS: ReadonlySet<AuditEventType> = new Set([
  'FIELD_EXTRACTED',
  'FIELD_EDITED',
]);
const APPROVAL_EVENTS: ReadonlySet<AuditEventType> = new Set([
  'USER_CONFIRMED',
  'CONSULTANT_REVIEWED',
  'CONSULTANT_APPROVED',
]);
const EXECUTION_EVENTS: ReadonlySet<AuditEventType> = new Set([
  'EXECUTION_STARTED',
  'EXECUTION_COMPLETED',
  'EXECUTION_FAILED',
]);

/**
 * AuditService — the canonical, append-only system of record.
 *
 * Owns: deterministic canonicalization + payload hashing, per-application hash
 * chain (prev_hash -> row_hash), append-only enforcement, chain verification,
 * and evidence reconstruction. The repository only persists precomputed rows;
 * there is no service-level update or delete path.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly repo: IAuditRepository,
  ) {}

  // ---- A. canonical event normalization --------------------------------
  /** Deterministic JSON: object keys sorted recursively, array order preserved. */
  canonicalize(payload: Record<string, unknown>): string {
    return JSON.stringify(this.canon(payload));
  }

  private canon(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.canon(v));
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = this.canon(obj[key]);
    return out;
  }

  // ---- B. payload hashing (stable, deterministic) ----------------------
  payloadHash(payload: Record<string, unknown>): string {
    return this.sha256(this.canonicalize(payload));
  }

  /** Genesis link for an application's chain. */
  genesisHash(applicationId: string): string {
    return this.sha256(applicationId);
  }

  // ---- D. chain linking (prev_hash -> row_hash) ------------------------
  private computeRowHash(
    prevHash: string,
    e: {
      seq: number;
      eventType: AuditEventType;
      actorId: string | null;
      actorRole: string;
      fieldKey: string | null;
      documentId: string | null;
      valueHash: string | null;
      payloadHash: string;
      occurredAt: string;
    },
  ): string {
    return this.sha256(
      [
        prevHash,
        String(e.seq),
        e.eventType,
        e.actorId ?? 'system',
        e.actorRole,
        e.fieldKey ?? '',
        e.documentId ?? '',
        e.valueHash ?? '',
        e.payloadHash,
        e.occurredAt,
      ].join('|'),
    );
  }

  // ---- C. append-only enforcement (insert-only, PII-guarded, idempotent) ----
  async append(input: AuditAppendInput): Promise<AuditEvent> {
    const basePayload = input.payload ?? {};
    this.assertNoRawPii(basePayload);

    const payload: Record<string, unknown> = input.idempotencyKey
      ? { ...basePayload, idempotency_key: input.idempotencyKey }
      : basePayload;

    if (input.idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(
        input.applicationId,
        input.idempotencyKey,
      );
      if (existing) return existing;
    }

    const payloadHash = this.payloadHash(payload);

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_APPEND_RETRIES; attempt++) {
      const head = await this.repo.getChainHead(input.applicationId);
      const prevHash = head?.rowHash ?? this.genesisHash(input.applicationId);
      const seq = (head?.seq ?? 0) + 1;
      const occurredAt = new Date().toISOString();

      const rowHash = this.computeRowHash(prevHash, {
        seq,
        eventType: input.eventType,
        actorId: input.actor.id,
        actorRole: input.actor.role,
        fieldKey: input.refs?.fieldKey ?? null,
        documentId: input.refs?.documentId ?? null,
        valueHash: input.valueHash ?? null,
        payloadHash,
        occurredAt,
      });

      const row: NewAuditEventRow = {
        application_id: input.applicationId,
        seq,
        event_type: input.eventType,
        actor_id: input.actor.id,
        actor_role: input.actor.role,
        document_id: input.refs?.documentId ?? null,
        ocr_run_id: input.refs?.ocrRunId ?? null,
        field_key: input.refs?.fieldKey ?? null,
        submission_session_id: input.refs?.submissionSessionId ?? null,
        from_state: input.fromState ?? null,
        to_state: input.toState ?? null,
        payload,
        value_hash: input.valueHash ?? null,
        payload_hash: payloadHash,
        prev_hash: prevHash,
        row_hash: rowHash,
        hash_algo: HASH_ALGO,
        canon_version: CANON_VERSION,
        extension_version: input.extensionVersion ?? null,
        schema_version: input.schemaVersion ?? null,
        occurred_at: occurredAt,
      };

      try {
        return await this.repo.appendEvent(row);
      } catch (err) {
        // Concurrent append took our seq — re-read the head and retry.
        if (err instanceof AuditSeqConflictError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `audit append failed after ${MAX_APPEND_RETRIES} attempts: ${
        lastErr instanceof Error ? lastErr.message : 'seq contention'
      }`,
    );
  }

  private assertNoRawPii(payload: unknown): void {
    const walk = (v: unknown): void => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }
      for (const [key, child] of Object.entries(v as Record<string, unknown>)) {
        if (PII_DENYLIST.has(key.toLowerCase())) {
          throw new BadRequestException(
            `audit payload may not contain raw value field "${key}" — use value_hash`,
          );
        }
        walk(child);
      }
    };
    walk(payload);
  }

  async getTrail(applicationId: string): Promise<AuditEvent[]> {
    return this.repo.getTrail(applicationId);
  }

  // ---- F. chain verification utility -----------------------------------
  async verifyChain(applicationId: string): Promise<ChainVerifyResult> {
    const events = await this.repo.getTrail(applicationId);
    return this.verifyTrail(applicationId, events);
  }

  /** Pure recompute over an ordered trail; localizes the first break. */
  verifyTrail(applicationId: string, events: AuditEvent[]): ChainVerifyResult {
    let prev = this.genesisHash(applicationId);
    let expectedSeq = 1;
    for (const e of events) {
      if (e.seq !== expectedSeq) {
        return {
          intact: false,
          brokenAtSeq: e.seq,
          reason: 'seq gap (missing or reordered row)',
        };
      }
      if (e.prev_hash !== prev) {
        return {
          intact: false,
          brokenAtSeq: e.seq,
          reason: 'prev_hash mismatch (gap or edit)',
        };
      }
      const recomputedPayloadHash = this.payloadHash(e.payload);
      if (recomputedPayloadHash !== e.payload_hash) {
        return {
          intact: false,
          brokenAtSeq: e.seq,
          reason: 'payload_hash mismatch (payload tampered)',
        };
      }
      const recomputedRowHash = this.computeRowHash(e.prev_hash, {
        seq: e.seq,
        eventType: e.event_type,
        actorId: e.actor_id,
        actorRole: e.actor_role,
        fieldKey: e.field_key,
        documentId: e.document_id,
        valueHash: e.value_hash,
        payloadHash: e.payload_hash,
        occurredAt: e.occurred_at,
      });
      if (recomputedRowHash !== e.row_hash) {
        return {
          intact: false,
          brokenAtSeq: e.seq,
          reason: 'row_hash mismatch (row tampered)',
        };
      }
      prev = e.row_hash;
      expectedSeq += 1;
    }
    return { intact: true };
  }

  // ---- E. audit replay / reconstruction --------------------------------
  async reconstruct(applicationId: string): Promise<EvidenceReconstruction> {
    const events = await this.repo.getTrail(applicationId);
    return this.reconstructFromTrail(applicationId, events);
  }

  /** Pure projection of a trail into the four evidence questions. */
  reconstructFromTrail(
    applicationId: string,
    events: AuditEvent[],
  ): EvidenceReconstruction {
    return {
      applicationId,
      whatDataExisted: events
        .filter((e) => DATA_EVENTS.has(e.event_type))
        .map((e) => ({
          fieldKey: e.field_key ?? '',
          valueHash: e.value_hash,
          origin: (e.payload?.origin as ProvenanceOrigin | undefined) ?? null,
        })),
      whoApproved: events
        .filter((e) => APPROVAL_EVENTS.has(e.event_type))
        .map((e) => ({
          fieldKey: e.field_key,
          actorId: e.actor_id,
          role: e.actor_role,
          at: e.occurred_at,
        })),
      whatExecuted: events
        .filter((e) => EXECUTION_EVENTS.has(e.event_type))
        .map((e) => ({
          fieldKey: e.field_key ?? '',
          outcome: (e.payload?.outcome as string | undefined) ?? e.event_type,
          at: e.occurred_at,
        })),
      timeline: events.map((e) => ({
        seq: e.seq,
        eventType: e.event_type,
        at: e.occurred_at,
      })),
    };
  }

  private sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }
}
