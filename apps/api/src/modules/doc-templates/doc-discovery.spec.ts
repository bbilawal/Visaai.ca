import {
  extractDocumentLink,
  filenameOf,
  filenameHint,
  isDirectPdfUrl,
  discoverDocument,
} from './doc-discovery';
import type { FetchLike, HttpResponse } from '../forms/http';

function html(hrefs: string[]): string {
  return hrefs.map((h) => `<a href="${h}">link</a>`).join('\n');
}

function res(init: Partial<HttpResponse> & { body?: string }): HttpResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => init.headers?.get('content-type') ?? null },
    text: () => Promise.resolve(init.body ?? ''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

describe('filenameOf', () => {
  it('reads the filename from a normal path', () => {
    expect(filenameOf('/kits/forms/imm5484/01-05-2026/imm5484e.pdf')).toBe(
      'imm5484e.pdf',
    );
  });

  // The European Commission's links carry the name ONLY in the query string;
  // the path is a UUID. Reading the path alone would match nothing at all.
  it('reads the filename from a ?filename= query, percent-decoded', () => {
    expect(
      filenameOf(
        '/document/download/abc_en?filename=Visa%20Application%20Form.pdf',
      ),
    ).toBe('visa application form.pdf');
  });
});

describe('filenameHint', () => {
  it('normalises a template code the way authorities name files', () => {
    expect(filenameHint('IMM 5484')).toBe('imm5484');
    expect(filenameHint('I-130INSTR')).toBe('i-130instr');
  });
});

describe('isDirectPdfUrl', () => {
  it('recognises a PDF url and rejects a landing page', () => {
    expect(isDirectPdfUrl('https://immi.homeaffairs.gov.au/x/80.pdf')).toBe(
      true,
    );
    expect(isDirectPdfUrl('https://www.canada.ca/x/imm5484.html')).toBe(false);
    expect(isDirectPdfUrl('not a url')).toBe(false);
  });
});

describe('extractDocumentLink', () => {
  const landing = 'https://www.canada.ca/en/x/imm5484.html';

  it('matches an IRCC checklist by the code embedded in the filename', () => {
    const found = extractDocumentLink(
      html([
        '/content/dam/ircc/nav/brochure.pdf',
        '/content/dam/ircc/documents/pdf/english/kits/forms/imm5484/01-05-2026/imm5484e.pdf',
      ]),
      landing,
      { templateCode: 'IMM 5484' },
    );
    expect(found?.pdfUrl).toContain('imm5484e.pdf');
    // The dated path segment is the revision marker IRCC actually publishes.
    expect(found?.versionLabel).toBe('01-05-2026');
  });

  // The whole reason `exact` exists: USCIS lists the form, its supplement and
  // its instructions side by side, all containing the form number. A substring
  // rule returns whichever happens to come first in the page's link order.
  it('requires an exact filename when the page lists near-identical names', () => {
    const page = html([
      '/forms/i-130.pdf',
      '/forms/i-130a.pdf',
      '/forms/i-130instr.pdf',
    ]);
    const instr = extractDocumentLink(page, 'https://www.uscis.gov/i-130', {
      templateCode: 'I-130INSTR',
      match: { filename: 'i-130instr.pdf', exact: true },
    });
    expect(instr?.pdfUrl).toContain('i-130instr.pdf');

    const supplement = extractDocumentLink(
      page,
      'https://www.uscis.gov/i-130',
      {
        templateCode: 'I-130A',
        match: { filename: 'i-130a.pdf', exact: true },
      },
    );
    expect(supplement?.pdfUrl).toContain('i-130a.pdf');
  });

  it('picks the photograph guidelines off a page of five PDFs', () => {
    const found = extractDocumentLink(
      html([
        '/document/download/a_en?filename=annex_7a_atv_common_list_en.pdf',
        '/document/download/b_en?filename=Visa%20Application%20Form.pdf',
        '/document/download/c_en?filename=icao_photograph_guidelines_en.pdf',
      ]),
      'https://home-affairs.ec.europa.eu/x_en',
      {
        templateCode: 'ICAO-PHOTO',
        match: { filename: 'icao_photograph_guidelines' },
      },
    );
    expect(found?.pdfUrl).toContain('icao_photograph_guidelines_en.pdf');
    expect(found?.versionLabel).toBeNull();
  });

  // Fail closed. Returning "the first PDF on the page" is how an applicant
  // ends up holding a policy annex labelled as their document checklist.
  it('returns null rather than guessing when nothing matches', () => {
    expect(
      extractDocumentLink(html(['/x/unrelated.pdf']), landing, {
        templateCode: 'IMM 5484',
      }),
    ).toBeNull();
    expect(
      extractDocumentLink('<p>no links here</p>', landing, {
        templateCode: 'IMM 5484',
      }),
    ).toBeNull();
  });
});

describe('discoverDocument', () => {
  it('confirms a direct PDF url without parsing a landing page', async () => {
    const http: FetchLike = () =>
      Promise.resolve(res({ headers: { get: () => 'application/pdf' } }));
    const found = await discoverDocument(
      {
        templateCode: '80',
        sourceUrl: 'https://immi.homeaffairs.gov.au/x/80.pdf',
      },
      http,
    );
    expect(found).toEqual({
      pdfUrl: 'https://immi.homeaffairs.gov.au/x/80.pdf',
      versionLabel: null,
    });
  });

  // A 200 that is not a PDF is the exact shape of a portal's HTML error page.
  it('rejects a direct url that answers with HTML', async () => {
    const http: FetchLike = () =>
      Promise.resolve(res({ headers: { get: () => 'text/html' } }));
    expect(
      await discoverDocument(
        {
          templateCode: '80',
          sourceUrl: 'https://immi.homeaffairs.gov.au/x/80.pdf',
        },
        http,
      ),
    ).toBeNull();
  });

  it('degrades to null when the landing page cannot be fetched', async () => {
    const http: FetchLike = () =>
      Promise.resolve(res({ ok: false, status: 503 }));
    expect(
      await discoverDocument(
        {
          templateCode: 'IMM 5484',
          sourceUrl: 'https://www.canada.ca/x/imm5484.html',
        },
        http,
      ),
    ).toBeNull();
  });

  it('degrades to null when the fetch throws', async () => {
    const http: FetchLike = () => Promise.reject(new Error('ECONNRESET'));
    expect(
      await discoverDocument(
        {
          templateCode: 'IMM 5484',
          sourceUrl: 'https://www.canada.ca/x/imm5484.html',
        },
        http,
      ),
    ).toBeNull();
  });
});
