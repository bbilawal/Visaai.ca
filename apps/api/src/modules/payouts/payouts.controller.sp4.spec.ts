import { PayoutsController } from './payouts.controller';

const user = { id: 'u1' } as any;
function svcs() {
  const payouts = {
    history: jest
      .fn()
      .mockResolvedValue({ payouts: [{ id: 'po1' }], items: [] }),
    dashboardLink: jest.fn().mockResolvedValue({ url: 'https://express/x' }),
  } as any;
  const connect = {} as any;
  const tax = {
    getProfile: jest.fn().mockResolvedValue({
      taxCountry: 'US',
      formType: 'w9',
      businessName: null,
      status: 'submitted',
      taxIdMasked: '***6789',
    }),
    upsertProfile: jest.fn().mockResolvedValue(undefined),
    generateStatement: jest
      .fn()
      .mockResolvedValue({ tax_year: 2026, gross_paid_cents: 120000 }),
  } as any;
  return { payouts, connect, tax };
}

describe('PayoutsController SP4', () => {
  it('history delegates to the service', async () => {
    const { payouts, connect, tax } = svcs();
    const c = new PayoutsController(connect, payouts, tax);
    expect(await c.history(user)).toEqual({
      payouts: [{ id: 'po1' }],
      items: [],
    });
  });
  it('tax-profile GET returns masked profile', async () => {
    const { payouts, connect, tax } = svcs();
    const c = new PayoutsController(connect, payouts, tax);
    const p = await c.getTaxProfile(user);
    expect(p!.taxIdMasked).toBe('***6789');
  });
  it('tax-statements resolves the year', async () => {
    const { payouts, connect, tax } = svcs();
    const c = new PayoutsController(connect, payouts, tax);
    const st = await c.taxStatement(user, '2026');
    expect(tax.generateStatement).toHaveBeenCalledWith('u1', 2026);
    expect(st.tax_year).toBe(2026);
  });
  it('dashboard-link delegates', async () => {
    const { payouts, connect, tax } = svcs();
    const c = new PayoutsController(connect, payouts, tax);
    expect(await c.dashboardLink(user)).toEqual({ url: 'https://express/x' });
  });
});
