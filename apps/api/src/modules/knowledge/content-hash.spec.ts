import {
  hashBytes,
  hashText,
  jobKey,
  normalizeForHash,
  queryHash,
} from './content-hash';

describe('hashBytes', () => {
  it('hashes exactly what was served — no normalisation', () => {
    const a = hashBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const b = hashBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x20]));
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
  });

  it('is stable across calls', () => {
    const bytes = new Uint8Array(Buffer.from('official document'));
    expect(hashBytes(bytes)).toBe(hashBytes(bytes));
  });
});

describe('normalizeForHash', () => {
  it('normalises unicode composition', () => {
    // The dedup bug this prevents: "é" typed two ways hashes twice, so the
    // same French requirement is embedded twice.
    const composed = 'validité du passeport';
    const decomposed = 'validité du passeport';
    expect(composed).not.toBe(decomposed);
    expect(normalizeForHash(composed)).toBe(normalizeForHash(decomposed));
  });

  it('normalises line endings and trailing whitespace', () => {
    expect(normalizeForHash('a\r\nb  \r\n')).toBe(normalizeForHash('a\nb'));
  });

  it('preserves paragraph breaks, which carry block structure', () => {
    expect(normalizeForHash('a\n\nb')).toBe('a\n\nb');
    expect(normalizeForHash('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('hashText', () => {
  it('gives identical text one identity, which is the dedup guarantee', () => {
    expect(hashText('You must have a valid passport.')).toBe(
      hashText('  You   must have a  valid passport.  '),
    );
  });

  it('separates text that differs in meaning', () => {
    expect(hashText('You must provide bank statements.')).not.toBe(
      hashText('You must not provide bank statements.'),
    );
  });
});

describe('jobKey', () => {
  it('is derived from the subject, never from time', () => {
    const a = jobKey('ingest', 'version-1', 'model-x');
    const b = jobKey('ingest', 'version-1', 'model-x');
    expect(a).toBe(b);
    expect(a).toBe('ingest:version-1:model-x');
  });

  it('separates different models so a re-embed is its own unit of work', () => {
    expect(jobKey('ingest', 'v1', 'model-a')).not.toBe(
      jobKey('ingest', 'v1', 'model-b'),
    );
  });
});

describe('queryHash', () => {
  it('ignores case and whitespace', () => {
    expect(queryHash('What documents do I need?')).toBe(
      queryHash('  what   DOCUMENTS do i need? '),
    );
  });

  it('includes the filters — the same words about two countries are two queries', () => {
    // This is the cache-poisoning failure: one country's answer served for
    // another because the cache key was the words alone.
    const ca = queryHash('what documents do I need', { countryId: 'ca-uuid' });
    const au = queryHash('what documents do I need', { countryId: 'au-uuid' });
    expect(ca).not.toBe(au);
  });

  it('is insensitive to filter key order and array order', () => {
    const a = queryHash('q', { countryId: 'x', languages: ['en', 'fr'] });
    const b = queryHash('q', { languages: ['fr', 'en'], countryId: 'x' });
    expect(a).toBe(b);
  });

  it('treats an absent filter and an explicitly null one as the same', () => {
    expect(queryHash('q', { countryId: 'x' })).toBe(
      queryHash('q', { countryId: 'x', visaTypeId: null }),
    );
  });
});
