import { PrefillService } from '../src/modules/prefill/prefill.service';
import * as pdf from '../src/modules/prefill/prefill-pdf';

// A minimal chainable fake of the supabase-js query builder.
function fakeDb(opts: {
  ownership: boolean;
  paid: boolean;
  record: unknown;
  preferredLanguage: string | null;
}) {
  return {
    from(table: string) {
      const api: any = {
        select: () => api,
        eq: () => api,
        limit: () => Promise.resolve({ data: opts.paid ? [{ id: 'p1' }] : [] }),
        single: () =>
          Promise.resolve({
            data: opts.ownership ? { id: 'app1' } : null,
          }),
        maybeSingle: () => {
          if (table === 'users')
            return Promise.resolve({
              data: { preferred_language: opts.preferredLanguage },
            });
          return Promise.resolve({ data: opts.record });
        },
      };
      return api;
    },
  };
}

describe('PrefillService.getPdf locale resolution', () => {
  const svc = new PrefillService(
    {} as any,
    { get: () => 'sk-test' } as any,
    {} as any,
    {} as any,
  );
  const record = {
    id: 'doc1',
    content_md: JSON.stringify({
      visaType: 'visitor',
      countryCode: 'CA',
      purpose: 'tourism',
      generatedAt: '2026-06-12T00:00:00Z',
      fields: [{ key: 'family_name', label: 'Family name', value: 'محمد' }],
    }),
    approved_by_user: false,
  };

  afterEach(() => jest.restoreAllMocks());

  it("passes the user's preferred_language to the renderer", async () => {
    const spy = jest
      .spyOn(pdf, 'renderPrefilledFormPdf')
      .mockResolvedValue(new Uint8Array([1]));
    const db = fakeDb({
      ownership: true,
      paid: true,
      record,
      preferredLanguage: 'ar',
    });
    await svc.getPdf(db as any, 'app1', 'user1');
    expect(spy).toHaveBeenCalledWith(expect.any(Object), 'ar');
  });

  it("defaults to 'en' when preferred_language is null", async () => {
    const spy = jest
      .spyOn(pdf, 'renderPrefilledFormPdf')
      .mockResolvedValue(new Uint8Array([1]));
    const db = fakeDb({
      ownership: true,
      paid: true,
      record,
      preferredLanguage: null,
    });
    await svc.getPdf(db as any, 'app1', 'user1');
    expect(spy).toHaveBeenCalledWith(expect.any(Object), 'en');
  });
});
