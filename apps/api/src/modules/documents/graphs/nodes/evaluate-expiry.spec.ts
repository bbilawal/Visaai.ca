import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeEvaluateExpiryNode } from './evaluate-expiry';
import {
  evaluateExpiry,
  extractTravelDate,
  resolveExpiryPolicy,
} from '../expiry-policy';

describe('expiry policy (pure)', () => {
  const now = new Date('2026-06-27T00:00:00Z');

  it('measures the window against intended travel, not now() — the bug fix', () => {
    // Passport expires 2027-03-01: ~8 months out, so a now()-relative 6-month
    // check would PASS. But travel is 2026-12-01 and a passport must stay valid
    // 180 days past travel (~2027-05-30), so it must FAIL.
    const verdict = evaluateExpiry({
      expiry: new Date('2027-03-01T00:00:00Z'),
      travelDate: new Date('2026-12-01T00:00:00Z'),
      now,
      policy: resolveExpiryPolicy('passport'),
    });
    expect(verdict.status).toBe('fail');
    expect(verdict.requiredValidUntil).toBe('2027-05-30');
    expect(verdict.basis).toContain('past intended travel');
  });

  it('passes when valid well past the required-validity date', () => {
    const verdict = evaluateExpiry({
      expiry: new Date('2030-01-01T00:00:00Z'),
      travelDate: new Date('2026-12-01T00:00:00Z'),
      now,
      policy: resolveExpiryPolicy('passport'),
    });
    expect(verdict.status).toBe('pass');
  });

  it('fails an already-expired document', () => {
    const verdict = evaluateExpiry({
      expiry: new Date('2026-01-01T00:00:00Z'),
      travelDate: null,
      now,
      policy: resolveExpiryPolicy('passport'),
    });
    expect(verdict.status).toBe('fail');
    expect(verdict.basis).toBe('expired');
  });

  it('warns within the warn window when no travel date is on file', () => {
    const verdict = evaluateExpiry({
      expiry: new Date('2026-09-01T00:00:00Z'), // ~66 days out, < 180 warn window
      travelDate: null,
      now,
      policy: resolveExpiryPolicy('passport'),
    });
    expect(verdict.status).toBe('warn');
  });

  it('extractTravelDate reads the intended arrival date from a profile', () => {
    const d = extractTravelDate({
      purpose_of_visit: 'tourism',
      intended_arrival_date: '2026-12-01',
    });
    expect(d?.toISOString().slice(0, 10)).toBe('2026-12-01');
  });
});

// ---- node ----
function qb(result: { data?: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'eq']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  // update().eq() is awaited directly -> make the builder thenable.
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return builder;
}

function makeSupabase(profileTravelDate: string | null) {
  const calls: { table: string; payload?: unknown }[] = [];
  const from = jest.fn((table: string) => {
    if (table === 'application_profiles') {
      return qb({
        data: profileTravelDate
          ? { profile_json: { intended_arrival_date: profileTravelDate } }
          : { profile_json: {} },
        error: null,
      });
    }
    const builder = qb({ data: null, error: null });
    const insert = builder.insert as jest.Mock;
    insert.mockImplementation((payload: unknown) => {
      calls.push({ table, payload });
      return builder;
    });
    const update = builder.update as jest.Mock;
    update.mockImplementation((payload: unknown) => {
      calls.push({ table, payload });
      return builder;
    });
    return builder;
  });
  return { supabase: { from } as unknown as SupabaseClient, calls };
}

function state(over: Partial<DocumentState> = {}): DocumentState {
  return {
    documentId: 'doc-1',
    applicationId: 'app-1',
    storagePath: 'p',
    mimeType: 'image/png',
    documentType: 'passport',
    signedUrl: '',
    rawOcrText: 'text',
    extractedFields: { expiry_date: '2027-03-01' },
    verificationResult: 'pass',
    verificationDetails: [],
    allDocsProcessed: false,
    error: null,
    ...over,
  } as DocumentState;
}

describe('evaluate_expiry node', () => {
  it('writes a fail expiry row + persists expiry_status using the travel date', async () => {
    const { supabase, calls } = makeSupabase('2026-12-01');
    const out = await makeEvaluateExpiryNode(supabase)(state());

    expect(out.expiryStatus).toBe('fail');

    const verifInsert = calls.find((c) => c.table === 'document_verifications');
    expect(verifInsert?.payload).toMatchObject({
      verification_type: 'expiry',
      result: 'fail',
    });

    const docUpdate = calls.find((c) => c.table === 'documents');
    expect(docUpdate?.payload).toMatchObject({
      expiry_date: '2027-03-01',
      expiry_status: 'fail',
    });
  });

  it('warns "confirm manually" when a required type has no extracted expiry', async () => {
    const { supabase, calls } = makeSupabase(null);
    const out = await makeEvaluateExpiryNode(supabase)(
      state({ extractedFields: {} }),
    );
    expect(out.expiryStatus).toBe('unknown');
    const verifInsert = calls.find((c) => c.table === 'document_verifications');
    expect(verifInsert?.payload).toMatchObject({ result: 'warn' });
  });

  it('skips silently for a type with no expiry policy and no expiry date', async () => {
    const { supabase, calls } = makeSupabase(null);
    const out = await makeEvaluateExpiryNode(supabase)(
      state({ documentType: 'bank_statement', extractedFields: {} }),
    );
    expect(out).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('short-circuits on a pre-existing error', async () => {
    const { supabase } = makeSupabase(null);
    const out = await makeEvaluateExpiryNode(supabase)(state({ error: 'x' }));
    expect(out).toEqual({});
  });
});

describe('resolveExpiryPolicy — insurance and ID card spellings', () => {
  it.each(['health_insurance', 'travel_insurance', 'travel_health_insurance'])(
    'checks %s as insurance cover, not as a medical exam (#33)',
    (type) => {
      expect(resolveExpiryPolicy(type).id).toBe('medical_insurance');
    },
  );

  it.each(['cnic', 'nicop'])('checks a %s as a national ID', (type) => {
    expect(resolveExpiryPolicy(type).id).toBe('national_id');
  });
});
