import {
  AUTHORITY_RANKS,
  compareAuthority,
  evaluateSource,
  isSameSite,
  normalizeHost,
  registrableDomain,
} from './source-policy';

describe('registrableDomain', () => {
  it('takes the last two labels for an ordinary domain', () => {
    expect(registrableDomain('www.canada.ca')).toBe('canada.ca');
    expect(registrableDomain('ircc.canada.ca')).toBe('canada.ca');
  });

  it('keeps three labels under a two-label public suffix', () => {
    // The bug this exists to prevent: treating gov.uk as the registrable
    // domain, which would make every *.gov.uk site "the same site".
    expect(registrableDomain('www.gov.uk')).toBe('www.gov.uk');
    expect(registrableDomain('homeoffice.gov.uk')).toBe('homeoffice.gov.uk');
    expect(registrableDomain('apply.homeoffice.gov.uk')).toBe(
      'homeoffice.gov.uk',
    );
    expect(registrableDomain('immi.homeaffairs.gov.au')).toBe(
      'homeaffairs.gov.au',
    );
  });

  it('handles a three-label public suffix', () => {
    expect(registrableDomain('www.immigration.gouv.qc.ca')).toBe(
      'immigration.gouv.qc.ca',
    );
  });

  it('normalises case and a trailing dot', () => {
    expect(normalizeHost('WWW.Canada.CA.')).toBe('www.canada.ca');
    expect(registrableDomain('WWW.Canada.CA.')).toBe('canada.ca');
  });
});

describe('isSameSite', () => {
  it('accepts a subdomain of the registered host', () => {
    expect(isSameSite('ircc.canada.ca', 'canada.ca')).toBe(true);
    expect(isSameSite('www.canada.ca', 'canada.ca')).toBe(true);
  });

  it('rejects a lookalike that only ends with the domain name', () => {
    // The attack: canada.ca.evil.test reads as canada.ca to a naive endsWith.
    expect(isSameSite('canada.ca.evil.test', 'canada.ca')).toBe(false);
    expect(isSameSite('notcanada.ca', 'canada.ca')).toBe(false);
    expect(isSameSite('evilcanada.ca', 'canada.ca')).toBe(false);
  });

  it('does not treat two gov.uk departments as the same site', () => {
    expect(isSameSite('evil.gov.uk', 'homeoffice.gov.uk')).toBe(false);
  });
});

describe('evaluateSource', () => {
  const ctx = { registeredHosts: ['www.canada.ca', 'ircc.canada.ca'] };

  it('allows a registered official host', () => {
    const v = evaluateSource(
      'https://www.canada.ca/en/immigration/visit.html',
      ctx,
    );
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.trust).toBe('official');
  });

  it('allows a subdomain of a registered host', () => {
    const v = evaluateSource('https://api.canada.ca/data.json', ctx);
    expect(v.allowed).toBe(true);
  });

  it('rejects an unregistered host even when the content would look official', () => {
    const v = evaluateSource(
      'https://canada-immigration-help.example/visit',
      ctx,
    );
    expect(v.allowed).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(evaluateSource('file:///etc/passwd', ctx).allowed).toBe(false);
    expect(evaluateSource('gopher://canada.ca/', ctx).allowed).toBe(false);
    expect(evaluateSource('javascript:alert(1)', ctx).allowed).toBe(false);
  });

  it('rejects a URL carrying credentials', () => {
    // https://www.canada.ca@evil.test/ resolves to evil.test but reads as canada.ca.
    const v = evaluateSource('https://www.canada.ca:x@evil.test/', ctx);
    expect(v.allowed).toBe(false);
  });

  it('rejects a bare hostname with no dot', () => {
    expect(evaluateSource('http://localhost/admin', ctx).allowed).toBe(false);
    expect(evaluateSource('http://metadata/', ctx).allowed).toBe(false);
  });

  it('rejects an unparseable URL', () => {
    expect(evaluateSource('not a url', ctx).allowed).toBe(false);
  });

  it('only allows a secondary host when one was explicitly approved', () => {
    const withSecondary = { ...ctx, approvedSecondaryHosts: ['vfsglobal.com'] };
    expect(evaluateSource('https://visa.vfsglobal.com/x', ctx).allowed).toBe(
      false,
    );
    const v = evaluateSource('https://visa.vfsglobal.com/x', withSecondary);
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.trust).toBe('secondary');
  });
});

describe('compareAuthority', () => {
  it('ranks the immigration department above a consulate', () => {
    expect(AUTHORITY_RANKS.immigration_department).toBeLessThan(
      AUTHORITY_RANKS.mission,
    );
    const result = compareAuthority(
      { authorityRank: AUTHORITY_RANKS.immigration_department },
      { authorityRank: AUTHORITY_RANKS.mission },
    );
    expect(result).toBeLessThan(0);
  });

  it('prefers the more recently CHANGED source at equal rank', () => {
    const older = { authorityRank: 1, lastChangedAt: '2026-01-01T00:00:00Z' };
    const newer = { authorityRank: 1, lastChangedAt: '2026-06-01T00:00:00Z' };
    expect(compareAuthority(newer, older)).toBeLessThan(0);
  });

  it('returns 0 when neither can be preferred, so the caller reports a conflict', () => {
    expect(compareAuthority({ authorityRank: 1 }, { authorityRank: 1 })).toBe(
      0,
    );
  });
});
