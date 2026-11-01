import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeEvaluateExpiryNode } from './evaluate-expiry';
import {
  evaluateExpiry,
  extractTravelDate,
  resolveExpiryPolicy,
} from '../expiry-policy';

/**
 * Prod app 61f16bb5 (super visa, 2026-10-16): the parents' insurance policy
 * (Jun 2025 – May 2026) was marked "expired" with `travel_date: null` although
 * the profile says `planned_entry_date: 2027-03-01`. What the applicant needs
 * to hear is that the policy does not cover the stay — IRCC wants it valid at
 * least 1 year from entry.
 */
describe('insurance coverage against the planned stay', () => {
  const now = new Date('2026-10-16T00:00:00Z');

  it('reads planned_entry_date as the travel date', () => {
    const d = extractTravelDate({ planned_entry_date: '2027-03-01' });
    expect(d?.toISOString().slice(0, 10)).toBe('2027-03-01');
  });

  it('says an expired policy does not cover the planned stay', () => {
    const v = evaluateExpiry({
      expiry: new Date('2026-05-31T00:00:00Z'),
      travelDate: new Date('2027-03-01T00:00:00Z'),
      now,
      policy: resolveExpiryPolicy('medical_insurance'),
      minValidityMonths: 12,
    });
    expect(v.status).toBe('fail');
    expect(v.requiredValidUntil).toBe('2028-03-01');
    expect(v.basis).toMatch(/does not cover your planned stay/);
    expect(v.basis).toMatch(/2028-03-01/);
  });

  it('fails a current policy that ends before 12 months after entry', () => {
    const v = evaluateExpiry({
      expiry: new Date('2027-09-01T00:00:00Z'),
      travelDate: new Date('2027-03-01T00:00:00Z'),
      now,
      policy: resolveExpiryPolicy('medical_insurance'),
      minValidityMonths: 12,
    });
    expect(v.status).toBe('fail');
    expect(v.basis).toMatch(/12 months from your planned entry/);
  });

  it('passes a policy covering a full year from entry', () => {
    const v = evaluateExpiry({
      expiry: new Date('2028-03-15T00:00:00Z'),
      travelDate: new Date('2027-03-01T00:00:00Z'),
      now,
      policy: resolveExpiryPolicy('medical_insurance'),
      minValidityMonths: 12,
    });
    expect(v.status).toBe('pass');
  });

  it('leaves the passport rule untouched', () => {
    const v = evaluateExpiry({
      expiry: new Date('2026-01-01T00:00:00Z'),
      travelDate: null,
      now,
      policy: resolveExpiryPolicy('passport'),
    });
    expect(v.basis).toBe('expired');
  });
});

describe('evaluate_expiry node — validity from the checklist slot', () => {
  function db() {
    const inserted: unknown[] = [];
    const rows: Record<string, unknown> = {
      application_profiles: {
        profile_json: { planned_entry_date: '2027-03-01' },
      },
      documents: { checklist_item_id: 'item-ins' },
      checklist_items: { meta: { kind: 'document', min_validity_months: 12 } },
    };
    const from = (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        update: () => b,
        insert: (p: unknown) => {
          if (table === 'document_verifications') inserted.push(p);
          return b;
        },
        maybeSingle: () =>
          Promise.resolve({ data: rows[table] ?? null, error: null }),
        then: (r: any) => Promise.resolve({ data: null, error: null }).then(r),
      };
      return b;
    };
    return { client: { from } as unknown as SupabaseClient, inserted };
  }

  it('measures the insurance policy against 12 months from the planned entry', async () => {
    const { client, inserted } = db();
    const out = await makeEvaluateExpiryNode(client)({
      documentId: 'doc-ins',
      applicationId: 'app-1',
      documentType: 'medical_insurance',
      extractedFields: { expiry_date: '2027-09-01' },
      error: null,
    } as unknown as DocumentState);
    expect(out.expiryStatus).toBe('fail');
    expect(inserted[0]).toMatchObject({
      verification_type: 'expiry',
      details_json: expect.objectContaining({
        travel_date: '2027-03-01',
        required_valid_until: '2028-03-01',
      }),
    });
  });
});

describe('expiry from the dates a document actually states (prod app 61f16bb5 dummies)', () => {
  function db(slotMeta: Record<string, unknown> = {}) {
    const inserted: Array<Record<string, unknown>> = [];
    const rows: Record<string, unknown> = {
      application_profiles: {
        profile_json: { planned_entry_date: '2027-03-01' },
      },
      documents: { checklist_item_id: 'item' },
      checklist_items: { meta: { kind: 'document', ...slotMeta } },
    };
    const from = (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        update: () => b,
        insert: (p: Record<string, unknown>) => {
          if (table === 'document_verifications') inserted.push(p);
          return b;
        },
        maybeSingle: () =>
          Promise.resolve({ data: rows[table] ?? null, error: null }),
        then: (r: any) => Promise.resolve({ data: null, error: null }).then(r),
      };
      return b;
    };
    return { client: { from } as unknown as SupabaseClient, inserted };
  }
  const doc = (
    documentType: string,
    extractedFields: Record<string, unknown>,
  ) =>
    ({
      documentId: 'd',
      applicationId: 'a',
      documentType,
      extractedFields,
      error: null,
    }) as unknown as DocumentState;

  it('reads an insurance policy end from coverage_end_date', async () => {
    const { client, inserted } = db({ min_validity_months: 12 });
    const out = await makeEvaluateExpiryNode(client)(
      doc('medical_insurance', {
        coverage_start_date: '2027-03-01',
        coverage_end_date: '2028-03-01',
        coverage_amount: 100000,
      }),
    );
    expect(out.expiryStatus).toBe('pass');
    expect(inserted[0].details_json).toMatchObject({
      expiry_date: '2028-03-01',
      required_valid_until: '2028-03-01',
    });
  });

  it('dates an immigration medical exam 12 months from the exam, not from "now"', async () => {
    const { client, inserted } = db();
    const out = await makeEvaluateExpiryNode(client)(
      doc('proof_of_medical_exam', { exam_date: '2026-10-10' }),
    );
    // Valid until 2027-10-10, which covers a 2027-03-01 entry.
    expect(out.expiryStatus).toBe('pass');
    expect(inserted[0].details_json).toMatchObject({
      policy_id: 'medical_exam',
      expiry_date: '2027-10-10',
    });
  });

  it('fails an exam that will have lapsed by the planned entry', async () => {
    const { client, inserted } = db();
    const out = await makeEvaluateExpiryNode(client)(
      doc('proof_of_medical_exam', { exam_date: '2026-01-15' }),
    );
    expect(out.expiryStatus).toBe('fail');
    expect(inserted[0].details_json).toMatchObject({
      expiry_date: '2027-01-15',
    });
  });
});
