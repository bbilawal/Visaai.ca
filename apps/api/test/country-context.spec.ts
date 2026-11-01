import {
  resolveCountryName,
  detectFormFamily,
  destinationFormFamily,
  isForeignForm,
} from '../src/strategies/country-context';

describe('resolveCountryName', () => {
  it('maps registered Schengen-member codes to their proper name', () => {
    expect(resolveCountryName('FI')).toBe('Finland');
    expect(resolveCountryName('fi')).toBe('Finland'); // case-insensitive
    expect(resolveCountryName('DE')).toBe('Germany');
  });
  it('uses nicer article display forms for the big destinations', () => {
    expect(resolveCountryName('US')).toBe('the United States');
    expect(resolveCountryName('GB')).toBe('the United Kingdom');
  });
  it('resolves the legacy Schengen bloc', () => {
    expect(resolveCountryName('SCHENGEN')).toBe('Schengen Area');
  });
  it('falls back safely', () => {
    expect(resolveCountryName(null)).toBe('the destination country');
    expect(resolveCountryName('XX')).toBe('XX'); // unknown -> raw code, never a wrong country
  });
});

describe('detectFormFamily — recognise a form code by its country signature', () => {
  it('Canada IMM forms', () => {
    expect(detectFormFamily('IMM 5257')).toBe('CA');
    expect(detectFormFamily('imm1294')).toBe('CA');
  });
  it('USA DS/I/G forms', () => {
    expect(detectFormFamily('DS-160')).toBe('US');
    expect(detectFormFamily('I-130')).toBe('US');
    expect(detectFormFamily('G-1145')).toBe('US');
  });
  it('UK VAF / Appendix', () => {
    expect(detectFormFamily('VAF1A')).toBe('GB');
    expect(detectFormFamily('Appendix 2')).toBe('GB');
  });
  it('Australia subclass forms', () => {
    expect(detectFormFamily('Form 1419')).toBe('AU');
  });
  it('returns null for non-country-specific items (Schengen uniform app, plain docs)', () => {
    expect(detectFormFamily('Application for Schengen Visa')).toBeNull();
    expect(detectFormFamily('passport')).toBeNull();
    expect(detectFormFamily('Insurance certificate')).toBeNull();
  });
});

describe('destinationFormFamily', () => {
  it('maps the four base destinations', () => {
    expect(destinationFormFamily('US')).toBe('US');
    expect(destinationFormFamily('CA')).toBe('CA');
    expect(destinationFormFamily('GB')).toBe('GB');
    expect(destinationFormFamily('AU')).toBe('AU');
  });
  it('maps the bloc and every member to SCHENGEN', () => {
    expect(destinationFormFamily('SCHENGEN')).toBe('SCHENGEN');
    expect(destinationFormFamily('FI')).toBe('SCHENGEN');
    expect(destinationFormFamily('DE')).toBe('SCHENGEN');
  });
  it('returns null for unknown destinations (so the guard never false-blocks)', () => {
    expect(destinationFormFamily('XX')).toBeNull();
    expect(destinationFormFamily(null)).toBeNull();
  });
});

describe('isForeignForm — the cross-country leakage guard', () => {
  it('flags Canadian IMM forms leaking into a Finland (Schengen) flow — THE reported bug', () => {
    expect(isForeignForm('FI', 'IMM 5257')).toBe(true);
    expect(isForeignForm('FI', 'DS-160')).toBe(true);
    expect(isForeignForm('FI', 'VAF1A')).toBe(true);
  });
  it('allows the destination country its own forms', () => {
    expect(isForeignForm('CA', 'IMM 5257')).toBe(false);
    expect(isForeignForm('US', 'DS-160')).toBe(false);
    expect(isForeignForm('GB', 'VAF1A')).toBe(false);
  });
  it('allows Schengen-family forms for any member', () => {
    expect(isForeignForm('FI', 'Application for Schengen Visa')).toBe(false);
    expect(isForeignForm('DE', 'Application for Schengen Visa')).toBe(false);
  });
  it('flags the other direction too (UK form in a Canada flow)', () => {
    expect(isForeignForm('CA', 'VAF1A')).toBe(true);
    expect(isForeignForm('CA', 'DS-160')).toBe(true);
  });
  it('never blocks when destination is unknown or form is generic', () => {
    expect(isForeignForm('XX', 'IMM 5257')).toBe(false);
    expect(isForeignForm('FI', 'passport')).toBe(false);
  });
});
