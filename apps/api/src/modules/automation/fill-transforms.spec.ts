import { applyFillTransform } from './fill-transforms';

describe('na_phone', () => {
  it('keeps the ten digits IRCC asks for', () => {
    expect(applyFillTransform('na_phone', '+1 905-226-5664')).toBe(
      '9052265664',
    );
    expect(applyFillTransform('na_phone', '(905) 226 5664')).toBe('9052265664');
  });
  it('writes nothing for a number outside Canada / US', () => {
    expect(applyFillTransform('na_phone', '+92 300 1234567')).toBeNull();
    // Audit 2026-10-18: these used to become Canadian numbers.
    expect(applyFillTransform('na_phone', '0912345678')).toBeNull();
    expect(applyFillTransform('na_phone', '+86 138 1234 5678')).toBeNull();
    expect(applyFillTransform('na_phone', '+55 11 98765-4321')).toBeNull();
  });
});

describe('strip_dashes', () => {
  it('keeps letters, digits and spaces only (IRCC refuses anything else)', () => {
    expect(applyFillTransform('strip_dashes', '37405-5309209-7')).toBe(
      '3740553092097',
    );
    expect(applyFillTransform('strip_dashes', '123.456.789-09')).toBe(
      '12345678909',
    );
    expect(applyFillTransform('strip_dashes', '1.234.567.890')).toBe(
      '1234567890',
    );
    expect(applyFillTransform('strip_dashes', 'A1234567(8)')).toBe('A12345678');
    expect(applyFillTransform('strip_dashes', '12345 1234567 1')).toBe(
      '12345 1234567 1',
    );
  });
  it('writes nothing when no letter or digit is left', () => {
    expect(applyFillTransform('strip_dashes', '--')).toBeNull();
  });
});

// IRCC eTA form (recorded live 2026-10-16): every question is a <select>
// chosen by option TEXT; option values are list indexes.
describe('eTA date selects', () => {
  it('year is the four digits, month the English name, day zero-padded', () => {
    expect(applyFillTransform('date_year', '1960-05-01')).toBe('1960');
    expect(applyFillTransform('date_month_name', '1960-05-01')).toBe('May');
    expect(applyFillTransform('date_month_name', '2031-12-09')).toBe(
      'December',
    );
    expect(applyFillTransform('date_day_padded', '1960-05-01')).toBe('01');
    expect(applyFillTransform('date_day_padded', '1960-05-21')).toBe('21');
  });
  it('a date known only to the year writes no month or day', () => {
    expect(
      applyFillTransform('date_month_name', '1960-Unknown-Unknown'),
    ).toBeNull();
    expect(
      applyFillTransform('date_day_padded', '1960-Unknown-Unknown'),
    ).toBeNull();
  });
  it('an unreadable date writes nothing', () => {
    expect(applyFillTransform('date_month_name', 'May 1960')).toBeNull();
    expect(applyFillTransform('date_day_padded', '')).toBeNull();
  });
});

describe('eTA country lists (each field has its own list)', () => {
  it('country-code list: "PAK (Pakistan)", "GBR (UK - British citizen)"', () => {
    expect(applyFillTransform('eta_country_code', 'PAK')).toBe(
      'PAK (Pakistan)',
    );
    expect(applyFillTransform('eta_country_code', 'Pakistan')).toBe(
      'PAK (Pakistan)',
    );
    expect(applyFillTransform('eta_country_code', 'United Kingdom')).toBe(
      'GBR (UK - British citizen)',
    );
    expect(applyFillTransform('eta_country_code', 'British')).toBe(
      'GBR (UK - British citizen)',
    );
  });
  it('nationality list: "Pakistan", "UK - British citizen"', () => {
    expect(applyFillTransform('eta_nationality', 'PAK')).toBe('Pakistan');
    expect(applyFillTransform('eta_nationality', 'GBR')).toBe(
      'UK - British citizen',
    );
  });
  it('birth / address list: "Pakistan", "England" — never "United Kingdom"', () => {
    expect(applyFillTransform('eta_place_country', 'Pakistan')).toBe(
      'Pakistan',
    );
    expect(applyFillTransform('eta_place_country', 'England')).toBe('England');
    expect(applyFillTransform('eta_place_country', 'London, England')).toBe(
      'England',
    );
    // The list splits the UK by nation; which one is not ours to guess.
    expect(
      applyFillTransform('eta_place_country', 'United Kingdom'),
    ).toBeNull();
    expect(applyFillTransform('eta_place_country', 'GBR')).toBeNull();
  });
  it('every country on the recorded lists resolves; one with no option writes nothing', () => {
    // The full option lists were recorded live on 2026-10-18.
    expect(applyFillTransform('eta_country_code', 'FRA')).toBe('FRA (France)');
    expect(applyFillTransform('eta_nationality', 'France')).toBe('France');
    expect(applyFillTransform('eta_place_country', 'France')).toBe('France');
    expect(applyFillTransform('eta_country_code', 'Atlantis')).toBeNull();
    expect(applyFillTransform('eta_place_country', 'Atlantis')).toBeNull();
  });
});
