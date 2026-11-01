import { ConfigService } from '@nestjs/config';
import { CA_ETA_VISAAI_ID } from '@visaai/types';
import { BillingService, PREFILL_PRICE } from './billing.service';

const config = new ConfigService({
  WEB_URL: 'https://app.visaai.test',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
});

/** Minimal admin-client fake: applications lookup, payments lookup/insert, audit insert. */
function makeAdmin(opts: {
  app?: {
    id: string;
    user_id: string;
    visa_types?: { visaai_id: string | null } | null;
  } | null;
  existing?: { id: string }[];
  auditError?: unknown;
}) {
  const inserts: Record<string, unknown[]> = {};
  const deletes: string[] = [];
  const from = jest.fn((table: string) => {
    const chain: any = {
      _filters: {} as Record<string, unknown>,
      select: () => chain,
      eq: (k: string, v: unknown) => ((chain._filters[k] = v), chain),
      limit: () =>
        Promise.resolve({
          data: table === 'payments' ? (opts.existing ?? []) : [],
          error: null,
        }),
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'applications' ? (opts.app ?? null) : null,
          error: null,
        }),
      delete: () => ({
        eq: (_k: string, v: string) => {
          deletes.push(`${table}:${v}`);
          return Promise.resolve({ error: null });
        },
      }),
      insert: (row: unknown) => {
        (inserts[table] ??= []).push(row);
        if (table === 'auth_audit_log')
          return Promise.resolve({ error: opts.auditError ?? null });
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'pay-1' }, error: null }),
          }),
        };
      },
    };
    return chain;
  });
  return { admin: { from }, inserts, deletes };
}

function svcWith(admin: unknown) {
  return new BillingService(
    config,
    { admin } as any,
    {} as any,
    {} as any,
    { emit: jest.fn() } as any,
    { name: 'stripe' } as any,
    {} as any,
    {} as any,
  );
}

describe('BillingService.waivePrefillFee (admin comp)', () => {
  it('records a $0 waiver payment and an audit row', async () => {
    const { admin, inserts } = makeAdmin({
      app: { id: 'app-1', user_id: 'owner-1' },
    });
    const res = await svcWith(admin).waivePrefillFee(
      'app-1',
      'admin-1',
      'dry-run test',
    );
    expect(res).toEqual({ paymentId: 'pay-1', alreadyUnlocked: false });
    expect(inserts.payments).toEqual([
      expect.objectContaining({
        user_id: 'owner-1',
        application_id: 'app-1',
        feature: 'prefill',
        status: 'complete',
        provider: 'waiver',
        amount_cents: 0,
        discount_cents: 2900,
      }),
    ]);
    expect(inserts.auth_audit_log).toEqual([
      expect.objectContaining({
        user_id: 'owner-1',
        actor_id: 'admin-1',
        event_type: 'prefill_fee_waived',
        metadata: {
          applicationId: 'app-1',
          paymentId: 'pay-1',
          reason: 'dry-run test',
        },
      }),
    ]);
  });

  it('waives the eTA at its own price ($10), not the default', async () => {
    const { admin, inserts } = makeAdmin({
      app: {
        id: 'app-1',
        user_id: 'owner-1',
        visa_types: { visaai_id: CA_ETA_VISAAI_ID },
      },
    });
    await svcWith(admin).waivePrefillFee('app-1', 'admin-1', 'x');
    expect(inserts.payments).toEqual([
      expect.objectContaining({ amount_cents: 0, discount_cents: 1000 }),
    ]);
  });

  it('is idempotent when the fee is already paid or waived', async () => {
    const { admin, inserts } = makeAdmin({
      app: { id: 'app-1', user_id: 'owner-1' },
      existing: [{ id: 'pay-0' }],
    });
    const res = await svcWith(admin).waivePrefillFee('app-1', 'admin-1', 'x');
    expect(res).toEqual({ paymentId: 'pay-0', alreadyUnlocked: true });
    expect(inserts.payments).toBeUndefined();
  });

  it('404s an unknown application', async () => {
    const { admin } = makeAdmin({ app: null });
    await expect(
      svcWith(admin).waivePrefillFee('nope', 'admin-1', 'x'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('fails loudly and rolls the waiver back when the audit row cannot be written', async () => {
    const { admin, deletes } = makeAdmin({
      app: { id: 'app-1', user_id: 'owner-1' },
      auditError: { message: 'boom' },
    });
    await expect(
      svcWith(admin).waivePrefillFee('app-1', 'admin-1', 'x'),
    ).rejects.toThrow(/audit failed/);
    expect(deletes).toEqual(['payments:pay-1']);
  });
});

describe('BillingService.createPrefillCheckoutSession (per-visa price)', () => {
  function checkout(app: unknown) {
    const createCheckoutSession = jest
      .fn()
      .mockResolvedValue({ id: 'cs', url: 'https://checkout/x' });
    const selects: string[] = [];
    const db: any = {
      from: () => {
        const chain: any = {
          select: (cols: string) => (selects.push(cols), chain),
          eq: () => chain,
          single: () => Promise.resolve({ data: app, error: null }),
        };
        return chain;
      },
    };
    const svc = new BillingService(
      config,
      { admin: {} } as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      { name: 'stripe', createCheckoutSession } as any,
      {} as any,
      {} as any,
    );
    const run = svc.createPrefillCheckoutSession(db, {
      userId: 'owner-1',
      applicationId: 'app-1',
      successUrl: 'https://app.visaai.test/ok',
      cancelUrl: 'https://app.visaai.test/no',
    });
    return { run, createCheckoutSession, selects };
  }

  it('charges 1000 cents for a Canada eTA application', async () => {
    const { run, createCheckoutSession, selects } = checkout({
      id: 'app-1',
      user_id: 'owner-1',
      visa_types: { visaai_id: CA_ETA_VISAAI_ID },
    });
    await expect(run).resolves.toEqual({ url: 'https://checkout/x' });
    expect(selects[0]).toContain('visa_types(visaai_id)');
    const arg = createCheckoutSession.mock.calls[0][0];
    expect(arg.lineItems).toEqual([
      {
        name: `VisaAI ${PREFILL_PRICE.label}`,
        amount: { amountMinor: 1000, currency: 'usd' },
        quantity: 1,
      },
    ]);
    expect(arg.metadata).toMatchObject({ feature: 'prefill' });
  });

  it('charges the 2900-cent default for any other visa type', async () => {
    const { run, createCheckoutSession } = checkout({
      id: 'app-1',
      user_id: 'owner-1',
      visa_types: [{ visaai_id: 'ca-visitor-visa-trv' }],
    });
    await run;
    expect(createCheckoutSession.mock.calls[0][0].lineItems[0].amount).toEqual({
      amountMinor: 2900,
      currency: 'usd',
    });
  });

  it('charges the default when the application has no visa type', async () => {
    const { run, createCheckoutSession } = checkout({
      id: 'app-1',
      user_id: 'owner-1',
      visa_types: null,
    });
    await run;
    expect(
      createCheckoutSession.mock.calls[0][0].lineItems[0].amount.amountMinor,
    ).toBe(2900);
  });
});
