import {
  cosineSimilarity,
  DeterministicEmbeddingProvider,
  embedDeterministic,
  EMBEDDING_DIMENSIONS,
  toVectorLiteral,
} from './embedding.provider';

describe('embedDeterministic', () => {
  it('is deterministic — the same text always gives the same vector', () => {
    expect(embedDeterministic('You must have a valid passport.')).toEqual(
      embedDeterministic('You must have a valid passport.'),
    );
  });

  it('produces the schema-declared width', () => {
    expect(embedDeterministic('x')).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('is unit length, so cosine and dot product agree', () => {
    const v = embedDeterministic('official visa requirements');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('places texts sharing vocabulary closer than unrelated ones', () => {
    const a = embedDeterministic(
      'you must provide a valid passport and bank statements',
    );
    const b = embedDeterministic(
      'you must provide a valid passport and a photograph',
    );
    const c = embedDeterministic(
      'processing times for student permits in Australia',
    );
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it('distinguishes word order, so negation is not identical to assertion', () => {
    const yes = embedDeterministic('bank statements are required');
    const no = embedDeterministic('bank statements are not required');
    expect(cosineSimilarity(yes, no)).toBeLessThan(0.999);
  });
});

describe('DeterministicEmbeddingProvider', () => {
  it('declares a model id that can never be mistaken for a production one', async () => {
    const p = new DeterministicEmbeddingProvider();
    expect(p.model).toBe('deterministic-hash-v1');
    const [v] = await p.embed(['x']);
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('returns one vector per input, in order', async () => {
    const p = new DeterministicEmbeddingProvider();
    const vectors = await p.embed(['a', 'b', 'c']);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]).toEqual(embedDeterministic('a'));
    expect(vectors[2]).toEqual(embedDeterministic('c'));
  });

  it('handles an empty batch', async () => {
    expect(await new DeterministicEmbeddingProvider().embed([])).toEqual([]);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('rejects a length mismatch rather than silently comparing prefixes', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(
      /length mismatch/,
    );
  });

  it('returns 0 for a zero vector rather than NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('toVectorLiteral', () => {
  it('renders the pgvector literal form, not a JSON array of strings', () => {
    expect(toVectorLiteral([0.5, -0.25])).toBe('[0.500000,-0.250000]');
  });

  it('substitutes 0 for a non-finite component rather than emitting NaN', () => {
    expect(toVectorLiteral([Number.NaN, Infinity])).toBe('[0,0]');
  });
});
