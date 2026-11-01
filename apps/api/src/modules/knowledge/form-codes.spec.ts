import {
  canonicalizeFormCode,
  detectQueryFormCodes,
  extractFormCodes,
} from './form-codes';

describe('canonicalizeFormCode', () => {
  it('normalises spacing, case and separators to one identity', () => {
    // A page writes one of these, a user types another. They must match.
    const forms = ['IMM 5257', 'imm5257', 'IMM-5257', 'Imm 5257'];
    const canonical = forms.map(canonicalizeFormCode);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe('IMM 5257');
  });

  it('drops an edition suffix, which is not part of identity', () => {
    // Otherwise a query for the form never matches this year's edition of it.
    expect(canonicalizeFormCode('IMM 5257 (07-2023)')).toBe('IMM 5257');
    expect(canonicalizeFormCode('DS-160 (2024)')).toBe('DS 160');
  });
});

describe('extractFormCodes', () => {
  it('finds Canadian IRCC forms', () => {
    const codes = extractFormCodes(
      'Complete form IMM 5257 and IMM 5645 before you apply.',
    ).map((f) => f.code);
    expect(codes).toContain('IMM 5257');
    expect(codes).toContain('IMM 5645');
  });

  it('finds US forms', () => {
    const codes = extractFormCodes(
      'Submit Form DS-160 online and file I-129 with USCIS.',
    ).map((f) => f.code);
    expect(codes).toContain('DS 160');
    expect(codes).toContain('I 129');
  });

  it('finds UK forms', () => {
    const codes = extractFormCodes(
      'Complete VAF1A and, if applicable, FLR(M).',
    ).map((f) => f.code);
    expect(codes).toContain('VAF 1A');
  });

  it('finds an Australian subclass number', () => {
    const codes = extractFormCodes(
      'The Visitor visa (subclass 600) allows a stay of 3 months.',
    ).map((f) => f.code);
    expect(codes).toContain('SUBCLASS 600');
  });

  it('does not fire on ordinary numbers in prose', () => {
    // The reason the patterns are authority-anchored rather than generic:
    // a generic [A-Z]{1,4}-?\d{2,5} matches all of these.
    const noise =
      'COVID-19 measures ended in 2023. Call 0800 123 4567. See section 12 and page 45.';
    expect(extractFormCodes(noise).map((f) => f.code)).toEqual([]);
  });

  it('deduplicates repeated mentions', () => {
    const codes = extractFormCodes('IMM 5257 ... imm-5257 ... IMM5257');
    expect(codes).toHaveLength(1);
  });

  it('finds US nonimmigrant classifications', () => {
    const codes = extractFormCodes('H-1B and L-1A holders may apply.').map(
      (f) => f.code,
    );
    expect(codes).toContain('H 1B');
  });
});

describe('detectQueryFormCodes', () => {
  it('detects the code a user typed, in whatever shape they typed it', () => {
    expect(detectQueryFormCodes('what is imm5257')).toEqual(['IMM 5257']);
    expect(detectQueryFormCodes('do I need DS 160?')).toEqual(['DS 160']);
  });

  it('returns nothing for a question with no form in it', () => {
    expect(
      detectQueryFormCodes('what documents do I need for a visitor visa'),
    ).toEqual([]);
  });
});

describe('form-code false positives', () => {
  it('does not read "Form I" out of a US form reference', () => {
    // Observed on canada.ca's eTA exemption page, which cites the US
    // permanent-resident card as "Form I-551". The Roman-numeral Indian form
    // pattern matched the leading "Form I" and filed a bogus code.
    const codes = extractFormCodes(
      'valid permanent resident card (Form I-551) or a foreign passport with an I-551 stamp',
    ).map((f) => f.code);
    expect(codes).toContain('I 551');
    expect(codes).not.toContain('FORM I');
  });

  it('still reads a genuine Roman-numeral form', () => {
    expect(
      extractFormCodes('Complete Form IV and submit it in person.').map(
        (f) => f.code,
      ),
    ).toContain('FORM IV');
  });
});

describe('round-trip invariant', () => {
  // A user who types a code the way this system DISPLAYS it must get the exact
  // match. Both of these were real benchmark misses: "What is FORM 918?" and
  // "What is O 1A?" returned nothing from the exact arm because the detector
  // could not recognise its own canonical output.
  const CODES = [
    'IMM 5257',
    'IMM 5645',
    'DS 160',
    'I 129',
    'I 551',
    'I 765',
    'I 539',
    'N 400',
    'G 1145',
    'VAF 1A',
    'INZ 1017',
    'FORM 918',
    'SUBCLASS 600',
    'H 1B',
    'L 1A',
    'O 1A',
    'E 2',
    'EB 5',
    'TN',
    'K 1',
  ];

  it.each(CODES)('re-detects its own canonical form: %s', (code) => {
    expect(canonicalizeFormCode(code)).toBe(code);
    expect(detectQueryFormCodes(`What is ${code}?`)).toContain(code);
  });

  it.each(CODES)('detects the code case-insensitively: %s', (code) => {
    expect(detectQueryFormCodes(`what is ${code.toLowerCase()}?`)).toContain(
      code,
    );
  });

  it('detects the hyphenated form a page writes', () => {
    expect(detectQueryFormCodes('Complete Form I-765 and O-1A')).toEqual(
      expect.arrayContaining(['I 765', 'O 1A']),
    );
  });
});
