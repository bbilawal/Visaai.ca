import '../../strategies'; // registers the built-in country strategies
import {
  documentTemplatesForApplication,
  documentTemplatesForCountry,
  allCatalogedDocumentTemplates,
} from './doc-template.catalog';
import { SCHENGEN_MEMBER_CODES } from '../../strategies/country/schengen-members';

describe('documentTemplatesForApplication', () => {
  it('maps the public visa code to a program and returns its artifacts', () => {
    const out = documentTemplatesForApplication('CA', 'TRV');
    const codes = out.map((t) => t.templateCode);
    expect(codes).toContain('IMM 5484'); // the visitor-visa document checklist
    expect(codes).toContain('IMM 5476'); // country-wide, via the wildcard
  });

  it('gives the study-permit checklist, not the visitor one, for a study permit', () => {
    const codes = documentTemplatesForApplication('CA', 'Study Permit').map(
      (t) => t.templateCode,
    );
    expect(codes).toContain('IMM 5483');
    expect(codes).not.toContain('IMM 5484');
  });

  it('resolves a country code case-insensitively and normalises it upward', () => {
    const out = documentTemplatesForApplication('ca', 'TRV');
    expect(out.length).toBeGreaterThan(0);
    // The delivery path filters `country_code` with a Postgres .eq(), which is
    // case-SENSITIVE — a lowercase code leaking into the key would miss every
    // cached row and silently degrade every artifact to a link.
    expect(out.every((t) => t.countryCode === 'CA')).toBe(true);
  });

  it('returns nothing rather than guessing for an unmapped visa type', () => {
    expect(documentTemplatesForApplication('CA', 'Nansen Passport')).toEqual(
      [],
    );
  });

  it('returns nothing for a country we do not support', () => {
    expect(documentTemplatesForApplication('ZZ', 'TRV')).toEqual([]);
  });
});

describe('documentTemplatesForCountry', () => {
  // Intake-created applications carry destination_country but no framework, so
  // the program is unknown. The union is the safe error: an extra checklist
  // costs one ignored download, a missing one costs a refusal.
  it('unions every program and dedupes by template code', () => {
    const out = documentTemplatesForCountry('CA');
    const codes = out.map((t) => t.templateCode);
    expect(codes).toEqual([...new Set(codes)]);
    expect(codes).toEqual(
      expect.arrayContaining(['IMM 5484', 'IMM 5483', 'IMM 5488', 'IMM 5476']),
    );
  });

  it('gives every Schengen member the area-wide photograph specification', () => {
    for (const code of SCHENGEN_MEMBER_CODES) {
      const photo = documentTemplatesForCountry(code).find(
        (t) => t.templateCode === 'ICAO-PHOTO',
      );
      expect(photo).toBeDefined();
      expect(photo!.documentCode).toBe('photo');
    }
  });
});

describe('allCatalogedDocumentTemplates', () => {
  const all = allCatalogedDocumentTemplates();

  it('excludes link-only artifacts from the fetch worklist', () => {
    // IMM 5476's PDF path is disallowed by canada.ca/robots.txt, and the US
    // B-1/B-2 document guidance is a web page. Re-attempting either nightly
    // would only manufacture failures.
    expect(all.some((t) => t.templateCode === 'IMM 5476')).toBe(false);
    expect(all.some((t) => t.resolve === 'link')).toBe(false);
  });

  it('carries the portal id and a source url on every entry', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) {
      expect(t.portalId).toBeTruthy();
      expect(t.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('only ever sources from a government or EU institutional domain', () => {
    // A fabricated or third-party URL is worse than no entry at all: the
    // applicant would gather evidence against it.
    const allowed =
      /(^|\.)(canada\.ca|uscis\.gov|state\.gov|gov\.uk|homeaffairs\.gov\.au|ec\.europa\.eu)$/;
    for (const t of all) {
      expect(new URL(t.sourceUrl).hostname).toMatch(allowed);
    }
  });
});
