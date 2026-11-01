import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractEuFormLink,
  euHomeAffairsDiscovery,
} from './eu-home-affairs.discovery';
import { extractPdfLink } from './canada-ircc.discovery';
import { resolveDiscoveryStrategy } from './discovery.registry';
import type { FetchLike, HttpResponse } from '../http';

const LANDING =
  'https://home-affairs.ec.europa.eu/policies/schengen/visa-policy/applying-schengen-visa_en';

const HTML = readFileSync(
  join(__dirname, '../../../../test/fixtures/forms/eu-schengen-landing.html'),
  'utf8',
);

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

describe('extractEuFormLink', () => {
  it('picks the application form, not the annex that precedes it', () => {
    const found = extractEuFormLink(HTML, LANDING);
    expect(found?.pdfUrl).toContain('Visa%20Application%20Form.pdf');
    expect(found?.pdfUrl).not.toContain('annex_7a');
    expect(found?.pdfUrl).not.toContain('icao');
  });

  it('resolves the href to an absolute URL', () => {
    expect(extractEuFormLink(HTML, LANDING)?.pdfUrl).toMatch(
      /^https:\/\/home-affairs\.ec\.europa\.eu\/document\/download\//,
    );
  });

  it('reports no version label — the Commission versions by UUID, not by date', () => {
    expect(extractEuFormLink(HTML, LANDING)?.versionLabel).toBeNull();
  });

  it('returns null when the page has no application-form link', () => {
    const html = '<a href="/document/download/x_en?filename=FAQs.pdf">FAQ</a>';
    expect(extractEuFormLink(html, LANDING)).toBeNull();
  });

  /**
   * The reason this strategy exists. If this ever passes, the IRCC strategy
   * has become safe for this portal and this file could be retired — but
   * today it proves first-match would cache the wrong document.
   */
  it('DEMONSTRATES why first-match is unsafe here', () => {
    const firstMatch = extractPdfLink(HTML, LANDING);
    expect(firstMatch?.pdfUrl).toContain('annex_7a');
    expect(firstMatch?.pdfUrl).not.toContain('Visa%20Application%20Form');
  });
});

describe('euHomeAffairsDiscovery', () => {
  it('is registered for the schengen-consulate portal', () => {
    expect(resolveDiscoveryStrategy('schengen-consulate')).toBe(
      euHomeAffairsDiscovery,
    );
  });

  it('sends the VisaAI User-Agent and returns the form', async () => {
    let seen: Record<string, string> | undefined;
    const http: FetchLike = (_url, init) => {
      seen = init?.headers;
      return Promise.resolve(res(HTML));
    };
    const found = await euHomeAffairsDiscovery.discover(LANDING, http);
    expect(found?.pdfUrl).toContain('Visa%20Application%20Form.pdf');
    expect(seen?.['user-agent']).toContain('VisaAI-FormFetcher');
  });

  it('returns null on a non-OK landing page', async () => {
    const http: FetchLike = () =>
      Promise.resolve(res('', { ok: false, status: 503 }));
    await expect(
      euHomeAffairsDiscovery.discover(LANDING, http),
    ).resolves.toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const http: FetchLike = () => Promise.reject(new Error('ETIMEDOUT'));
    await expect(
      euHomeAffairsDiscovery.discover(LANDING, http),
    ).resolves.toBeNull();
  });
});
