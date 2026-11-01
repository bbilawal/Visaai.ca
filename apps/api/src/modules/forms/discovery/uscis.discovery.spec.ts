import { extractUscisFormLink, uscisDiscovery } from './uscis.discovery';
import { extractPdfLink } from './canada-ircc.discovery';
import { resolveDiscoveryStrategy } from './discovery.registry';
import type { FetchLike, HttpResponse } from '../http';

const LANDING = 'https://www.uscis.gov/i-130';

/** The live page's link set (2026-08-12), in document order. */
const PAGE = [
  '<a href="/sites/default/files/document/fact-sheets/Fact_Sheet_Adoption.pdf">Fact sheet</a>',
  '<a href="/sites/default/files/document/forms/i-130.pdf">Form I-130</a>',
  '<a href="/sites/default/files/document/forms/i-130a.pdf">Form I-130A</a>',
  '<a href="/sites/default/files/document/forms/i-130instr.pdf">Instructions</a>',
].join('\n');

/** The same links with the form listed last — a plausible page edit. */
const REORDERED = [
  '<a href="/sites/default/files/document/forms/i-130instr.pdf">Instructions</a>',
  '<a href="/sites/default/files/document/forms/i-130a.pdf">Form I-130A</a>',
  '<a href="/sites/default/files/document/forms/i-130.pdf">Form I-130</a>',
].join('\n');

function res(body: string, over: Partial<HttpResponse> = {}): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    ...over,
  };
}

const file = (r: { pdfUrl: string } | null) => r?.pdfUrl.split('/').pop();

describe('extractUscisFormLink', () => {
  it('picks the form, not the fact sheet that precedes it', () => {
    expect(file(extractUscisFormLink(PAGE, LANDING, 'I-130'))).toBe(
      'i-130.pdf',
    );
  });

  it('does not mistake the supplement or the instructions for the form', () => {
    const picked = file(extractUscisFormLink(PAGE, LANDING, 'I-130'));
    expect(picked).not.toBe('i-130a.pdf');
    expect(picked).not.toBe('i-130instr.pdf');
  });

  it('stays correct when the form is listed LAST', () => {
    expect(file(extractUscisFormLink(REORDERED, LANDING, 'I-130'))).toBe(
      'i-130.pdf',
    );
  });

  /**
   * The reason this strategy exists. The IRCC rule is a substring test, so its
   * correctness depends on link order — reorder the page and it serves the
   * instructions booklet as the application form.
   */
  it('DEMONSTRATES the substring rule is order-dependent and unsafe here', () => {
    expect(file(extractPdfLink(REORDERED, LANDING, 'I-130'))).toBe(
      'i-130instr.pdf',
    );
  });

  it('returns null rather than guessing when the form is absent', () => {
    expect(extractUscisFormLink(PAGE, LANDING, 'I-999')).toBeNull();
  });

  it('normalises a spaced form code', () => {
    expect(file(extractUscisFormLink(PAGE, LANDING, 'I 130'))).toBe(
      'i-130.pdf',
    );
  });

  it('reports no version label — USCIS versions by edition date inside the PDF', () => {
    expect(
      extractUscisFormLink(PAGE, LANDING, 'I-130')?.versionLabel,
    ).toBeNull();
  });
});

describe('uscisDiscovery', () => {
  it('is registered for the US portal', () => {
    expect(resolveDiscoveryStrategy('us-ceac-ds160')).toBe(uscisDiscovery);
  });

  it('sends the VisaAI User-Agent and returns the form', async () => {
    let seen: Record<string, string> | undefined;
    const http: FetchLike = (_url, init) => {
      seen = init?.headers;
      return Promise.resolve(res(PAGE));
    };
    const found = await uscisDiscovery.discover(LANDING, http, 'I-130');
    expect(file(found)).toBe('i-130.pdf');
    expect(seen?.['user-agent']).toContain('VisaAI-FormFetcher');
  });

  it('returns null on a non-OK page and on a thrown fetch', async () => {
    const bad: FetchLike = () =>
      Promise.resolve(res('', { ok: false, status: 500 }));
    const boom: FetchLike = () => Promise.reject(new Error('ETIMEDOUT'));
    await expect(
      uscisDiscovery.discover(LANDING, bad, 'I-130'),
    ).resolves.toBeNull();
    await expect(
      uscisDiscovery.discover(LANDING, boom, 'I-130'),
    ).resolves.toBeNull();
  });
});
