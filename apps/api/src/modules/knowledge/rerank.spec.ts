import { inferKind, mentionsNationality, queryTerms, rerank } from './rerank';
import type { RetrievedChunk } from './knowledge-retrieval.service';

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: 'c1',
  textSha256: 'a'.repeat(64),
  text: 'You must provide a valid passport.',
  score: 0.01,
  vectorRank: 1,
  lexicalRank: 1,
  vectorSimilarity: 0.8,
  lexicalScore: 0.5,
  countryId: 'ca',
  visaTypeId: null,
  sourceId: 's1',
  sourceVersionId: 'v1',
  authorityRank: 1,
  sourceRole: 'requirements',
  language: 'en',
  headingPath: [],
  pageNumber: null,
  formCodes: [],
  status: 'current',
  effectiveFrom: null,
  effectiveTo: null,
  ...over,
});

describe('queryTerms', () => {
  it('drops corpus-wide stopwords that signal nothing', () => {
    expect(queryTerms('what documents do I need for a visitor visa')).toEqual([
      'visitor',
    ]);
  });
});

describe('rerank', () => {
  it('promotes an exact visa-type match over a country-level chunk at equal score', () => {
    const exact = chunk({ chunkId: 'exact', visaTypeId: 'trv' });
    const general = chunk({ chunkId: 'general', visaTypeId: null });
    const out = rerank([general, exact], {
      query: 'documents',
      formCodes: [],
      visaTypeId: 'trv',
    });
    expect(out[0].chunkId).toBe('exact');
  });

  it('keeps a country-level chunk in play — it governs every route', () => {
    const general = chunk({ chunkId: 'general', visaTypeId: null });
    const out = rerank([general], {
      query: 'passport',
      formCodes: [],
      visaTypeId: 'trv',
    });
    expect(out).toHaveLength(1);
  });

  it('demotes superseded content', () => {
    const current = chunk({ chunkId: 'cur', status: 'current' });
    const old = chunk({ chunkId: 'old', status: 'superseded', score: 0.012 });
    const out = rerank([old, current], { query: 'passport', formCodes: [] });
    expect(out[0].chunkId).toBe('cur');
  });

  it('pins an exact form-code hit above everything else', () => {
    // A user who typed a form number wants that form, whatever the vectors say.
    const semantic = chunk({ chunkId: 'semantic', score: 1 });
    const exact = chunk({
      chunkId: 'exact',
      score: 0.001,
      formCodes: ['IMM 5257'],
    });
    const out = rerank([semantic, exact], {
      query: 'what is IMM 5257',
      formCodes: ['IMM 5257'],
      pinnedChunkIds: new Set(['exact']),
    });
    expect(out[0].chunkId).toBe('exact');
  });

  it('promotes a checklist over prose for a document question', () => {
    const prose = chunk({
      chunkId: 'prose',
      text: 'Applicants should read the guidance carefully before applying.',
    });
    const list = chunk({
      chunkId: 'list',
      headingPath: ['Documents you must provide'],
      text: 'Documents you must provide\n• Passport\n• Bank statements\n• Photograph',
    });
    const out = rerank([prose, list], { query: 'documents', formCodes: [] });
    expect(out[0].chunkId).toBe('list');
  });

  it('breaks ties by authority rank, then deterministically by id', () => {
    const consulate = chunk({ chunkId: 'b-consulate', authorityRank: 4 });
    const department = chunk({ chunkId: 'a-department', authorityRank: 1 });
    const out = rerank([consulate, department], { query: 'x', formCodes: [] });
    expect(out[0].chunkId).toBe('a-department');
  });

  it('is deterministic across runs', () => {
    const chunks = [
      chunk({ chunkId: 'a' }),
      chunk({ chunkId: 'b' }),
      chunk({ chunkId: 'c' }),
    ];
    const signal = { query: 'passport', formCodes: [] };
    const first = rerank([...chunks], signal).map((c) => c.chunkId);
    const second = rerank([...chunks], signal).map((c) => c.chunkId);
    expect(second).toEqual(first);
  });

  it('cannot let a structural bonus invert a large relevance gap', () => {
    // The reranker must remain a reranker: no single signal promotes an
    // irrelevant passage over a well-matching one.
    const relevant = chunk({ chunkId: 'relevant', score: 1 });
    const checklist = chunk({
      chunkId: 'checklist',
      score: 0.1,
      headingPath: ['Documents you must provide'],
      text: 'Documents\n• a\n• b',
    });
    const out = rerank([checklist, relevant], {
      query: 'documents',
      formCodes: [],
    });
    expect(out[0].chunkId).toBe('relevant');
  });
});

describe('inferKind', () => {
  it('recognises a serialised table', () => {
    expect(
      inferKind(chunk({ text: 'Visa: A | Fee: 10\nVisa: B | Fee: 20' })),
    ).toBe('table');
  });

  it('recognises a checklist by its heading', () => {
    expect(
      inferKind(
        chunk({
          headingPath: ['Documents you must provide'],
          text: '• a\n• b',
        }),
      ),
    ).toBe('checklist');
  });

  it('calls a bulleted nav list a list, not a checklist', () => {
    expect(
      inferKind(chunk({ headingPath: ['Related links'], text: '• a\n• b' })),
    ).toBe('list');
  });

  it('calls a short fragment with no sentence page furniture', () => {
    expect(inferKind(chunk({ text: 'Contact us' }))).toBe('metadata');
  });
});

describe('mentionsNationality', () => {
  it('matches the country name', () => {
    expect(
      mentionsNationality('Nationals of India must provide biometrics.', 'IN'),
    ).toBe(true);
  });

  it('matches a standalone ISO code', () => {
    expect(
      mentionsNationality('Applies to PK and BD passport holders.', 'PK'),
    ).toBe(true);
  });

  it('does not match an unrelated chunk', () => {
    expect(mentionsNationality('You must have a valid passport.', 'IN')).toBe(
      false,
    );
  });

  it('ignores a malformed nationality', () => {
    expect(mentionsNationality('India', 'INDIA')).toBe(false);
  });
});
