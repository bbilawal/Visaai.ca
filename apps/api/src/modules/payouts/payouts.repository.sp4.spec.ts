import { PayoutsRepository } from './payouts.repository.impl';

function sb(over: any) {
  return { admin: { from: jest.fn((t: string) => over[t]) } } as any;
}

describe('PayoutsRepository SP4', () => {
  it('markPayoutReversed sets status + deletes items, returns consultant id', async () => {
    const updateEq = jest.fn().mockReturnValue({
      select: () => ({
        maybeSingle: () => ({ data: { id: 'po_1', consultant_id: 'c1' } }),
      }),
    });
    const delEq = jest.fn().mockResolvedValue({ error: null });
    const repo = new PayoutsRepository(
      sb({
        consultant_payouts: { update: () => ({ eq: updateEq }) },
        consultant_payout_items: { delete: () => ({ eq: delEq }) },
      }),
    );
    const r = await repo.markPayoutReversed('tr_1');
    expect(r).toEqual({ reversed: true, consultantId: 'c1' });
    expect(delEq).toHaveBeenCalledWith('payout_id', 'po_1');
  });

  it('markPayoutReversed is a no-op when the transfer matches no payout and no item', async () => {
    const repo = new PayoutsRepository(
      sb({
        consultant_payouts: {
          update: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: () => ({ data: null }) }),
            }),
          }),
        },
        consultant_payout_items: {
          select: () => ({
            eq: () => ({ maybeSingle: () => ({ data: null }) }),
          }),
        },
      }),
    );
    expect(await repo.markPayoutReversed('tr_x')).toEqual({
      reversed: false,
      consultantId: null,
    });
  });

  it('markPayoutReversed reverses only the matching item and re-derives the payout total', async () => {
    // Transfers are per item now, so a reversal names an item's transfer — not
    // the payout's. Reversing one order must leave its siblings paid.
    const delEq = jest.fn().mockResolvedValue({ error: null });
    const updates: unknown[] = [];
    let itemSelectCall = 0;

    const repo = new PayoutsRepository(
      sb({
        consultant_payouts: {
          update: jest.fn((patch: unknown) => {
            updates.push(patch);
            return {
              eq: () => ({
                // Legacy grouped-transfer lookup misses.
                select: () => ({ maybeSingle: () => ({ data: null }) }),
                // The later amount re-derivation is awaited directly.
                then: (resolve: (v: unknown) => void) =>
                  resolve({ error: null }),
              }),
            };
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({ data: { consultant_id: 'c9' } }),
            }),
          }),
        },
        consultant_payout_items: {
          select: jest.fn(() => {
            itemSelectCall += 1;
            return itemSelectCall === 1
              ? {
                  eq: () => ({
                    maybeSingle: () => ({
                      data: { id: 'it_1', payout_id: 'po_9' },
                    }),
                  }),
                }
              : { eq: () => Promise.resolve({ data: [{ amount_usd: 40 }] }) };
          }),
          delete: () => ({ eq: delEq }),
        },
      }),
    );

    const r = await repo.markPayoutReversed('tr_item_1');

    expect(r).toEqual({ reversed: true, consultantId: 'c9' });
    // Only that one item is unlinked, so only that order re-sweeps.
    expect(delEq).toHaveBeenCalledWith('id', 'it_1');
    // updates[0] is the legacy `stripe_transfer_id` probe — it matches no payout
    // row (the id lives on an item), so it updates nothing. updates[1] is the
    // one that actually targets this payout: $40 of siblings survive, so it is
    // retotalled and NOT marked reversed.
    expect(updates[1]).toEqual({ amount_usd: 40 });
  });

  it('upsertTaxProfile writes encrypted id + upserts on consultant_id', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const repo = new PayoutsRepository(
      sb({ consultant_tax_profiles: { upsert } }),
    );
    await repo.upsertTaxProfile({
      consultantId: 'c1',
      taxCountry: 'US',
      formType: 'w9',
      taxIdEncrypted: 'enc',
      businessName: null,
      status: 'submitted',
    });
    const [row, opts] = upsert.mock.calls[0];
    expect(row.tax_id_encrypted).toBe('enc');
    expect(opts).toEqual({ onConflict: 'consultant_id' });
  });
});
