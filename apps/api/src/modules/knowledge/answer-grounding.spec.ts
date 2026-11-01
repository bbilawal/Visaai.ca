import {
  ANSWER_DISCLAIMER,
  buildRefusal,
  normalizeForQuoteMatch,
  quoteIsSupported,
  splitClaims,
  verifyGrounding,
  type Claim,
  type GroundingEvidence,
} from './answer-grounding';

const evidence = (
  over: Partial<GroundingEvidence> = {},
): GroundingEvidence => ({
  chunkId: 'c1',
  text: 'You must have a valid passport. The application fee is 100 CAD and is not refundable.',
  countryId: 'ca',
  visaTypeId: 'trv',
  status: 'current',
  authorityRank: 1,
  ...over,
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  index: 0,
  text: 'You must have a valid passport.',
  citedChunkIds: ['c1'],
  supportingQuote: 'You must have a valid passport',
  modality: 'mandatory',
  ...over,
});

describe('quoteIsSupported', () => {
  it('accepts a verbatim span', () => {
    expect(quoteIsSupported('valid passport', evidence().text)).toBe(true);
  });

  it('accepts a span differing only in punctuation and case', () => {
    expect(
      quoteIsSupported('YOU MUST HAVE A VALID PASSPORT', evidence().text),
    ).toBe(true);
  });

  it('rejects a fabricated quotation', () => {
    // The important failure: a plausible-sounding quote that is not in the source.
    expect(
      quoteIsSupported(
        'You must have a valid passport and two references',
        evidence().text,
      ),
    ).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(quoteIsSupported('', evidence().text)).toBe(false);
  });
});

describe('normalizeForQuoteMatch', () => {
  it('normalises smart quotes and dashes', () => {
    expect(normalizeForQuoteMatch('“six–month”')).toBe('"six-month"');
  });
});

describe('splitClaims', () => {
  it('splits an answer into sentence-level claims', () => {
    expect(splitClaims('You need a passport. The fee is 100 CAD.')).toEqual([
      'You need a passport.',
      'The fee is 100 CAD.',
    ]);
  });
});

describe('verifyGrounding', () => {
  it('accepts a cited, quoted, in-jurisdiction claim', () => {
    const v = verifyGrounding([claim()], [evidence()], {
      expectedCountryId: 'ca',
    });
    expect(v.accepted).toHaveLength(1);
    expect(v.mustRefuse).toBe(false);
  });

  it('drops an uncited claim rather than softening it', () => {
    const v = verifyGrounding([claim({ citedChunkIds: [] })], [evidence()]);
    expect(v.accepted).toHaveLength(0);
    expect(v.rejected[0].reason).toBe('no citation');
    expect(v.mustRefuse).toBe(true);
  });

  it('drops a claim citing evidence that was never retrieved', () => {
    // A citation to a chunk id that does not exist is worse than none: it
    // looks checkable.
    const v = verifyGrounding(
      [claim({ citedChunkIds: ['ghost'] })],
      [evidence()],
    );
    expect(v.rejected[0].reason).toMatch(/not retrieved/);
  });

  it('drops a claim whose citation is from another jurisdiction', () => {
    // The cross-country leak, caught a second time even though retrieval filtered.
    const au = evidence({ chunkId: 'c2', countryId: 'au' });
    const v = verifyGrounding([claim({ citedChunkIds: ['c2'] })], [au], {
      expectedCountryId: 'ca',
    });
    expect(v.accepted).toHaveLength(0);
    expect(v.rejected[0].reason).toMatch(/another jurisdiction/);
  });

  it('drops a claim scoped to a different visa type', () => {
    const other = evidence({ chunkId: 'c3', visaTypeId: 'student' });
    const v = verifyGrounding([claim({ citedChunkIds: ['c3'] })], [other], {
      expectedCountryId: 'ca',
      expectedVisaTypeId: 'trv',
    });
    expect(v.accepted).toHaveLength(0);
  });

  it('accepts a country-level citation for any route of that country', () => {
    const countryLevel = evidence({ chunkId: 'c4', visaTypeId: null });
    const v = verifyGrounding(
      [claim({ citedChunkIds: ['c4'] })],
      [countryLevel],
      {
        expectedCountryId: 'ca',
        expectedVisaTypeId: 'trv',
      },
    );
    expect(v.accepted).toHaveLength(1);
  });

  it('drops a claim whose only citations are superseded', () => {
    const old = evidence({ chunkId: 'c5', status: 'superseded' });
    const v = verifyGrounding([claim({ citedChunkIds: ['c5'] })], [old], {
      expectedCountryId: 'ca',
    });
    expect(v.accepted).toHaveLength(0);
    expect(v.rejected[0].reason).toMatch(/superseded/);
  });

  it('warns but accepts when superseded evidence accompanies current evidence', () => {
    const old = evidence({ chunkId: 'c5', status: 'superseded' });
    const v = verifyGrounding(
      [claim({ citedChunkIds: ['c1', 'c5'] })],
      [evidence(), old],
      { expectedCountryId: 'ca' },
    );
    expect(v.accepted).toHaveLength(1);
    expect(v.warnings.join(' ')).toMatch(/superseded/);
  });

  it('drops a claim whose quote is not in the cited source', () => {
    const v = verifyGrounding(
      [claim({ supportingQuote: 'you must provide three bank references' })],
      [evidence()],
      { expectedCountryId: 'ca' },
    );
    expect(v.rejected[0].reason).toMatch(/does not appear/);
  });

  it('requires a quote for a mandatory claim', () => {
    const v = verifyGrounding(
      [claim({ supportingQuote: undefined, modality: 'mandatory' })],
      [evidence()],
      { expectedCountryId: 'ca' },
    );
    expect(v.rejected[0].reason).toMatch(/no supporting quote/);
  });

  it('allows an informational claim without a quote', () => {
    const v = verifyGrounding(
      [claim({ supportingQuote: undefined, modality: 'informational' })],
      [evidence()],
      { expectedCountryId: 'ca' },
    );
    expect(v.accepted).toHaveLength(1);
  });

  it.each([
    'Your application will be approved if you follow these steps.',
    'Meeting these requirements guarantees approval of your visa.',
    'You have a 90% chance of approval.',
    'You will be granted the visa once you submit.',
  ])('refuses to make an approval promise: %s', (text) => {
    const v = verifyGrounding([claim({ text })], [evidence()], {
      expectedCountryId: 'ca',
    });
    expect(v.accepted).toHaveLength(0);
    expect(v.rejected[0].reason).toMatch(/prohibited claim/);
  });

  it('does not misfire on ordinary approval language in a source', () => {
    const ok = claim({
      text: 'The authority decides whether to approve the application.',
    });
    const v = verifyGrounding([ok], [evidence()], { expectedCountryId: 'ca' });
    expect(v.accepted).toHaveLength(1);
  });
});

describe('buildRefusal', () => {
  it('names the scope and points at the official page', () => {
    const r = buildRefusal({
      question: 'what documents',
      countryName: 'Canada',
      visaTypeName: 'Visitor visa',
      authority: 'IRCC',
      officialUrl: 'https://www.canada.ca/x',
      reason: 'no_evidence',
    });
    expect(r).toContain('Visitor visa, Canada');
    expect(r).toContain('https://www.canada.ca/x');
    expect(r).toContain('final decision');
  });

  it('says the sources disagree rather than picking one', () => {
    const r = buildRefusal({ question: 'q', reason: 'conflicting' });
    expect(r).toMatch(/disagree/);
    expect(r).toMatch(/will not choose/);
  });

  it('distinguishes a superseded-only corpus', () => {
    expect(buildRefusal({ question: 'q', reason: 'stale_only' })).toMatch(
      /superseded/,
    );
  });
});

describe('ANSWER_DISCLAIMER', () => {
  it('states the three things the platform must always say', () => {
    expect(ANSWER_DISCLAIMER).toMatch(/change without notice/);
    expect(ANSWER_DISCLAIMER).toMatch(/not legal advice/);
    expect(ANSWER_DISCLAIMER).toMatch(/final decision/);
  });
});
