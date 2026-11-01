import {
  auHomeAffairsDiscovery,
  isDirectPdfUrl,
} from './au-home-affairs.discovery';
import { resolveDiscoveryStrategy } from './discovery.registry';
import { IDENTIFIED_NO_URL_HEADERS } from '../http';
import type { FetchLike, HttpResponse } from '../http';

const FORM_URL = 'https://immi.homeaffairs.gov.au/form-listing/forms/1415.pdf';

function res(over: Partial<HttpResponse> = {}): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/pdf' },
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    ...over,
  };
}

describe('isDirectPdfUrl', () => {
  it('accepts a .pdf path and rejects a landing page', () => {
    expect(isDirectPdfUrl(FORM_URL)).toBe(true);
    expect(isDirectPdfUrl('https://immi.homeaffairs.gov.au/visas/600')).toBe(
      false,
    );
  });

  it('ignores a query string when judging the extension', () => {
    expect(isDirectPdfUrl(`${FORM_URL}?v=2`)).toBe(true);
  });

  it('returns false for a malformed URL instead of throwing', () => {
    expect(isDirectPdfUrl('not a url')).toBe(false);
  });
});

describe('auHomeAffairsDiscovery', () => {
  it('is registered for the Australian portal', () => {
    expect(resolveDiscoveryStrategy('au-immiaccount')).toBe(
      auHomeAffairsDiscovery,
    );
  });

  it('returns the sourceUrl itself once confirmed to be a PDF', async () => {
    const http: FetchLike = () => Promise.resolve(res());
    const found = await auHomeAffairsDiscovery.discover(FORM_URL, http);
    expect(found?.pdfUrl).toBe(FORM_URL);
    // Home Affairs URLs carry no dated segment; sha256 detects a re-issue.
    expect(found?.versionLabel).toBeNull();
  });

  it('refuses a non-PDF sourceUrl rather than guessing', async () => {
    let called = false;
    const http: FetchLike = () => {
      called = true;
      return Promise.resolve(res());
    };
    await expect(
      auHomeAffairsDiscovery.discover(
        'https://immi.homeaffairs.gov.au/visas/600',
        http,
      ),
    ).resolves.toBeNull();
    // Rejected before any request is made.
    expect(called).toBe(false);
  });

  it('returns null when the URL serves HTML rather than a PDF', async () => {
    // An expired form number typically redirects to a landing page; caching
    // that HTML as the applicant's form is the failure this guards.
    const http: FetchLike = () =>
      Promise.resolve(res({ headers: { get: () => 'text/html' } }));
    await expect(
      auHomeAffairsDiscovery.discover(FORM_URL, http),
    ).resolves.toBeNull();
  });

  it('returns null on a non-OK response and on a thrown fetch', async () => {
    const gone: FetchLike = () =>
      Promise.resolve(res({ ok: false, status: 401 }));
    const boom: FetchLike = () => Promise.reject(new Error('ECONNRESET'));
    await expect(
      auHomeAffairsDiscovery.discover(FORM_URL, gone),
    ).resolves.toBeNull();
    await expect(
      auHomeAffairsDiscovery.discover(FORM_URL, boom),
    ).resolves.toBeNull();
  });
});

describe('identity used for Home Affairs', () => {
  it('still names VisaAI and still carries a contact address', () => {
    // The workaround is the SHAPE of the string, not anonymity: their filter
    // 403s any "(+url)" user-agent. We must never look like a browser.
    expect(IDENTIFIED_NO_URL_HEADERS['user-agent']).toBe('VisaAI/1.0');
    expect(IDENTIFIED_NO_URL_HEADERS['from']).toContain('@visaai.co');
    expect(IDENTIFIED_NO_URL_HEADERS['user-agent']).not.toMatch(
      /mozilla|chrome|safari|webkit/i,
    );
  });
});
