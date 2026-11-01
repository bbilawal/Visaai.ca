import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { TemplateRevisionStore } from './template-revision.store';
import { FormRefreshService } from './form-refresh.service';
import { RobotsGate } from './robots';
import type { FetchLike, HttpResponse } from './http';
import type { FormTemplateStore, FormTemplateRow } from './form-template.store';
import { allCatalogedForms } from './form-catalog';

const LANDING = 'https://gov.test/forms/f1.html';
// Filename carries 'imm5257' so it matches FORM.formCode below under
// Important 5's formCode-aware discovery (extractPdfLink only accepts an
// href whose filename contains the normalized form code).
const PDF_URL = 'https://gov.test/dam/forms/imm5257/01-09-2023/imm5257e.pdf';

const FORM = {
  countryCode: 'CA',
  program: 'visitor_visa',
  formCode: 'IMM 5257',
  formName: 'Application for Temporary Resident Visa',
  landingUrl: LANDING,
  portalId: 'ircc',
};

async function xfaPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
  return pdf.save();
}

function res(over: Partial<HttpResponse> = {}): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    ...over,
  };
}

/** Serves robots.txt, the landing page, and the PDF from one stub. */
function http(opts: {
  robots?: string;
  landing?: string;
  pdf?: Uint8Array;
  pdfStatus?: number;
}): FetchLike {
  return (url) => {
    if (url.endsWith('/robots.txt')) {
      return Promise.resolve(
        res({ text: () => Promise.resolve(opts.robots ?? 'User-agent: *\n') }),
      );
    }
    if (url === LANDING) {
      return Promise.resolve(
        res({
          text: () =>
            Promise.resolve(
              opts.landing ??
                `<a href="/dam/forms/imm5257/01-09-2023/imm5257e.pdf">form</a>`,
            ),
        }),
      );
    }
    const status = opts.pdfStatus ?? 200;
    const bytes = opts.pdf ?? new Uint8Array([1, 2, 3]);
    return Promise.resolve(
      res({
        ok: status === 200,
        status,
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          ),
      }),
    );
  };
}

function fakeStore(existing: Partial<FormTemplateRow> | null = null) {
  const upserts: Record<string, unknown>[] = [];
  const puts: { path: string; bytes: Uint8Array }[] = [];
  const store = {
    find: () => Promise.resolve(existing as FormTemplateRow | null),
    listAll: () => Promise.resolve([]),
    upsert: (row: Record<string, unknown>) => {
      upserts.push(row);
      return Promise.resolve();
    },
    putBytes: (path: string, bytes: Uint8Array) => {
      puts.push({ path, bytes });
      return Promise.resolve();
    },
    getBytes: () => Promise.resolve(null),
    signedUrl: () => Promise.resolve(null),
  } as unknown as FormTemplateStore;
  return { store, upserts, puts };
}

const last = (u: Record<string, unknown>[]) => u[u.length - 1];

/**
 * The revision ledger is observability, not behaviour: nothing in the refresh
 * path branches on it, and `record()` is contractually incapable of throwing.
 * A recording stub keeps these tests about the cache while still letting the
 * ledger's own assertions live in template-revision.store.spec.ts.
 */
const recorded: unknown[] = [];
const revisionStub = {
  record: (input: unknown) => {
    recorded.push(input);
    return Promise.resolve();
  },
} as unknown as TemplateRevisionStore;

beforeEach(() => {
  recorded.length = 0;
});

describe('FormRefreshService.refreshOne', () => {
  it('discovers, downloads, probes, and stores a new form', async () => {
    const pdf = await xfaPdf();
    const sha = createHash('sha256').update(pdf).digest('hex');
    const { store, upserts, puts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('ok');
    expect(puts).toHaveLength(1);
    // Content-addressed: the storage key carries a short hash suffix so a
    // future re-issue under the same version label cannot collide with this
    // object (CRITICAL 2).
    expect(puts[0].path).toBe(
      `CA/visitor_visa/imm-5257/01-09-2023-${sha.slice(0, 12)}.pdf`,
    );
    expect(last(upserts)).toMatchObject({
      status: 'ok',
      capability: 'xfa',
      version_label: '01-09-2023',
      resolved_pdf_url: PDF_URL,
      sha256: sha,
      byte_size: pdf.length,
    });
  });

  it('marks the row blocked and never fetches a robots-disallowed PDF', async () => {
    const robots = 'User-agent: *\nDisallow: /dam/forms/imm5257/\n';
    const fetched: string[] = [];
    const inner = http({ robots });
    const spy: FetchLike = (url, init) => {
      fetched.push(url);
      return inner(url, init);
    };

    const { store, upserts, puts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(spy),
      spy,
      revisionStub,
    );
    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('blocked');
    expect(puts).toHaveLength(0);
    expect(fetched).not.toContain(PDF_URL);
    expect(last(upserts)).toMatchObject({ status: 'blocked' });
  });

  it('skips the download when version and checksum are unchanged', async () => {
    const pdf = await xfaPdf();
    const sha = createHash('sha256').update(pdf).digest('hex');
    const { store, upserts, puts } = fakeStore({
      version_label: '01-09-2023',
      sha256: sha,
      storage_path: 'CA/visitor_visa/imm-5257/01-09-2023.pdf',
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('unchanged');
    expect(puts).toHaveLength(0);
    expect(last(upserts)).toMatchObject({ status: 'ok' });
    expect(last(upserts)).toHaveProperty('last_checked_at');
  });

  it('re-downloads when the version label moves', async () => {
    const pdf = await xfaPdf();
    const sha = createHash('sha256').update(pdf).digest('hex');
    const { store, puts } = fakeStore({
      version_label: '01-01-2019',
      sha256: 'stale-checksum',
      storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
      revisionStub,
    );

    expect((await svc.refreshOne(FORM)).status).toBe('ok');
    expect(puts[0].path).toBe(
      `CA/visitor_visa/imm-5257/01-09-2023-${sha.slice(0, 12)}.pdf`,
    );
  });

  it('re-downloads when the bytes changed under an unchanged version label, at a storage path that cannot collide with the live cached object', async () => {
    const pdf = await xfaPdf();
    const sha = createHash('sha256').update(pdf).digest('hex');
    const existingPath = 'CA/visitor_visa/imm-5257/01-09-2023.pdf';
    const { store, puts } = fakeStore({
      version_label: '01-09-2023',
      sha256: 'a'.repeat(64), // same label, different content
      storage_path: existingPath,
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
      revisionStub,
    );

    expect((await svc.refreshOne(FORM)).status).toBe('ok');
    expect(puts).toHaveLength(1);
    // CRITICAL 2: storagePathFor regenerates the SAME path for an unchanged
    // version label, and putBytes upserts in place — without a content-hash
    // suffix this write would silently destroy the still-live cached object
    // at `existingPath`, breaking any signed URL already handed to a user.
    expect(puts[0].path).not.toBe(existingPath);
    expect(puts[0].path).toBe(
      `CA/visitor_visa/imm-5257/01-09-2023-${sha.slice(0, 12)}.pdf`,
    );
  });

  it('degrades an existing cached copy to stale on a 404 download', async () => {
    const h = http({ pdfStatus: 404 });
    const { store, upserts, puts } = fakeStore({
      version_label: '01-01-2019',
      sha256: 'old',
      storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('stale');
    expect(puts).toHaveLength(0);
    // The cached copy must survive so delivery keeps working.
    expect(last(upserts)).toMatchObject({
      status: 'stale',
      storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
    });
  });

  it('rejects a 200 response that is not actually a PDF, preserving the existing cached copy as stale', async () => {
    // This portal is documented (modules/prefill/forms/imm5257.ts) to serve a
    // text/html error page with a 200 status for a form URL. A 200 alone
    // must never be trusted as proof of a PDF (CRITICAL 1).
    const htmlBody = new TextEncoder().encode('<html>Oops, not a form</html>');
    const h = http({ pdf: htmlBody });
    const existingPath = 'CA/visitor_visa/imm-5257/01-01-2019.pdf';
    const { store, upserts, puts } = fakeStore({
      version_label: '01-01-2019',
      sha256: 'old',
      storage_path: existingPath,
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('stale');
    expect(puts).toHaveLength(0);
    expect(last(upserts)).toMatchObject({
      status: 'stale',
      storage_path: existingPath,
      sha256: 'old',
    });
    expect(String(last(upserts).error_message)).toMatch(/not a pdf/i);
  });

  it('rejects a zero-byte 200 response as not a PDF', async () => {
    // A zero-byte body would otherwise violate form_templates_byte_size_check
    // and throw on upsert AFTER putBytes had already run (CRITICAL 1).
    const h = http({ pdf: new Uint8Array(0) });
    const { store, upserts, puts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('error');
    expect(puts).toHaveLength(0);
    expect(String(last(upserts).error_message)).toMatch(/not a pdf/i);
  });

  /**
   * Whole-branch review, Finding I1 (IMPORTANT): pre-fix, RobotsGate.allows()
   * collapsed "explicitly disallowed" and "robots.txt unreachable" into the
   * same `false`, so a transient robots.txt failure was written as
   * "robots.txt disallows <url>" (a lie) with status 'blocked' — and
   * delivery refuses to serve 'blocked' rows even when a working cached copy
   * exists. The tri-state fix must route a transport failure through the
   * SAME degraded-but-preserved path as a download failure: 'stale' with the
   * existing storage_path intact, not 'blocked'.
   */
  it('treats a robots.txt transport failure as degraded, not blocked — an existing cached copy stays "stale" (I1)', async () => {
    const pdf = await xfaPdf();
    const existingPath = 'CA/visitor_visa/imm-5257/01-01-2019.pdf';
    const { store, upserts, puts } = fakeStore({
      version_label: '01-01-2019',
      sha256: 'old',
      storage_path: existingPath,
      status: 'ok',
    });
    const baseHttp = http({ pdf });
    // Only robots.txt fails to load; the landing page and PDF download would
    // both succeed if reached — they must not be, since the row degrades
    // before either the blocked-vs-allowed decision or the download step.
    const robotsFailingHttp: FetchLike = (url, init) => {
      if (url.endsWith('/robots.txt')) {
        return Promise.reject(new Error('ECONNRESET'));
      }
      return baseHttp(url, init);
    };
    const svc = new FormRefreshService(
      store,
      new RobotsGate(robotsFailingHttp),
      baseHttp,
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('stale');
    expect(puts).toHaveLength(0);
    expect(last(upserts)).toMatchObject({
      status: 'stale',
      storage_path: existingPath,
      sha256: 'old',
    });
    expect(String(last(upserts).error_message)).toMatch(
      /robots\.txt unreachable/i,
    );
    expect(String(out.message)).toMatch(/robots\.txt unreachable/i);
  });

  /**
   * Whole-branch review, Finding I2 (IMPORTANT): the %PDF magic-byte gate
   * only proves the response STARTS with those bytes — a truncated body
   * that still opens with `%PDF` sails through it. probeFormCapability
   * already reports { capability: 'unknown', pageCount: 0 } when
   * PDFDocument.load() throws; pre-fix, `run()` computed that signal and
   * then ignored it, so the truncated bytes got a new content-addressed
   * storage path, storage_path was repointed at it, and the row was written
   * 'ok' — destroying a working cached copy with garbage.
   */
  it('rejects bytes that start with %PDF but do not actually parse, preserving the existing cached copy as stale (I2)', async () => {
    // A real, structurally valid PDF cut off partway through — the %PDF
    // magic bytes survive (it's just a header), but the xref/trailer needed
    // to actually parse the document does not. This is the shape of a
    // network cut-off download, exactly what the magic-byte-only gate misses.
    const valid = await xfaPdf();
    const garbage = valid.slice(0, 40);
    const existingPath = 'CA/visitor_visa/imm-5257/01-01-2019.pdf';
    const { store, upserts, puts } = fakeStore({
      version_label: '01-01-2019',
      sha256: 'old',
      storage_path: existingPath,
      status: 'ok',
    });
    const h = http({ pdf: garbage });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('stale');
    expect(puts).toHaveLength(0); // never reached putBytes
    expect(last(upserts)).toMatchObject({
      status: 'stale',
      storage_path: existingPath,
      sha256: 'old',
    });
    expect(String(last(upserts).error_message)).toMatch(
      /did not parse as a pdf/i,
    );
  });

  it('records error when a 404 leaves nothing cached', async () => {
    const h = http({ pdfStatus: 404 });
    const { store, upserts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    expect((await svc.refreshOne(FORM)).status).toBe('error');
    expect(last(upserts)).toMatchObject({ status: 'error' });
    expect(String(last(upserts).error_message)).toContain('404');
  });

  it('records error on malformed landing HTML', async () => {
    const h = http({ landing: '<html>no link here</html>' });
    const { store, upserts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('error');
    expect(String(last(upserts).error_message)).toMatch(/discover/i);
  });

  it('records error when no discovery strategy is registered for the portal', async () => {
    const h = http({});
    const { store, upserts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshOne({ ...FORM, portalId: 'no-such-portal' });

    expect(out.status).toBe('error');
    expect(String(last(upserts).error_message)).toMatch(
      /no discovery strategy/i,
    );
  });

  it('never throws — a store failure becomes an error outcome', async () => {
    const h = http({});
    const store = {
      find: () => Promise.reject(new Error('db down')),
    } as unknown as FormTemplateStore;
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    await expect(svc.refreshOne(FORM)).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('persists a best-effort stale status when a downstream step throws after discovery succeeds', async () => {
    // putBytes throws AFTER discovery/robots/download all succeeded. Without
    // IMPORTANT 3's best-effort write in the outer catch, the row would keep
    // advertising its previous status forever while last_checked_at silently
    // stops advancing.
    const pdf = await xfaPdf();
    const existingPath = 'CA/visitor_visa/imm-5257/01-01-2019.pdf';
    const existing = {
      version_label: '01-01-2019',
      sha256: 'old',
      storage_path: existingPath,
      status: 'ok',
    } as FormTemplateRow;
    const upserts: Record<string, unknown>[] = [];
    const store = {
      find: () => Promise.resolve(existing),
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return Promise.resolve();
      },
      putBytes: () => Promise.reject(new Error('storage upload failed')),
    } as unknown as FormTemplateStore;
    const h = http({ pdf });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('error');
    expect(String(out.message)).toContain('storage upload failed');
    // The row itself degrades to 'stale', not 'error' — a working cached copy
    // still exists (existingPath/sha256 'old'), so the invariant applies.
    expect(last(upserts)).toMatchObject({
      status: 'stale',
      storage_path: existingPath,
      sha256: 'old',
    });
    expect(String(last(upserts).error_message)).toContain(
      'storage upload failed',
    );
  });
});

/**
 * Derives a PDF URL whose filename contains the form code embedded in the
 * landing URL itself (…/imm5257.html -> …/imm5257e.pdf), so it satisfies
 * Important 5's formCode-aware discovery regardless of which cataloged form
 * is being resolved — this stays generic across whatever `allCatalogedForms`
 * currently returns rather than hardcoding one form code.
 */
function pdfUrlForLanding(landingUrl: string): string {
  const u = new URL(landingUrl);
  const file = u.pathname.split('/').pop() ?? 'form';
  const base = file.replace(/\.html?$/i, '');
  return `${u.origin}/dam/forms/${base}/01-09-2023/${base}e.pdf`;
}

/**
 * Serves robots.txt (permissive), a synthesized landing page carrying one PDF
 * link per distinct landing URL, and that PDF's bytes — generic across
 * whatever `allCatalogedForms()` currently returns, so these tests do not
 * hardcode the catalog's shape. `pdfBytes` must be a real, pdf-lib-loadable
 * PDF (not just the %PDF magic header) — probeFormCapability calls
 * `pdf.getPageCount()` outside its own try/catch, so a structurally invalid
 * document throws instead of degrading to 'unknown'.
 */
function refreshAllHttp(opts: {
  pdfBytes: Uint8Array;
  failLandingUrl?: string;
}): FetchLike {
  return (url) => {
    if (url.endsWith('/robots.txt')) {
      return Promise.resolve(
        res({ text: () => Promise.resolve('User-agent: *\n') }),
      );
    }
    if (
      url.includes('/dam/forms') ||
      url.includes('/document/download/') ||
      url.includes('/document/forms/')
    ) {
      const bytes = opts.pdfBytes;
      return Promise.resolve(
        res({
          arrayBuffer: () =>
            Promise.resolve(
              bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              ) as ArrayBuffer,
            ),
        }),
      );
    }
    if (opts.failLandingUrl === url) {
      return Promise.resolve(
        res({ text: () => Promise.resolve('<html>no link here</html>') }),
      );
    }
    // Landing pages differ per portal, so serve a link each portal's own
    // discovery strategy will accept. The EU page is matched on the FILENAME
    // ("Visa Application Form.pdf") rather than a form code, because the real
    // page carries five PDFs and the form is not the first one.
    if (url.includes('immi.homeaffairs.gov.au')) {
      // Home Affairs sourceUrl IS the PDF; discovery only confirms the type.
      const bytes = opts.pdfBytes;
      return Promise.resolve(
        res({
          headers: { get: () => 'application/pdf' },
          arrayBuffer: () =>
            Promise.resolve(
              bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              ) as ArrayBuffer,
            ),
        }),
      );
    }
    if (url.includes('uscis.gov')) {
      // USCIS lists the form beside its instructions and supplement; the
      // strategy requires an EXACT filename match, so serve all three.
      const code = url.split('/').pop() ?? 'i-130';
      const base = 'https://www.uscis.gov/sites/default/files/document/forms';
      return Promise.resolve(
        res({
          text: () =>
            Promise.resolve(
              [
                `<a href="${base}/${code}instr.pdf">Instructions</a>`,
                `<a href="${base}/${code}a.pdf">Supplement</a>`,
                `<a href="${base}/${code}.pdf">Form</a>`,
              ].join('\n'),
            ),
        }),
      );
    }
    if (url.includes('home-affairs.ec.europa.eu')) {
      const href =
        'https://home-affairs.ec.europa.eu/document/download/uuid_en' +
        '?filename=Visa%20Application%20Form.pdf';
      return Promise.resolve(
        res({ text: () => Promise.resolve(`<a href="${href}">form</a>`) }),
      );
    }
    const pdfUrl = pdfUrlForLanding(url);
    return Promise.resolve(
      res({ text: () => Promise.resolve(`<a href="${pdfUrl}">form</a>`) }),
    );
  };
}

describe('FormRefreshService.refreshAll', () => {
  it('visits every cataloged form and aggregates the results', async () => {
    const catalog = allCatalogedForms();
    expect(catalog.length).toBeGreaterThan(0);

    const { store } = fakeStore(null);
    const h = refreshAllHttp({ pdfBytes: await xfaPdf() });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshAll();

    expect(out).toHaveLength(catalog.length);
    expect(
      out.map((o) => `${o.countryCode}/${o.program}/${o.formCode}`).sort(),
    ).toEqual(
      catalog.map((f) => `${f.countryCode}/${f.program}/${f.formCode}`).sort(),
    );
    for (const o of out) expect(o.status).toBe('ok');
  });

  it('keeps checking the remaining forms after one fails to abort the batch', async () => {
    const catalog = allCatalogedForms();
    expect(catalog.length).toBeGreaterThan(1);
    const failingLanding = catalog[0].landingUrl as string;
    const failingKeys = new Set(
      catalog
        .filter((f) => f.landingUrl === failingLanding)
        .map((f) => `${f.countryCode}/${f.program}/${f.formCode}`),
    );
    // Sanity: the fixture must actually leave at least one form unaffected,
    // or this test would not be proving anything.
    expect(failingKeys.size).toBeLessThan(catalog.length);

    const { store } = fakeStore(null);
    const h = refreshAllHttp({
      pdfBytes: await xfaPdf(),
      failLandingUrl: failingLanding,
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    );

    const out = await svc.refreshAll();

    expect(out).toHaveLength(catalog.length);
    for (const o of out) {
      const key = `${o.countryCode}/${o.program}/${o.formCode}`;
      expect(o.status).toBe(failingKeys.has(key) ? 'error' : 'ok');
    }
  });

  it('processes forms sequentially — never issues overlapping fetches to the government host', async () => {
    const catalog = allCatalogedForms();
    expect(catalog.length).toBeGreaterThan(0);

    let active = 0;
    let maxActive = 0;
    const base = refreshAllHttp({ pdfBytes: await xfaPdf() });
    const tracking: FetchLike = async (url, init) => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield to the event loop so a hypothetical Promise.all/parallel
      // regression would have room to interleave and get caught here.
      await new Promise((resolve) => setTimeout(resolve, 1));
      const result = await base(url, init);
      active--;
      return result;
    };

    const { store } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(tracking),
      tracking,
      revisionStub,
    );

    const out = await svc.refreshAll();

    expect(out).toHaveLength(catalog.length);
    expect(maxActive).toBe(1);
  });
});

describe('FormRefreshService per-run dedupe', () => {
  it('fetches a shared document ONCE even though many entries require it', async () => {
    // The harmonised Schengen form is required by 29 member states x 2
    // programs. Without dedupe that is 58 identical downloads from the
    // European Commission every night.
    const downloads: string[] = [];
    const pdf = await xfaPdf();
    const inner = refreshAllHttp({ pdfBytes: pdf });
    const counting: FetchLike = (url, init) => {
      if (url.includes('/document/download/') || url.includes('/dam/forms')) {
        downloads.push(url);
      }
      return inner(url, init);
    };

    const { store, puts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(counting),
      counting,
      revisionStub,
    );
    const out = await svc.refreshAll();

    const schengen = out.filter((o) => o.formCode === 'SCHENGEN-C');
    expect(schengen.length).toBeGreaterThan(20);
    for (const o of schengen) expect(o.status).toBe('ok');

    // One download and one upload for the whole Schengen set.
    const euDownloads = downloads.filter((u) => u.includes('europa.eu'));
    expect(euDownloads).toHaveLength(1);
    const euPuts = puts.filter((p) => p.path.includes('schengen-c'));
    expect(euPuts).toHaveLength(1);
  });

  it('still fetches genuinely different documents separately', async () => {
    const downloads: string[] = [];
    const pdf = await xfaPdf();
    const inner = refreshAllHttp({ pdfBytes: pdf });
    const counting: FetchLike = (url, init) => {
      if (url.includes('/document/download/') || url.includes('/dam/forms')) {
        downloads.push(url);
      }
      return inner(url, init);
    };
    const { store } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(counting),
      counting,
      revisionStub,
    );
    await svc.refreshAll();

    // Distinct URLs are each fetched exactly once — dedupe must not collapse
    // different documents into one.
    const unique = new Set(downloads);
    expect(downloads).toHaveLength(unique.size);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('lets a NEW program reuse a document whose other rows are unchanged', async () => {
    // Steady state: every existing row matches, so nothing downloads. A newly
    // added program sharing that document must still reuse its stored object
    // rather than fetching and storing a byte-identical second copy.
    const pdf = await xfaPdf();
    const sha = createHash('sha256').update(pdf).digest('hex');
    const catalog = allCatalogedForms();
    const shared = catalog.find((f) => f.formCode === 'IMM 5257')!;

    const rows = new Map<string, Partial<FormTemplateRow>>();
    for (const f of catalog) {
      if (f.formCode !== 'IMM 5257') continue;
      // Every IMM 5257 row exists and is current EXCEPT one, standing in for
      // the freshly added program.
      if (f.program === 'business_visa') continue;
      rows.set(`${f.countryCode}/${f.program}/${f.formCode}`, {
        sha256: sha,
        version_label: '01-09-2023',
        storage_path: 'CA/visitor_visa/imm-5257/01-09-2023-shared.pdf',
        status: 'ok',
      });
    }

    const upserts: Record<string, unknown>[] = [];
    const puts: { path: string }[] = [];
    const store = {
      find: (k: { countryCode: string; program: string; formCode: string }) =>
        Promise.resolve(
          (rows.get(`${k.countryCode}/${k.program}/${k.formCode}`) ??
            null) as FormTemplateRow | null,
        ),
      upsert: (r: Record<string, unknown>) => {
        upserts.push(r);
        return Promise.resolve();
      },
      putBytes: (path: string) => {
        puts.push({ path });
        return Promise.resolve();
      },
    } as unknown as FormTemplateStore;

    const h = refreshAllHttp({ pdfBytes: pdf });
    await new FormRefreshService(
      store,
      new RobotsGate(h),
      h,
      revisionStub,
    ).refreshAll();

    const businessRow = upserts.find(
      (u) => u.form_code === 'IMM 5257' && u.program === 'business_visa',
    );
    expect(businessRow?.storage_path).toBe(
      'CA/visitor_visa/imm-5257/01-09-2023-shared.pdf',
    );
    expect(puts.filter((p) => p.path.includes('imm-5257'))).toHaveLength(0);
    expect(shared.formCode).toBe('IMM 5257');
  });
});
