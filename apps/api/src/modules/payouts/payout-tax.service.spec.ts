import { PayoutTaxService } from './payout-tax.service';
import { NotFoundException } from '@nestjs/common';

function makeRepo(over: any = {}) {
  return {
    getProfileByUserId: jest
      .fn()
      .mockResolvedValue({ id: 'c1', user_id: 'u1' }),
    upsertTaxProfile: jest.fn().mockResolvedValue(undefined),
    getTaxProfile: jest.fn(),
    sumPaidForYear: jest.fn(),
    upsertTaxStatement: jest.fn(),
    listConsultantsWithPaidPayouts: jest.fn(),
    ...over,
  };
}
const crypto = {
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
} as any;

describe('PayoutTaxService', () => {
  it('upsertProfile encrypts the tax id + marks submitted', async () => {
    const repo = makeRepo();
    const svc = new PayoutTaxService(repo, crypto);
    await svc.upsertProfile('u1', {
      taxCountry: 'US',
      formType: 'w9',
      taxId: '123456789',
      businessName: 'Acme',
    });
    expect(crypto.encrypt).toHaveBeenCalledWith('123456789');
    expect(repo.upsertTaxProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        consultantId: 'c1',
        taxIdEncrypted: 'enc(123456789)',
        status: 'submitted',
      }),
    );
  });

  it('getProfile returns a masked tax id, never raw', async () => {
    const repo = makeRepo({
      getTaxProfile: jest.fn().mockResolvedValue({
        consultant_id: 'c1',
        tax_country: 'US',
        form_type: 'w9',
        business_name: 'Acme',
        status: 'submitted',
        tax_id_encrypted: 'enc(123456789)',
      }),
    });
    const svc = new PayoutTaxService(repo, crypto);
    const p = await svc.getProfile('u1');
    expect(p!.taxIdMasked).toBe('***6789');
    expect(JSON.stringify(p)).not.toContain('123456789');
  });

  it('generateStatement sums the year and upserts', async () => {
    const repo = makeRepo({
      sumPaidForYear: jest.fn().mockResolvedValue({
        grossPaidCents: 120000,
        payoutCount: 3,
        currency: 'usd',
      }),
      upsertTaxStatement: jest.fn().mockResolvedValue({
        consultant_id: 'c1',
        tax_year: 2026,
        gross_paid_cents: 120000,
        payout_count: 3,
        currency: 'usd',
        generated_at: 'now',
      }),
    });
    const svc = new PayoutTaxService(repo, crypto);
    const st = await svc.generateStatement('u1', 2026);
    expect(repo.sumPaidForYear).toHaveBeenCalledWith('c1', 2026);
    expect(st.gross_paid_cents).toBe(120000);
  });

  it('throws when the user has no consultant profile', async () => {
    const svc = new PayoutTaxService(
      makeRepo({ getProfileByUserId: jest.fn().mockResolvedValue(null) }),
      crypto,
    );
    await expect(svc.generateStatement('u1', 2026)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
