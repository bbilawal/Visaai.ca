import { Logger } from '@nestjs/common';
import { FormTemplateStore, storagePathFor } from './form-template.store';
import type { SupabaseService } from '../shared/supabase/supabase.service';

/**
 * Records what the store sends to Supabase. The real client is a fluent
 * builder, so the fake returns itself from every builder method and resolves
 * at whichever terminal the caller reaches.
 *
 * `opts.queryError` simulates a genuine `form_templates` query failure (as
 * opposed to a real zero-row miss, which is `data: null, error: null`).
 * `opts.downloadError` simulates a storage `download()` failure.
 */
function fakeSupabase(
  rows: unknown[] = [],
  opts: {
    queryError?: { message: string } | null;
    downloadError?: { message: string } | null;
  } = {},
) {
  const queryError = opts.queryError ?? null;
  const downloadError = opts.downloadError ?? null;

  const calls: {
    table?: string;
    upserted?: unknown;
    onConflict?: string;
    orderColumn?: string;
    orderOpts?: { nullsFirst?: boolean; ascending?: boolean };
  } = {};
  const uploads: { path: string; bytes: Uint8Array; contentType?: string }[] =
    [];

  // Applied lazily in `.then()` so tests can genuinely exercise the
  // in()/order()/limit() semantics the store depends on (e.g. findByFormCode
  // relying on 'ok' sorting before 'stale') rather than only asserting the
  // right method calls were made.
  let filterIn: { col: string; values: unknown[] } | null = null;
  let sortSpec: { col: string; ascending: boolean } | null = null;
  let limitN: number | null = null;

  function applyQuery(): unknown[] {
    let result: unknown[] = [...rows];
    if (filterIn) {
      const { col, values } = filterIn;
      result = result.filter((r) =>
        values.includes((r as Record<string, unknown>)[col]),
      );
    }
    if (sortSpec) {
      const { col, ascending } = sortSpec;
      result = [...result].sort((a, b) => {
        const av = (a as Record<string, unknown>)[col];
        const bv = (b as Record<string, unknown>)[col];
        if (av === bv) return 0;
        if (av === undefined || av === null) return ascending ? -1 : 1;
        if (bv === undefined || bv === null) return ascending ? 1 : -1;
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
    }
    if (limitN != null) result = result.slice(0, limitN);
    return result;
  }

  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = () => chain;
  chain.in = (col: string, values: unknown[]) => {
    filterIn = { col, values };
    return chain;
  };
  chain.order = (
    col: string,
    o?: { nullsFirst?: boolean; ascending?: boolean },
  ) => {
    calls.orderColumn = col;
    calls.orderOpts = o;
    sortSpec = { col, ascending: o?.ascending !== false };
    return chain;
  };
  chain.limit = (n: number) => {
    limitN = n;
    return chain;
  };
  chain.maybeSingle = () =>
    Promise.resolve({
      data: queryError ? null : (rows[0] ?? null),
      error: queryError,
    });
  chain.then = (...a: unknown[]) =>
    Promise.resolve({
      data: queryError ? null : applyQuery(),
      error: queryError,
    }).then(...(a as [never, never]));
  chain.upsert = (row: unknown, opts2?: { onConflict?: string }) => {
    calls.upserted = row;
    calls.onConflict = opts2?.onConflict;
    return Promise.resolve({ error: null });
  };

  const bucket = {
    upload: (path: string, bytes: Uint8Array, o?: { contentType?: string }) => {
      uploads.push({ path, bytes, contentType: o?.contentType });
      return Promise.resolve({ error: null });
    },
    download: () =>
      downloadError
        ? Promise.resolve({ data: null, error: downloadError })
        : Promise.resolve({
            data: { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) },
            error: null,
          }),
    createSignedUrl: (path: string) =>
      Promise.resolve({
        data: { signedUrl: `https://signed.test/${path}` },
        error: null,
      }),
  };

  const admin = {
    from: (t: string) => {
      calls.table = t;
      return chain;
    },
    storage: { from: () => bucket },
  };

  return {
    service: { admin } as unknown as SupabaseService,
    calls,
    uploads,
  };
}

describe('storagePathFor', () => {
  it('builds a versioned, slug-safe path', () => {
    expect(
      storagePathFor(
        { countryCode: 'CA', program: 'visitor_visa', formCode: 'IMM 5257' },
        '01-09-2023',
      ),
    ).toBe('CA/visitor_visa/imm-5257/01-09-2023.pdf');
  });

  it('falls back to "current" when the portal exposes no version', () => {
    expect(
      storagePathFor(
        { countryCode: 'CA', program: 'visitor_visa', formCode: 'IMM 5257' },
        null,
      ),
    ).toBe('CA/visitor_visa/imm-5257/current.pdf');
  });

  it('strips characters that would break a storage key', () => {
    expect(
      storagePathFor(
        { countryCode: 'CA', program: 'p', formCode: 'A/B..C' },
        '../evil',
      ),
    ).toBe('CA/p/a-b-c/evil.pdf');
  });

  it('falls back to current when the version label is all separators', () => {
    const key = { countryCode: 'CA', program: 'p', formCode: 'f' };
    expect(storagePathFor(key, '..')).toBe('CA/p/f/current.pdf');
    expect(storagePathFor(key, '-')).toBe('CA/p/f/current.pdf');
    expect(storagePathFor(key, '   ')).toBe('CA/p/f/current.pdf');
  });
});

describe('FormTemplateStore', () => {
  const key = {
    countryCode: 'CA',
    program: 'visitor_visa',
    formCode: 'IMM 5257',
  };

  it('reads from form_templates', async () => {
    const { service, calls } = fakeSupabase([{ form_code: 'IMM 5257' }]);
    const row = await new FormTemplateStore(service).find(key);
    expect(calls.table).toBe('form_templates');
    expect(row?.form_code).toBe('IMM 5257');
  });

  it('returns null when no row matches', async () => {
    const { service } = fakeSupabase([]);
    await expect(new FormTemplateStore(service).find(key)).resolves.toBeNull();
  });

  it('throws when find() hits a query error, rather than returning null', async () => {
    const { service } = fakeSupabase([], {
      queryError: { message: 'connection reset' },
    });
    await expect(new FormTemplateStore(service).find(key)).rejects.toThrow(
      'form_templates read failed: connection reset',
    );
  });

  describe('findByFormCode', () => {
    it("returns the 'ok' row when both an 'ok' and a 'stale' row exist for the form code", async () => {
      // IMM 5257 caches once per program (visitor_visa, family_sponsorship);
      // deliberately return the stale row FIRST so this only passes if the
      // fake — matching the real DB — actually orders 'ok' before 'stale'
      // ascending, not merely "whichever row arrived first wins".
      const staleRow = {
        form_code: 'IMM 5257',
        country_code: 'CA',
        program: 'family_sponsorship',
        status: 'stale',
      };
      const okRow = {
        form_code: 'IMM 5257',
        country_code: 'CA',
        program: 'visitor_visa',
        status: 'ok',
      };
      const { service, calls } = fakeSupabase([staleRow, okRow]);
      const row = await new FormTemplateStore(service).findByFormCode(
        'IMM 5257',
      );
      expect(row?.program).toBe('visitor_visa');
      expect(row?.status).toBe('ok');
      expect(calls.orderColumn).toBe('status');
      expect(calls.orderOpts).toEqual({ ascending: true });
    });

    it("returns null when only 'blocked'/'error' rows exist", async () => {
      const rows = [
        { form_code: 'IMM 5257', program: 'visitor_visa', status: 'blocked' },
        {
          form_code: 'IMM 5257',
          program: 'family_sponsorship',
          status: 'error',
        },
      ];
      const { service } = fakeSupabase(rows);
      await expect(
        new FormTemplateStore(service).findByFormCode('IMM 5257'),
      ).resolves.toBeNull();
    });

    it('throws on a real query error, rather than returning null', async () => {
      const { service } = fakeSupabase([], {
        queryError: { message: 'connection reset' },
      });
      await expect(
        new FormTemplateStore(service).findByFormCode('IMM 5257'),
      ).rejects.toThrow('form_templates read failed: connection reset');
    });

    /**
     * Whole-branch review, Finding I4 (IMPORTANT): the pre-fix query was
     * `.eq('form_code', formCode).limit(1)` with no country filter — safe
     * only because every cached row today is CA. The day a second country
     * registers a form under the same code, this would hand
     * PrefillModule's loader the WRONG country's blank PDF: it gets filled
     * with the applicant's data and returned looking entirely correct — a
     * silent wrong-form delivery, worse than the null it replaced. The fix
     * must fail closed: when the matching rows span more than one distinct
     * country_code, return null (never guess) and log the collision.
     */
    it('fails closed — returns null and logs when cached rows for the form code span more than one country', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const rows = [
        {
          form_code: 'IMM 5257',
          country_code: 'CA',
          program: 'visitor_visa',
          status: 'ok',
        },
        {
          form_code: 'IMM 5257',
          country_code: 'AU',
          program: 'visitor_visa',
          status: 'ok',
        },
      ];
      const { service } = fakeSupabase(rows);

      await expect(
        new FormTemplateStore(service).findByFormCode('IMM 5257'),
      ).resolves.toBeNull();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/IMM 5257/));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/CA/));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/AU/));

      errorSpy.mockRestore();
    });

    it('returns the single matching row when only one country is cached, even with several rows (regression guard)', async () => {
      const rows = [
        {
          form_code: 'IMM 5257',
          country_code: 'CA',
          program: 'family_sponsorship',
          status: 'stale',
        },
        {
          form_code: 'IMM 5257',
          country_code: 'CA',
          program: 'visitor_visa',
          status: 'ok',
        },
      ];
      const { service } = fakeSupabase(rows);

      const row = await new FormTemplateStore(service).findByFormCode(
        'IMM 5257',
      );

      expect(row?.status).toBe('ok');
      expect(row?.country_code).toBe('CA');
    });
  });

  it('lists all rows ordered by last_checked_at, nulls first', async () => {
    const rows = [{ form_code: 'A' }, { form_code: 'B' }];
    const { service, calls } = fakeSupabase(rows);
    await expect(new FormTemplateStore(service).listAll()).resolves.toEqual(
      rows,
    );
    expect(calls.table).toBe('form_templates');
    expect(calls.orderColumn).toBe('last_checked_at');
    expect(calls.orderOpts).toEqual({ nullsFirst: true });
  });

  it('throws when listAll() hits a query error, rather than returning an empty array', async () => {
    const { service } = fakeSupabase([], {
      queryError: { message: 'connection reset' },
    });
    await expect(new FormTemplateStore(service).listAll()).rejects.toThrow(
      'form_templates read failed: connection reset',
    );
  });

  it('upserts on the identity triple so a refresh never duplicates a row', async () => {
    const { service, calls } = fakeSupabase();
    await new FormTemplateStore(service).upsert({
      country_code: 'CA',
      program: 'visitor_visa',
      form_code: 'IMM 5257',
      landing_url: 'https://example.test/x',
      status: 'error',
    });
    expect(calls.onConflict).toBe('country_code,program,form_code');
    expect(calls.upserted).toMatchObject({ form_code: 'IMM 5257' });
  });

  it('stamps updated_at on every upsert', async () => {
    const { service, calls } = fakeSupabase();
    await new FormTemplateStore(service).upsert({
      country_code: 'CA',
      program: 'visitor_visa',
      form_code: 'IMM 5257',
      landing_url: 'https://example.test/x',
      status: 'error',
    });
    expect(calls.upserted).toHaveProperty('updated_at');
  });

  it('uploads with a pdf content type and overwrites in place', async () => {
    const { service, uploads } = fakeSupabase();
    await new FormTemplateStore(service).putBytes(
      'CA/visitor_visa/imm-5257/01-09-2023.pdf',
      new Uint8Array([1, 2, 3]),
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('application/pdf');
  });

  it('downloads bytes for a stored path', async () => {
    const { service } = fakeSupabase();
    const bytes = await new FormTemplateStore(service).getBytes(
      'CA/p/f/current.pdf',
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(4);
  });

  it('returns null when the download errors', async () => {
    const { service } = fakeSupabase([], {
      downloadError: { message: 'object not found' },
    });
    await expect(
      new FormTemplateStore(service).getBytes('CA/p/f/missing.pdf'),
    ).resolves.toBeNull();
  });

  it('mints a signed URL for a stored path', async () => {
    const { service } = fakeSupabase();
    await expect(
      new FormTemplateStore(service).signedUrl('CA/p/f/current.pdf', 300),
    ).resolves.toBe('https://signed.test/CA/p/f/current.pdf');
  });
});
