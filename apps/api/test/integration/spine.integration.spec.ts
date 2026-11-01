import { createHash } from 'node:crypto';
import { ProvenanceService } from '../../src/modules/provenance/provenance.service';
import type { IProvenanceRepository } from '../../src/modules/provenance/provenance.repository';
import type { AuditService } from '../../src/modules/audit/audit.service';

/**
 * Integration — value_hash SPINE.
 *
 * value_hash is the single integrity spine reused across provenance ->
 * verification -> consultant approval (drift binding) -> preflight lock
 * (locked_diff_hash) -> eligibility -> execution, AND on the extension side by
 * the readback engine. Every layer MUST agree on the same hash for the same
 * value, or the chain (approval staleness, lock, readback) silently breaks.
 *
 * Pins the contract: sha256( number->String | string->trim+NFC | null->'' ).
 * The extension readback rule (trim + NFC -> sha256, see readback-engine.ts /
 * executor/readback.ts) is replicated here as the reference and asserted equal.
 */

// valueHash uses neither repo nor audit, so stub them.
const provenance = new ProvenanceService(
  undefined as unknown as IProvenanceRepository,
  undefined as unknown as AuditService,
);

function referenceHash(value: string | number | null): string {
  const normalized =
    value == null
      ? ''
      : typeof value === 'number'
        ? String(value)
        : value.trim().normalize('NFC');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

describe('Integration — value_hash spine consistency', () => {
  it('is deterministic for the same value', () => {
    expect(provenance.valueHash('X1234567')).toBe(
      provenance.valueHash('X1234567'),
    );
  });

  it('matches the cross-stage / extension reference rule (sha256 trim+NFC)', () => {
    for (const v of ['X1234567', 'cafe', '  spaced  ', 'a-b-c']) {
      expect(provenance.valueHash(v)).toBe(referenceHash(v));
    }
  });

  it('is whitespace/NFC tolerant (readback after fill still matches the lock)', () => {
    expect(provenance.valueHash('  X1234567  ')).toBe(
      provenance.valueHash('X1234567'),
    );
  });

  it('coerces numbers + null deterministically', () => {
    expect(provenance.valueHash(42)).toBe(referenceHash(42));
    expect(provenance.valueHash(null)).toBe(referenceHash(null));
    expect(provenance.valueHash(null)).toBe(provenance.valueHash(''));
  });

  it('DRIFT: any value change yields a different hash (invalidates a bound approval/lock)', () => {
    expect(provenance.valueHash('Passport-B')).not.toBe(
      provenance.valueHash('Passport-A'),
    );
  });

  it('NFC normalization unifies equivalent unicode forms (no false drift)', () => {
    const composed = 'é'; // é U+00E9
    const decomposed = 'é'; // e + combining acute
    expect(provenance.valueHash(composed)).toBe(
      provenance.valueHash(decomposed),
    );
  });
});
