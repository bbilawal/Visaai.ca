import type { AuditEvent } from '@visaai/types';

/** A fully-formed audit row ready to persist (id + db defaults added on insert). */
export type NewAuditEventRow = Omit<AuditEvent, 'id'>;

/** Current chain head for an application (latest seq + its row_hash). */
export interface ChainHead {
  seq: number;
  rowHash: string;
}

/**
 * Data-access contract for audit_events.
 *
 * The AuditService is the canonical chain authority: it canonicalizes, hashes,
 * links prev_hash -> row_hash, and assigns seq. This repository only PERSISTS a
 * precomputed row (append-only) and reads the chain head / trail. It exposes NO
 * update or delete path. Provided ONLY inside AuditModule (not exported) so no
 * other service can reach the write path.
 */
export interface IAuditRepository {
  /** Latest (seq, rowHash) for the application, or null if the chain is empty. */
  getChainHead(applicationId: string): Promise<ChainHead | null>;

  /** Append-only insert of a fully-formed row. Throws on duplicate (application_id, seq). */
  appendEvent(row: NewAuditEventRow): Promise<AuditEvent>;

  /** Full trail ordered by seq ascending. */
  getTrail(applicationId: string): Promise<AuditEvent[]>;

  /** Dedupe lookup for at-least-once emitters (idempotency_key stored in payload). */
  findByIdempotencyKey(
    applicationId: string,
    key: string,
  ): Promise<AuditEvent | null>;
}

/** Sentinel error a repository throws when an append violates (application_id, seq). */
export class AuditSeqConflictError extends Error {
  constructor(message = 'audit seq conflict') {
    super(message);
    this.name = 'AuditSeqConflictError';
  }
}

export const AUDIT_REPOSITORY = Symbol('IAuditRepository');
