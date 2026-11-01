import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeRunCrossVerificationNode } from './run-cross-verification';

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

/**
 * Chainable, thenable query-builder mock. Every call is recorded; awaiting a
 * builder resolves to the queued result for (table, op) where op is the first
 * verb used on it (select/upsert/delete).
 */
function makeSupabase(results: Record<string, { data: unknown; error: null }>) {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    let verb: string | null = null;
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'upsert', 'delete', 'eq', 'in', 'order']) {
      builder[m] = jest.fn((...args: unknown[]) => {
        if (!verb && ['select', 'upsert', 'delete'].includes(m)) verb = m;
        calls.push({ table, op: m, args });
        return builder;
      });
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(results[`${table}.${verb}`] ?? { data: null, error: null });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

const state = { applicationId: 'app-1' } as DocumentState;

function verif(docId: string, fields: Record<string, unknown>) {
  return {
    document_id: docId,
    details_json: { extracted_fields: fields },
    verified_at: '2026-10-14T00:00:00Z',
  };
}

function upserted(calls: Call[]) {
  const c = calls.find(
    (x) => x.table === 'cross_verifications' && x.op === 'upsert',
  );
  return (c?.args[0] ?? []) as Array<{
    doc_a_id: string;
    doc_b_id: string;
    field_compared: string;
    result: string;
  }>;
}

const PASSPORT = {
  full_name: 'MUZAFFAR AHMAD',
  date_of_birth: '1961-06-15',
};

describe('run_cross_verification', () => {
  it('reproduces the 2026-10-14 dry run without a single false mismatch', async () => {
    const { client, calls } = makeSupabase({
      'documents.select': {
        data: [
          { id: 'pp', document_type: 'passport_copy' },
          { id: 'cnic', document_type: 'document' },
          { id: 'inv', document_type: 'invitation_letter' },
          { id: 'bank', document_type: 'bank_statement' },
          { id: 'emp', document_type: 'employment_letter' },
          { id: 'ins', document_type: 'medical_insurance' },
          { id: 'mar', document_type: 'marriage_certificate' },
        ],
        error: null,
      },
      'document_verifications.select': {
        data: [
          verif('pp', PASSPORT),
          verif('cnic', {
            full_name: 'Sumera Ahmad Muzaffar Ahmad',
            date_of_birth: '15.06.1961',
          }),
          verif('inv', {
            full_name: 'Bilawal Muzaffar',
            date_of_birth: 'June 2025,',
          }),
          verif('bank', { full_name: 'Bilawal Muzaffar' }),
          verif('emp', { full_name: 'Bilawal Muzaffar' }),
          verif('ins', { full_name: 'Bilawal Muzaffar' }),
          verif('mar', { full_name: 'Sumera Bibi' }),
        ],
        error: null,
      },
      'cross_verifications.select': { data: [], error: null },
    });

    await makeRunCrossVerificationNode(client)(state);

    const rows = upserted(calls);
    expect(rows.filter((r) => r.result === 'mismatch')).toEqual([]);
    // Only the passport ↔ ID-scan pair is compared.
    expect(
      rows.every((r) => [r.doc_a_id, r.doc_b_id].sort().join() === 'cnic,pp'),
    ).toBe(true);
    expect(rows.find((r) => r.field_compared === 'date_of_birth')?.result).toBe(
      'match',
    );
    expect(rows.find((r) => r.field_compared === 'full_name')?.result).toBe(
      'warning',
    );
  });

  it('still flags a genuine DOB mismatch between identity documents', async () => {
    const { client, calls } = makeSupabase({
      'documents.select': {
        data: [
          { id: 'pp', document_type: 'passport' },
          { id: 'id', document_type: 'national_id' },
        ],
        error: null,
      },
      'document_verifications.select': {
        data: [
          verif('pp', PASSPORT),
          verif('id', {
            full_name: 'Muzaffar Ahmad',
            date_of_birth: '16.07.1962',
          }),
        ],
        error: null,
      },
      'cross_verifications.select': { data: [], error: null },
    });

    await makeRunCrossVerificationNode(client)(state);

    const dob = upserted(calls).find(
      (r) => r.field_compared === 'date_of_birth',
    );
    expect(dob?.result).toBe('mismatch');
  });

  it('deletes stale rows for pairs that are no longer compared', async () => {
    const { client, calls } = makeSupabase({
      'documents.select': {
        data: [
          { id: 'pp', document_type: 'passport' },
          { id: 'inv', document_type: 'invitation_letter' },
        ],
        error: null,
      },
      'document_verifications.select': {
        data: [
          verif('pp', PASSPORT),
          verif('inv', { date_of_birth: 'June 2025,' }),
        ],
        error: null,
      },
      'cross_verifications.select': {
        data: [
          {
            id: 'stale-1',
            doc_a_id: 'pp',
            doc_b_id: 'inv',
            field_compared: 'date_of_birth',
          },
        ],
        error: null,
      },
    });

    await makeRunCrossVerificationNode(client)(state);

    const del = calls.find(
      (c) =>
        c.table === 'cross_verifications' &&
        c.op === 'in' &&
        calls.some(
          (d) => d.table === 'cross_verifications' && d.op === 'delete',
        ),
    );
    expect(del?.args).toEqual(['id', ['stale-1']]);
  });

  /**
   * Prod 2026-10-14 after PR #76, re-run once classify_document has re-typed
   * the two generic uploads: the IRCC refusal letter is now supporting (its
   * old DOB/name rows must go) and the CNIC carries the holder's name.
   */
  it('clears the refusal-letter rows and matches the corrected CNIC', async () => {
    const { client, calls } = makeSupabase({
      'documents.select': {
        data: [
          { id: 'pp', document_type: 'passport_copy' },
          { id: 'refusal', document_type: 'refusal_letter' },
          { id: 'cnic', document_type: 'national_id' },
        ],
        error: null,
      },
      'document_verifications.select': {
        data: [
          verif('pp', PASSPORT),
          {
            document_id: 'cnic',
            details_json: {
              extracted_fields: {
                full_name: 'Muzaffar Ahmad',
                date_of_birth: '15.06.1961',
              },
              classified_from_content: 'national_id',
            },
            verified_at: '2026-10-14T00:00:00Z',
          },
        ],
        error: null,
      },
      'cross_verifications.select': {
        data: [
          {
            id: 'old-dob',
            doc_a_id: 'pp',
            doc_b_id: 'refusal',
            field_compared: 'date_of_birth',
          },
          {
            id: 'old-name',
            doc_a_id: 'pp',
            doc_b_id: 'refusal',
            field_compared: 'full_name',
          },
        ],
        error: null,
      },
    });

    await makeRunCrossVerificationNode(client)(state);

    const rows = upserted(calls);
    expect(rows.map((r) => [r.field_compared, r.result]).sort()).toEqual([
      ['date_of_birth', 'match'],
      ['full_name', 'match'],
    ]);
    const delIn = calls.filter(
      (c) => c.table === 'cross_verifications' && c.op === 'in',
    );
    expect(delIn.at(-1)?.args).toEqual(['id', ['old-dob', 'old-name']]);
  });

  it('downgrades a name mismatch on an unclassified upload to a warning', async () => {
    const { client, calls } = makeSupabase({
      'documents.select': {
        data: [
          { id: 'pp', document_type: 'passport' },
          { id: 'doc', document_type: 'document' },
        ],
        error: null,
      },
      'document_verifications.select': {
        data: [
          verif('pp', PASSPORT),
          verif('doc', { full_name: 'Mian Abdul Rasheed EINUY' }),
        ],
        error: null,
      },
      'cross_verifications.select': { data: [], error: null },
    });

    await makeRunCrossVerificationNode(client)(state);

    const name = upserted(calls).find((r) => r.field_compared === 'full_name');
    expect(name?.result).toBe('warning');
    expect(
      (name as unknown as { details_json: { note: string } }).details_json.note,
    ).toMatch(/may belong to someone else/);
  });

  it('compares an ID typed only from its content tolerantly (may be a relative)', async () => {
    const { client, calls } = makeSupabase({
      'documents.select': {
        data: [
          { id: 'pp', document_type: 'passport' },
          { id: 'wife', document_type: 'national_id' },
        ],
        error: null,
      },
      'document_verifications.select': {
        data: [
          verif('pp', PASSPORT),
          {
            document_id: 'wife',
            details_json: {
              extracted_fields: {
                full_name: 'Sumera Bibi',
                date_of_birth: '01.02.1970',
              },
              classified_from_content: 'national_id',
            },
            verified_at: '2026-10-14T00:00:00Z',
          },
        ],
        error: null,
      },
      'cross_verifications.select': { data: [], error: null },
    });

    await makeRunCrossVerificationNode(client)(state);

    const rows = upserted(calls);
    expect(rows.filter((r) => r.result === 'mismatch')).toEqual([]);
    expect(rows.every((r) => r.result === 'warning')).toBe(true);
  });
});
