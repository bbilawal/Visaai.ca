import {
  AdminListQueryDto,
  IngestSourceDto,
  KnowledgeAnswerDto,
  KnowledgeSearchDto,
  ReviewActionDto,
} from './knowledge.dto';

describe('KnowledgeSearchDto', () => {
  it('accepts a well-formed query', () => {
    const r = KnowledgeSearchDto.safeParse({
      query: 'what documents do I need',
      countryId: '3f2a1c64-9d5e-4b7a-8f21-0c9d4e7b1a55',
      languages: ['en', 'fr-CA'],
      limit: 10,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown key rather than ignoring it', () => {
    // An ignored filter key is a filter that did not apply, which is another
    // country's rules in the response.
    const r = KnowledgeSearchDto.safeParse({
      query: 'x y',
      includeSuperseded: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-uuid country id', () => {
    expect(
      KnowledgeSearchDto.safeParse({ query: 'x y', countryId: 'CA' }).success,
    ).toBe(false);
  });

  it('rejects a malformed language tag', () => {
    expect(
      KnowledgeSearchDto.safeParse({ query: 'x y', languages: ['english'] })
        .success,
    ).toBe(false);
  });

  it('rejects a limit above the cap', () => {
    expect(
      KnowledgeSearchDto.safeParse({ query: 'x y', limit: 5000 }).success,
    ).toBe(false);
  });

  it('rejects an unknown source role', () => {
    expect(
      KnowledgeSearchDto.safeParse({ query: 'x y', sourceRoles: ['blog'] })
        .success,
    ).toBe(false);
  });

  it('rejects an asOf that is not a date', () => {
    expect(
      KnowledgeSearchDto.safeParse({ query: 'x y', asOf: 'last year' }).success,
    ).toBe(false);
  });
});

describe('KnowledgeAnswerDto', () => {
  it('requires a question of usable length', () => {
    expect(KnowledgeAnswerDto.safeParse({ question: 'a' }).success).toBe(false);
    expect(KnowledgeAnswerDto.safeParse({ question: 'fee?' }).success).toBe(
      true,
    );
  });

  it('bounds the evidence limit at both ends', () => {
    expect(
      KnowledgeAnswerDto.safeParse({ question: 'fee?', evidenceLimit: 1 })
        .success,
    ).toBe(false);
    expect(
      KnowledgeAnswerDto.safeParse({ question: 'fee?', evidenceLimit: 999 })
        .success,
    ).toBe(false);
    expect(
      KnowledgeAnswerDto.safeParse({ question: 'fee?', evidenceLimit: 8 })
        .success,
    ).toBe(true);
  });
});

describe('IngestSourceDto', () => {
  it('requires one of the three selectors', () => {
    expect(IngestSourceDto.safeParse({}).success).toBe(false);
    expect(IngestSourceDto.safeParse({ countryCode: 'CA' }).success).toBe(true);
  });

  it('accepts a dry run', () => {
    expect(
      IngestSourceDto.safeParse({ countryCode: 'CA', dryRun: true }).success,
    ).toBe(true);
  });
});

describe('ReviewActionDto', () => {
  it('accepts only the three terminal-or-triage states', () => {
    expect(ReviewActionDto.safeParse({ state: 'resolved' }).success).toBe(true);
    expect(ReviewActionDto.safeParse({ state: 'open' }).success).toBe(false);
  });
});

describe('AdminListQueryDto', () => {
  it('coerces numeric query strings', () => {
    const r = AdminListQueryDto.safeParse({ limit: '50', offset: '10' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(50);
      expect(r.data.offset).toBe(10);
    }
  });
});
