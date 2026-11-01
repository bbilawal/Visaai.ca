import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdfLink, canadaIrccDiscovery } from './canada-ircc.discovery';
import {
  registerDiscoveryStrategy,
  resolveDiscoveryStrategy,
} from './discovery.registry';
import type { FetchLike, HttpResponse } from '../http';

const LANDING =
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html';

const HTML = readFileSync(
  join(__dirname, '../../../../test/fixtures/forms/imm5257-landing.html'),
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

describe('extractPdfLink', () => {
  it('resolves the relative href against the landing URL', () => {
    expect(extractPdfLink(HTML, LANDING)?.pdfUrl).toBe(
      'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
    );
  });

  it('reads the version label from the dated path segment', () => {
    expect(extractPdfLink(HTML, LANDING)?.versionLabel).toBe('01-09-2023');
  });

  it('returns null when the page has no PDF link', () => {
    expect(
      extractPdfLink('<html><body>No form here.</body></html>', LANDING),
    ).toBeNull();
  });

  it('returns null on truncated markup rather than throwing', () => {
    expect(extractPdfLink('<a href="/x/y', LANDING)).toBeNull();
  });

  it('keeps an absolute href as-is', () => {
    const html = '<a href="https://cdn.example.gov/f/2024-01/a.pdf">form</a>';
    expect(extractPdfLink(html, LANDING)?.pdfUrl).toBe(
      'https://cdn.example.gov/f/2024-01/a.pdf',
    );
  });

  it('leaves versionLabel null when no path segment looks like a date', () => {
    const html = '<a href="/forms/a.pdf">form</a>';
    expect(extractPdfLink(html, LANDING)?.versionLabel).toBeNull();
  });

  it('takes the first PDF link when a page lists several', () => {
    const html = [
      '<a href="/forms/imm5257/01-09-2023/imm5257e.pdf">English</a>',
      '<a href="/trousses/imm5257/01-09-2023/imm5257f.pdf">French</a>',
    ].join('\n');
    expect(extractPdfLink(html, LANDING)?.pdfUrl).toContain('imm5257e.pdf');
  });

  /**
   * Whole-branch review, Finding I5 (IMPORTANT): pre-fix, `extractPdfLink`
   * always took the FIRST `.pdf` href with no way to check it belonged to
   * the requested form. Both live IRCC pages currently have exactly one PDF
   * href, so this was latent — but a page with an unrelated PDF link above
   * the actual form (a nav/brochure link) would cache the wrong document as
   * 'ok' and hand it to an applicant. When a formCode is supplied, the
   * chosen href must contain it (normalized: lowercase, spaces stripped).
   */
  describe('with a formCode', () => {
    it('skips a nav/brochure PDF link that appears before the form PDF', () => {
      const html = [
        '<a href="/site/nav/accessibility-brochure.pdf">Accessibility</a>',
        '<a href="/forms/imm5257/01-09-2023/imm5257e.pdf">form</a>',
      ].join('\n');
      const found = extractPdfLink(html, LANDING, 'IMM 5257');
      expect(found?.pdfUrl).toContain('imm5257e.pdf');
    });

    it('returns null rather than guessing when no href matches the form code', () => {
      const html =
        '<a href="/site/nav/accessibility-brochure.pdf">Accessibility</a>';
      expect(extractPdfLink(html, LANDING, 'IMM 5257')).toBeNull();
    });

    it('matches case- and space-insensitively against the normalized form code', () => {
      const html = '<a href="/forms/IMM5257/01-09-2023/IMM5257E.pdf">form</a>';
      expect(extractPdfLink(html, LANDING, 'imm 5257')?.pdfUrl).toContain(
        'IMM5257E.pdf',
      );
    });

    it('still selects correctly on the real fixture, matched against its own form code', () => {
      expect(extractPdfLink(HTML, LANDING, 'IMM 5257')?.pdfUrl).toBe(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      );
    });
  });
});

describe('canadaIrccDiscovery', () => {
  it('sends the VisaAI User-Agent and returns the discovered form', async () => {
    let seen: Record<string, string> | undefined;
    const http: FetchLike = (_url, init) => {
      seen = init?.headers;
      return Promise.resolve(res(HTML));
    };
    const found = await canadaIrccDiscovery.discover(LANDING, http);
    expect(found?.versionLabel).toBe('01-09-2023');
    expect(seen?.['user-agent']).toContain('VisaAI-FormFetcher');
  });

  it('returns null on a non-OK landing page', async () => {
    const http: FetchLike = () =>
      Promise.resolve(res('', { ok: false, status: 404 }));
    await expect(
      canadaIrccDiscovery.discover(LANDING, http),
    ).resolves.toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const http: FetchLike = () => Promise.reject(new Error('ETIMEDOUT'));
    await expect(
      canadaIrccDiscovery.discover(LANDING, http),
    ).resolves.toBeNull();
  });
});

describe('discovery registry', () => {
  it('resolves the built-in ircc strategy', () => {
    expect(resolveDiscoveryStrategy('ircc')).toBe(canadaIrccDiscovery);
  });

  it('returns undefined for an unregistered portal', () => {
    expect(resolveDiscoveryStrategy('nope')).toBeUndefined();
  });

  it('accepts a newly registered strategy', () => {
    const stub = {
      portalId: 'test-portal',
      discover: () => Promise.resolve(null),
    };
    registerDiscoveryStrategy(stub);
    expect(resolveDiscoveryStrategy('test-portal')).toBe(stub);
  });
});
