import { ServiceUnavailableException } from '@nestjs/common';
import '../../strategies';
import { FormsService } from './forms.service';
import type {
  FormTemplateStore,
  FormTemplateRow,
  FormTemplateKey,
} from './form-template.store';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Scoped client fake. `visible: false` models an RLS-filtered row — the
 * not-your-application case. MEASURED (2026-08-11, local Supabase stack,
 * postgrest/14.5): `.single()` on zero matching rows returns
 * `error.code === 'PGRST116'` — the SAME code for a genuine miss and an
 * RLS-hidden row, which is why both must produce an identical 404 rather
 * than being distinguished in the response.
 */
function scopedDb(
  visible: boolean,
  framework: { country_code: string; visa_type: string } | null = {
    country_code: 'CA',
    visa_type: 'TRV',
  },
  destinationCountry: string | null = null,
) {
  const result = Promise.resolve(
    visible
      ? {
          data: {
            id: 'app-1',
            country_frameworks: framework,
            destination_country: destinationCountry,
          },
          error: null,
        }
      : {
          data: null,
          error: { code: 'PGRST116', message: 'The result contains 0 rows' },
        },
  );
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
  chain.single = () => result;
  chain.maybeSingle = () => result;
  return { from: () => chain } as unknown as SupabaseClient;
}

/**
 * Scoped client fake for a genuine backend failure — NOT the RLS/not-found
 * case. Any `error.code` other than `PGRST116` must surface as 503, never as
 * a silent 404 (Finding 2).
 */
function erroringDb(code = 'PGRST205', message = 'Could not find the table') {
  const result = Promise.resolve({ data: null, error: { code, message } });
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
  chain.single = () => result;
  chain.maybeSingle = () => result;
  return { from: () => chain } as unknown as SupabaseClient;
}

function storeWith(row: Partial<FormTemplateRow> | null) {
  return {
    find: () => Promise.resolve(row as FormTemplateRow | null),
    signedUrl: (p: string) => Promise.resolve(`https://signed.test/${p}`),
  } as unknown as FormTemplateStore;
}

describe('FormsService.listForApplication', () => {
  it('serves an API download path for a cached form', async () => {
    const svc = new FormsService(
      storeWith({
        status: 'ok',
        storage_path: 'CA/visitor_visa/imm-5257/01-09-2023.pdf',
        version_label: '01-09-2023',
        capability: 'xfa',
      }),
    );

    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');

    expect(form.formCode).toBe('IMM 5257');
    expect(form.source).toBe('cache');
    // NOT a Supabase signed URL. Those are built from SUPABASE_URL, which on
    // the VPS is http://127.0.0.1:54421 — the server's own loopback — so every
    // link the API returned was unreachable from a browser and the feature was
    // dead in production. The path points back at this API, which streams the
    // bytes itself. The code is URL-encoded because real codes contain spaces.
    expect(form.downloadPath).toBe('/forms/app-1/file/IMM%205257');
    expect(form.versionLabel).toBe('01-09-2023');
  });

  it('serves a stale cached copy — a failed refresh must not break delivery', async () => {
    const svc = new FormsService(
      storeWith({
        status: 'stale',
        storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
        version_label: '01-01-2019',
        capability: 'xfa',
      }),
    );

    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');
    expect(form.source).toBe('cache');
    expect(form.downloadPath).toBe('/forms/app-1/file/IMM%205257');
  });

  it('falls back to the official link when nothing is cached', async () => {
    const svc = new FormsService(storeWith(null));
    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');

    expect(form.source).toBe('official-link');
    expect(form.downloadPath).toBeNull();
    expect(form.officialUrl).toContain('imm5257.html');
  });

  it('falls back to the official link when robots.txt blocked the form', async () => {
    const svc = new FormsService(
      storeWith({
        status: 'blocked',
        storage_path: null,
        capability: 'unknown',
      }),
    );
    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');
    expect(form.source).toBe('official-link');
  });

  it('marks an acroform template prefillable and an xfa one not', async () => {
    const acro = new FormsService(
      storeWith({
        status: 'ok',
        storage_path: 'p.pdf',
        capability: 'acroform',
        version_label: null,
      }),
    );
    const xfa = new FormsService(
      storeWith({
        status: 'ok',
        storage_path: 'p.pdf',
        capability: 'xfa',
        version_label: null,
      }),
    );

    expect(
      (await acro.listForApplication(scopedDb(true), 'app-1', 'u1'))[0]
        .prefillable,
    ).toBe(true);
    expect(
      (await xfa.listForApplication(scopedDb(true), 'app-1', 'u1'))[0]
        .prefillable,
    ).toBe(false);
  });

  it('throws NotFound when the application is not visible under the caller scope', async () => {
    const svc = new FormsService(storeWith(null));
    await expect(
      svc.listForApplication(scopedDb(false), 'app-1', 'u1'),
    ).rejects.toThrow(/not found/i);
  });

  it('returns an empty list when the program declares no forms', async () => {
    const svc = new FormsService(storeWith(null));
    const db = scopedDb(true, {
      country_code: 'US',
      visa_type: 'visitor_visa',
    });
    await expect(svc.listForApplication(db, 'app-1', 'u1')).resolves.toEqual(
      [],
    );
  });

  /**
   * Carry-forward from Task 4's review: no DB constraint ties `form_templates`
   * to the storage object, so a row can say `status='ok'` with a
   * `storage_path` whose object is missing or was never uploaded.
   *
   * MEASURED against the running local Supabase stack (2026-08-11):
   * `storage.createSignedUrl()` on a non-existent object does NOT happily
   * sign a path that 404s later — it returns
   * `{ data: null, error: StorageApiError('Object not found', 400) }`
   * immediately. `FormTemplateStore.signedUrl()` (Task 5) already treats any
   * error as `null` (`if (error || !data) return null;`), so a missing object
   * surfaces here as `downloadPath === null` with zero extra cost: the
   * existence check is the same signing call `listForApplication` already
   * has to make to produce the URL, not an additional list/download probe.
   *
   * This test pins that: even with `status: 'ok'` and a `storage_path` set,
   * a store whose `signedUrl()` reports "not retrievable" (returns null)
   * must degrade to the official link, not hand back a dead download.
   */
  /**
   * DELIBERATE BEHAVIOUR CHANGE, recorded here rather than left implicit.
   *
   * Listing used to mint a signed URL per form, which incidentally proved the
   * storage object existed: a row pointing at a missing object degraded to the
   * official link right there. It also meant a Storage round trip per form on
   * every page load, and — the reason it had to go — those signed URLs were
   * built from SUPABASE_URL (loopback on the VPS) and no browser could follow
   * them.
   *
   * Now the path is derived from the row alone, so a row that promises bytes
   * storage does not have is discovered when the applicant clicks, not before.
   * That is an acceptable trade: `fileFor` answers 404 and logs at ERROR, the
   * UI surfaces the failure and keeps the official page one click away, and the
   * health watchdog reports the inconsistent row. The listing must NOT go back
   * to touching storage per form.
   */
  it('offers the download from the row alone, and only discovers a missing object on fetch', async () => {
    const store = {
      find: () =>
        Promise.resolve({
          status: 'ok',
          storage_path: 'CA/visitor_visa/imm-5257/ghost.pdf',
          version_label: 'ghost',
          capability: 'xfa',
        } as unknown as FormTemplateRow),
      findByFormCode: () =>
        Promise.resolve({
          status: 'ok',
          storage_path: 'CA/visitor_visa/imm-5257/ghost.pdf',
        } as unknown as FormTemplateRow),
      // The object is gone from storage.
      getBytes: () => Promise.resolve(null),
    } as unknown as FormTemplateStore;

    const svc = new FormsService(store);
    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');

    expect(form.source).toBe('cache');
    expect(form.downloadPath).toBe('/forms/app-1/file/IMM%205257');
    // The official page is always carried, so the UI can fall back on failure.
    expect(form.officialUrl).toContain('imm5257.html');

    await expect(
      svc.fileFor(scopedDb(true), 'app-1', 'IMM 5257'),
    ).rejects.toThrow('Form not available');
  });

  /**
   * Review round 1, Finding 1: FormTemplateStore.find() THROWS on a real
   * Supabase error (hardened in Task 5). Before this fix, the per-form loop
   * had no guard, so one transient cache-read error aborted the whole
   * request with a 500 for every form — contradicting the global constraint
   * that no discovery/download failure may reach an applicant.
   *
   * Uses the Super Visa program (CA/family_sponsorship), which requires TWO
   * forms (IMM 5257, IMM 5645 — see canada.strategy.ts) so a per-form failure
   * can be shown NOT to take down its sibling.
   */
  it('degrades only the one form whose cache lookup throws — the rest of the request still succeeds', async () => {
    const store = {
      find: (key: FormTemplateKey) => {
        if (key.formCode === 'IMM 5257') {
          return Promise.reject(new Error('db down'));
        }
        return Promise.resolve({
          status: 'ok',
          storage_path: 'CA/family_sponsorship/imm-5645/current.pdf',
          version_label: null,
          capability: 'acroform',
        } as unknown as FormTemplateRow);
      },
      signedUrl: (p: string) => Promise.resolve(`https://signed.test/${p}`),
    } as unknown as FormTemplateStore;

    const svc = new FormsService(store);
    const db = scopedDb(true, { country_code: 'CA', visa_type: 'Super Visa' });
    const forms = await svc.listForApplication(db, 'app-1', 'u1');

    const imm5257 = forms.find((f) => f.formCode === 'IMM 5257');
    const imm5645 = forms.find((f) => f.formCode === 'IMM 5645');

    expect(imm5257?.source).toBe('official-link');
    expect(imm5257?.downloadPath).toBeNull();
    expect(imm5645?.source).toBe('cache');
    expect(imm5645?.downloadPath).toBe('/forms/app-1/file/IMM%205645');
  });

  it('does not throw when the cache lookup fails — the request resolves, it never rejects', async () => {
    const store = {
      find: () => Promise.reject(new Error('db down')),
      signedUrl: () => Promise.resolve(null),
    } as unknown as FormTemplateStore;

    const svc = new FormsService(store);
    await expect(
      svc.listForApplication(scopedDb(true), 'app-1', 'u1'),
    ).resolves.toEqual([
      expect.objectContaining({
        formCode: 'IMM 5257',
        source: 'official-link',
      }),
    ]);
  });

  /**
   * Review round 1, Finding 2: `.single()` populates `error` whenever the row
   * count isn't exactly 1 — covering BOTH "RLS hid it" and a genuine backend
   * failure. Collapsing both into 404 (the pre-fix behaviour) silently
   * reports a real outage as "application not found". MEASURED
   * (2026-08-11, local Supabase stack, postgrest/14.5): the no-rows case
   * carries `error.code === 'PGRST116'`; any other code (this test uses
   * `PGRST205`, "table not found in schema cache", measured from a query
   * against a nonexistent table) is a genuine failure and must surface as
   * 503, not a silently-wrong 404.
   */
  it('does not report a genuine backend error as "application not found"', async () => {
    const svc = new FormsService(storeWith(null));
    await expect(
      svc.listForApplication(erroringDb(), 'app-1', 'u1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  /**
   * Review round 1, Finding 3: the `storeWith()` fake's `find()` ignores its
   * key argument entirely, so no test pinned that `listForApplication` builds
   * the lookup key correctly — a regression swapping `program`/`formCode`
   * would still pass every other test in this file.
   */
  it('builds the form_templates lookup key from the resolved country/program/form', async () => {
    let receivedKey: FormTemplateKey | undefined;
    const store = {
      find: (key: FormTemplateKey) => {
        receivedKey = key;
        return Promise.resolve(null);
      },
      signedUrl: () => Promise.resolve(null),
    } as unknown as FormTemplateStore;

    const svc = new FormsService(store);
    await svc.listForApplication(scopedDb(true), 'app-1', 'u1');

    expect(receivedKey).toEqual({
      countryCode: 'CA',
      program: 'visitor_visa',
      formCode: 'IMM 5257',
    });
  });

  /**
   * Whole-branch review, Finding C1 (CRITICAL): `framework_id` is NEVER
   * populated by the real intake path — intake.service.ts writes
   * `input.frameworkId ?? null` and no web caller ever sends one. Measured
   * against the local DB (2026-08-11): 4 applications, 0 with framework_id.
   * So `app.country_frameworks` is null for every real application, and
   * pre-fix `listForApplication` returned `[]` unconditionally — the
   * endpoint served nothing for any real applicant, and the nightly refresh
   * job's cache was never read by anyone.
   *
   * `destination_country` IS populated by the real path
   * (intake.service.ts:71/79). This fake models exactly that shape:
   * `country_frameworks: null`, `destination_country: 'CA'`.
   */
  it('falls back to destination_country when no framework is recorded — the real production shape (Finding C1)', async () => {
    const svc = new FormsService(storeWith(null));
    const db = scopedDb(true, null, 'CA');

    const forms = await svc.listForApplication(db, 'app-1', 'u1');

    expect(forms.length).toBeGreaterThan(0);
    expect(forms.map((f) => f.formCode)).toEqual(
      expect.arrayContaining(['IMM 5257']),
    );
  });

  it('prefers the framework over destination_country when both are present, unchanged from before C1', async () => {
    const svc = new FormsService(storeWith(null));
    // Deliberately mismatched destination_country ('US', which has no
    // registered forms) to prove the framework — not the country fallback —
    // drove the result: CA/TRV resolves to exactly one form.
    const db = scopedDb(true, { country_code: 'CA', visa_type: 'TRV' }, 'US');

    const forms = await svc.listForApplication(db, 'app-1', 'u1');

    expect(forms.map((f) => f.formCode)).toEqual(['IMM 5257']);
  });

  it('returns an empty list when neither a framework nor destination_country is recorded', async () => {
    const svc = new FormsService(storeWith(null));
    const db = scopedDb(true, null, null);

    await expect(svc.listForApplication(db, 'app-1', 'u1')).resolves.toEqual(
      [],
    );
  });

  /**
   * Finding M1 (minor): the strategy registry resolves a country code
   * case-insensitively, but the Postgres `.eq('country_code', …)` filter in
   * FormTemplateStore.find() does not. A lowercase 'ca' framework value must
   * still hit the cached row rather than silently missing it and degrading
   * every form to the official link.
   */
  it('uppercases the country code at the form_templates lookup site (M1)', async () => {
    let receivedKey: FormTemplateKey | undefined;
    const store = {
      find: (key: FormTemplateKey) => {
        receivedKey = key;
        return Promise.resolve(null);
      },
      signedUrl: () => Promise.resolve(null),
    } as unknown as FormTemplateStore;

    const svc = new FormsService(store);
    const db = scopedDb(true, { country_code: 'ca', visa_type: 'TRV' });
    await svc.listForApplication(db, 'app-1', 'u1');

    expect(receivedKey?.countryCode).toBe('CA');
  });
});
