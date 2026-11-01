import { discoverDocument, newDiscoveryCache } from './doc-discovery';
import type { FetchLike, HttpResponse } from '../forms/http';

/**
 * Regression guard for a PRODUCTION INCIDENT (2026-08-13).
 *
 * The download dedupe is keyed by the resolved PDF url, which discovery has to
 * run to produce — so the landing page was fetched once per catalog entry even
 * though 58 Schengen entries name the same European Commission page. The EC
 * answered HTTP 429 and every photograph-specification row failed on the first
 * production run.
 */

function res(body: string, ok = true, contentType = 'text/html'): HttpResponse {
  return {
    ok,
    status: ok ? 200 : 429,
    headers: { get: () => contentType },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

const EU_PAGE = 'https://home-affairs.ec.europa.eu/applying-schengen-visa_en';
const EU_HTML = `
  <a href="/document/download/a_en?filename=Visa%20Application%20Form.pdf">form</a>
  <a href="/document/download/b_en?filename=icao_photograph_guidelines_en.pdf">photo</a>`;

const ICAO = {
  templateCode: 'ICAO-PHOTO',
  sourceUrl: EU_PAGE,
  match: { filename: 'icao_photograph_guidelines' },
};

describe('discovery cache', () => {
  it('fetches one shared landing page ONCE for 58 entries', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(res(EU_HTML));
    };
    const cache = newDiscoveryCache();

    // 29 member states x 2 programs — the real Schengen worklist shape.
    for (let i = 0; i < 58; i++) {
      const found = await discoverDocument(ICAO, http, cache);
      expect(found?.pdfUrl).toContain('icao_photograph_guidelines_en.pdf');
    }

    expect(calls).toBe(1);
  });

  // The reason the memo is the PAGE and not the resolution: a USCIS landing
  // page serves four different specs. Memoising "what this url resolved to"
  // would hand I-130A the instructions booklet — a silent wrong-document
  // delivery, strictly worse than the 429 it was fixing.
  it('still resolves each spec separately from one shared page', async () => {
    let calls = 0;
    const html = `
      <a href="/forms/i-130.pdf">form</a>
      <a href="/forms/i-130a.pdf">supplement</a>
      <a href="/forms/i-130instr.pdf">instructions</a>`;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(res(html));
    };
    const cache = newDiscoveryCache();
    const page = 'https://www.uscis.gov/i-130';

    const a = await discoverDocument(
      {
        templateCode: 'I-130A',
        sourceUrl: page,
        match: { filename: 'i-130a.pdf', exact: true },
      },
      http,
      cache,
    );
    const instr = await discoverDocument(
      {
        templateCode: 'I-130INSTR',
        sourceUrl: page,
        match: { filename: 'i-130instr.pdf', exact: true },
      },
      http,
      cache,
    );

    expect(a?.pdfUrl).toContain('i-130a.pdf');
    expect(instr?.pdfUrl).toContain('i-130instr.pdf');
    expect(calls).toBe(1);
  });

  // Once a host has rate-limited us, retrying it 57 more times in the same loop
  // is precisely the behaviour that caused the incident.
  it('does not retry a host that just failed', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(res('', false));
    };
    const cache = newDiscoveryCache();

    for (let i = 0; i < 10; i++) {
      expect(await discoverDocument(ICAO, http, cache)).toBeNull();
    }
    expect(calls).toBe(1);
  });

  it('confirms a direct PDF url once', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(res('', true, 'application/pdf'));
    };
    const cache = newDiscoveryCache();
    const spec = {
      templateCode: '80',
      sourceUrl: 'https://immi.homeaffairs.gov.au/form-listing/forms/80.pdf',
    };

    await discoverDocument(spec, http, cache);
    await discoverDocument(spec, http, cache);

    expect(calls).toBe(1);
  });

  // Without a cache the behaviour must be exactly what it was before, so an
  // ad-hoc caller (or a test) still gets a live fetch every time.
  it('fetches every time when no cache is supplied', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(res(EU_HTML));
    };

    await discoverDocument(ICAO, http);
    await discoverDocument(ICAO, http);

    expect(calls).toBe(2);
  });
});
