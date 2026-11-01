import type { SupabaseClient } from '@supabase/supabase-js';
import { OutcomesService, type ReportOutcomeInput } from './outcomes.service';

/**
 * TEST-003: this module shipped with zero coverage of any kind despite two
 * live authenticated routes. The behaviour that most needed a test is the
 * refusal-reason allowlist — it exists specifically to keep free-text PII out
 * of `refusal_reasons`, and nothing was verifying it held.
 */

/** Captures the upsert payload so the allowlist filter can be asserted on. */
function dbMock(result: { data?: unknown; error?: { message: string } } = {}) {
  const captured: { payload?: Record<string, unknown>; opts?: unknown } = {};
  const single = jest.fn().mockResolvedValue({
    data: result.data ?? { id: 'o1' },
    error: result.error ?? null,
  });
  const select = jest.fn().mockReturnValue({ single });
  const upsert = jest.fn().mockImplementation((payload, opts) => {
    captured.payload = payload;
    captured.opts = opts;
    return { select };
  });
  const maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: result.data ?? null, error: null });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const selectForGet = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockImplementation(() => ({
    upsert,
    select: selectForGet,
  }));
  return {
    db: { from } as unknown as SupabaseClient,
    captured,
    from,
    upsert,
    eq,
    maybeSingle,
  };
}

const base: ReportOutcomeInput = { outcome: 'approved' };

describe('OutcomesService.report', () => {
  const svc = new OutcomesService();

  it('writes to application_outcomes keyed on the caller and application', async () => {
    const m = dbMock();
    await svc.report(m.db, 'app-1', 'user-1', base);

    expect(m.from).toHaveBeenCalledWith('application_outcomes');
    expect(m.captured.payload).toMatchObject({
      application_id: 'app-1',
      user_id: 'user-1',
      outcome: 'approved',
    });
    // Upsert must conflict on application_id, so re-reporting an outcome
    // updates the existing row rather than accumulating duplicates.
    expect(m.captured.opts).toEqual({ onConflict: 'application_id' });
  });

  it.each(['approved', 'refused', 'withdrawn', 'pending'] as const)(
    'accepts the valid outcome %s',
    async (outcome) => {
      const m = dbMock();
      await svc.report(m.db, 'app-1', 'user-1', { outcome });
      expect(m.captured.payload!.outcome).toBe(outcome);
    },
  );

  describe('refusal-reason allowlist (keeps free-text PII out of the column)', () => {
    it('keeps every allowlisted code', async () => {
      const m = dbMock();
      const all = [
        'insufficient_funds',
        'weak_home_ties',
        'travel_history',
        'purpose_unclear',
        'inconsistent_info',
        'incomplete_docs',
        'other',
      ];
      await svc.report(m.db, 'app-1', 'user-1', {
        outcome: 'refused',
        refusalReasons: all,
      });
      expect(m.captured.payload!.refusal_reasons).toEqual(all);
    });

    it('drops free text, which is the whole point of the allowlist', async () => {
      const m = dbMock();
      await svc.report(m.db, 'app-1', 'user-1', {
        outcome: 'refused',
        refusalReasons: [
          'insufficient_funds',
          'Officer said my bank statement for Ms. Jane Doe looked forged',
          'travel_history',
        ],
      });
      expect(m.captured.payload!.refusal_reasons).toEqual([
        'insufficient_funds',
        'travel_history',
      ]);
    });

    it('stores null rather than an empty array when nothing survives filtering', async () => {
      const m = dbMock();
      await svc.report(m.db, 'app-1', 'user-1', {
        outcome: 'refused',
        refusalReasons: ['not-a-real-code', ''],
      });
      expect(m.captured.payload!.refusal_reasons).toBeNull();
    });

    it('stores null when no reasons are supplied at all', async () => {
      const m = dbMock();
      await svc.report(m.db, 'app-1', 'user-1', base);
      expect(m.captured.payload!.refusal_reasons).toBeNull();
    });

    it('is case-sensitive — a near-miss code is dropped, not coerced', async () => {
      const m = dbMock();
      await svc.report(m.db, 'app-1', 'user-1', {
        outcome: 'refused',
        refusalReasons: ['INSUFFICIENT_FUNDS', 'Insufficient_Funds'],
      });
      expect(m.captured.payload!.refusal_reasons).toBeNull();
    });
  });

  it('normalises a missing decidedAt to null', async () => {
    const m = dbMock();
    await svc.report(m.db, 'app-1', 'user-1', base);
    expect(m.captured.payload!.decided_at).toBeNull();
  });

  it('passes decidedAt through when supplied', async () => {
    const m = dbMock();
    await svc.report(m.db, 'app-1', 'user-1', {
      ...base,
      decidedAt: '2026-08-06',
    });
    expect(m.captured.payload!.decided_at).toBe('2026-08-06');
  });

  it('throws when the database rejects the write', async () => {
    // The `outcome` column carries a CHECK constraint, so an invalid value
    // fails closed at the database rather than being persisted.
    const m = dbMock({ error: { message: 'violates check constraint' } });
    await expect(
      svc.report(m.db, 'app-1', 'user-1', {
        outcome: 'not-a-real-outcome' as ReportOutcomeInput['outcome'],
      }),
    ).rejects.toThrow('violates check constraint');
  });
});

describe('OutcomesService.get', () => {
  const svc = new OutcomesService();

  it('reads the row for the requested application', async () => {
    const m = dbMock({ data: { id: 'o1', outcome: 'approved' } });
    const out = await svc.get(m.db, 'app-1');
    expect(m.from).toHaveBeenCalledWith('application_outcomes');
    expect(m.eq).toHaveBeenCalledWith('application_id', 'app-1');
    expect(out).toEqual({ id: 'o1', outcome: 'approved' });
  });

  it('returns null when no outcome has been reported', async () => {
    const m = dbMock({ data: null });
    await expect(svc.get(m.db, 'app-unknown')).resolves.toBeNull();
  });
});
