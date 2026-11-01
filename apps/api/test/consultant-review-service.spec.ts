import { ConsultantReviewService } from '../src/modules/consultant/consultant-review.service';

/**
 * The consultant's "Fields" table can only APPROVE a field by sending the
 * value hash the approval binds to (approveField). The review payload did not
 * carry it, so the table could show decisions but never make one.
 */
function make(assigned: boolean) {
  const rows: Record<string, unknown> = {
    applications: { status: 'in_review' },
    field_provenance: [
      {
        field_key: 'currency',
        value_snapshot: 'V',
        value_hash: 'h-v',
        origin: 'ocr',
        confidence: 0.4,
      },
    ],
    documents: [],
  };
  const client = {
    from: (t: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order']) c[m] = () => c;
      c.maybeSingle = () => Promise.resolve({ data: rows[t], error: null });
      c.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[t], error: null }).then(r);
      return c;
    },
  };
  const repo = {
    getApplicationMeta: async () => ({
      user_id: 'u1',
      destination_country: 'CA',
    }),
    getActiveAssignmentFor: async () => (assigned ? { id: 'as-1' } : null),
    getUserEmails: async () => new Map([['u1', 'a@x.com']]),
  };
  const approval = {
    getApplicationApproval: async () => ({
      fields: [
        {
          fieldKey: 'currency',
          decision: 'rejected',
          approved: false,
          stale: false,
        },
      ],
    }),
  };
  return new ConsultantReviewService(
    { client } as never,
    approval as never,
    repo as never,
  );
}

describe('ConsultantReviewService', () => {
  it('returns each field with its current value hash and decision', async () => {
    const out = await make(true).getReview('app-1', {
      id: 'c1',
      appRole: 'consultant',
    });
    expect(out.fields[0]).toMatchObject({
      fieldKey: 'currency',
      value: 'V',
      valueHash: 'h-v',
      decision: 'rejected',
    });
  });

  it('refuses a consultant who is not the active assignee', async () => {
    await expect(
      make(false).getReview('app-1', { id: 'c2', appRole: 'consultant' }),
    ).rejects.toThrow(/active assignee/);
  });
});
