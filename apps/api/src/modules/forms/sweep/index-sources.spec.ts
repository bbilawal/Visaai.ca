import {
  irccIndex,
  uscisIndex,
  fetchIndex,
  AUTHORITY_INDEXES,
} from './index-sources';
import type { FetchLike, HttpResponse } from '../http';

function res(body: string, ok = true, status = 200): HttpResponse {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

describe('irccIndex.parse', () => {
  // Shape measured on the live index 2026-08-13.
  const html = `
    <a href="/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html" target="_blank">Document Checklist: Temporary Resident Visa (Visitor Visa) outside of Canada</a>
    <a href="/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm0008.html">Generic Application Form for Canada</a>
    <a href="/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html">duplicate link, later in the page</a>
    <a href="/en/immigration-refugees-citizenship/services/some-other-page.html">Not a form</a>`;

  it('normalises the code back to catalog spelling', () => {
    const entries = irccIndex.parse(html, irccIndex.indexUrl);
    const codes = entries.map((e) => e.code);
    // 'imm5484' in the URL must become 'IMM 5484' — without this the diff
    // compares different spellings and every form looks new, forever.
    expect(codes).toContain('IMM 5484');
    expect(codes).toContain('IMM 0008');
  });

  it('keeps the first occurrence of a code and its real title', () => {
    const entries = irccIndex.parse(html, irccIndex.indexUrl);
    const found = entries.filter((e) => e.code === 'IMM 5484');
    expect(found).toHaveLength(1);
    expect(found[0].title).toContain('Document Checklist');
    expect(found[0].url).toContain('imm5484.html');
  });

  it('ignores links that are not form pages', () => {
    const entries = irccIndex.parse(html, irccIndex.indexUrl);
    expect(entries.every((e) => /imm\d/i.test(e.url))).toBe(true);
  });
});

describe('uscisIndex.parse', () => {
  // USCIS links the same form from several anchors; only one carries the name.
  const html = `
    <a href="/i-130" class="nav__submenu-item-link"></a>
    <a href="/i-130" class="link link--form-title">I-130 | Petition for Alien Relative</a>
    <a href="/i-130" class="btn" aria-label="Form Details">Form Details</a>
    <a href="/n-400" class="link link--form-title">N-400 | Application for Naturalization</a>`;

  it('keeps the richest anchor text for a code', () => {
    const entries = uscisIndex.parse(html, uscisIndex.indexUrl);
    const i130 = entries.find((e) => e.code === 'I-130');
    expect(i130?.title).toBe('I-130 | Petition for Alien Relative');
    expect(entries.filter((e) => e.code === 'I-130')).toHaveLength(1);
  });

  it('upper-cases the code to match catalog spelling', () => {
    const codes = uscisIndex
      .parse(html, uscisIndex.indexUrl)
      .map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['I-130', 'N-400']));
  });
});

describe('fetchIndex', () => {
  it('returns [] rather than throwing on a non-200', async () => {
    const http: FetchLike = () => Promise.resolve(res('', false, 503));
    expect(await fetchIndex(irccIndex, http)).toEqual([]);
  });

  it('returns [] rather than throwing when the fetch explodes', async () => {
    const http: FetchLike = () => Promise.reject(new Error('ECONNRESET'));
    expect(await fetchIndex(uscisIndex, http)).toEqual([]);
  });
});

describe('AUTHORITY_INDEXES', () => {
  it('only crawls government hosts', () => {
    for (const index of AUTHORITY_INDEXES) {
      expect(new URL(index.indexUrl).hostname).toMatch(
        /(^|\.)(canada\.ca|uscis\.gov)$/,
      );
    }
  });
});
