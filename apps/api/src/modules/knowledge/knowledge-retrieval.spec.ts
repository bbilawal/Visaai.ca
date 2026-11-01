import type { SupabaseClient } from '@supabase/supabase-js';

import {
  KnowledgeRetrievalService,
  isStale,
  parseIntervalMs,
} from './knowledge-retrieval.service';
import { DeterministicEmbeddingProvider } from './embeddings/embedding.provider';
import { FakeSupabase } from './test-support/fake-supabase';

/** One SQL result row, shaped as kb_search_hybrid returns it. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chunk_id: 'c1',
    text_sha256: 'a'.repeat(64),
    chunk_text: 'You must have a valid passport.',
    score: 0.03,
    vector_rank: 1,
    lexical_rank: 1,
    vector_similarity: 0.9,
    lexical_score: 0.4,
    country_id: 'country-ca',
    visa_type_id: 'type-trv',
    source_id: 'src-1',
    source_version_id: 'ver-1',
    authority_rank: 1,
    source_role: 'requirements',
    language: 'en',
    heading_path: ['Documents'],
    page_number: null,
    form_codes: [],
    status: 'current',
    effective_from: null,
    effective_to: null,
    ...over,
  };
}

function db(
  rows: Array<Record<string, unknown>> = [row()],
  opts: { rpcThrows?: boolean } = {},
) {
  const fake = new FakeSupabase({
    rpc: {
      kb_search_hybrid: () =>
        opts.rpcThrows
          ? { data: null, error: { message: 'boom' } }
          : { data: rows, error: null },
    },
  });
  fake.seed('visa_sources', [
    {
      id: 'src-1',
      canonical_url: 'https://www.canada.ca/en/visit.html',
      authority: 'IRCC',
      authority_rank: 1,
      role: 'requirements',
      title: 'Visitor visa',
      last_checked_at: new Date().toISOString(),
      last_changed_at: '2026-01-01T00:00:00Z',
      freshness_sla: '30 days',
    },
  ]);
  fake.seed('visa_source_versions', [
    {
      id: 'ver-1',
      version_number: 3,
      published_at: '2026-01-01',
      fetched_at: '2026-01-02',
    },
  ]);
  fake.seed('visa_countries', [
    { id: 'country-ca', code: 'CA', name: 'Canada' },
  ]);
  fake.seed('visa_types', [{ id: 'type-trv', official_name: 'Visitor visa' }]);
  return fake;
}

function service(fake: FakeSupabase) {
  return new KnowledgeRetrievalService(
    fake as unknown as SupabaseClient,
    new DeterministicEmbeddingProvider(),
  );
}

describe('KnowledgeRetrievalService.search', () => {
  it('passes the country and visa filters into the SQL, not after it', async () => {
    // The correctness property: filtering after a top-k vector search can
    // return k results of which none are for the requested country.
    const fake = db();
    await service(fake).search('what documents do I need', {
      countryId: 'country-ca',
      visaTypeId: 'type-trv',
    });

    const call = fake.rpcCalls.find((c) => c.name === 'kb_search_hybrid');
    expect(call).toBeDefined();
    expect(call!.args.p_country_id).toBe('country-ca');
    expect(call!.args.p_visa_type_id).toBe('type-trv');
  });

  it('never asks for superseded content by default', async () => {
    const fake = db();
    await service(fake).search('fees', { countryId: 'country-ca' });
    expect(fake.rpcCalls[0].args.p_include_superseded).toBe(false);
  });

  it('uses the hybrid strategy when an embedding is available', async () => {
    const result = await service(db()).search('what documents do I need', {});
    expect(result.strategy).toBe('hybrid');
    expect(result.chunks).toHaveLength(1);
  });

  it('switches to the form-code strategy when the question names a form', async () => {
    const fake = db();
    const result = await service(fake).search('what is IMM 5257', {});
    expect(result.strategy).toBe('form_code');
    expect(result.formCodes).toEqual(['IMM 5257']);
    // The exact arm runs with the codes as a filter.
    const exactCall = fake.rpcCalls.find((c) => c.args.p_form_codes !== null);
    expect(exactCall!.args.p_form_codes).toEqual(['IMM 5257']);
  });

  it('degrades to lexical rather than failing when the embedding provider is down', async () => {
    const broken = {
      model: 'broken',
      dimensions: 1536,
      batchSize: 1,
      embed: () => Promise.reject(new Error('provider unavailable')),
    };
    const fake = db();
    const svc = new KnowledgeRetrievalService(
      fake as unknown as SupabaseClient,
      broken,
    );
    const result = await svc.search('fees', {});

    expect(result.strategy).toBe('lexical');
    expect(result.degraded).toMatch(/embedding provider unavailable/);
    expect(fake.rpcCalls[0].args.p_query_embedding).toBeNull();
  });

  it('attaches a citation pointing at the authority, never at our cache', async () => {
    const result = await service(db()).search('documents', {});
    const citation = result.chunks[0].citation!;
    expect(citation.url).toBe('https://www.canada.ca/en/visit.html');
    expect(citation.authority).toBe('IRCC');
    expect(citation.countryName).toBe('Canada');
    expect(citation.visaTypeName).toBe('Visitor visa');
    expect(citation.versionNumber).toBe(3);
    expect(citation.stale).toBe(false);
  });

  it('marks a citation stale when the source is past its freshness SLA', async () => {
    const fake = db();
    fake.tables.visa_sources[0].last_checked_at = '2020-01-01T00:00:00Z';
    const result = await service(fake).search('documents', {});
    expect(result.chunks[0].citation!.stale).toBe(true);
  });

  it('logs the retrieval with its filters and result ids', async () => {
    const fake = db();
    await service(fake).search(
      'documents',
      { countryId: 'country-ca' },
      { userId: 'user-1' },
    );

    const log = fake.tables.kb_retrieval_logs[0];
    expect(log.user_id).toBe('user-1');
    expect(log.country_id).toBe('country-ca');
    expect(log.strategy).toBe('hybrid');
    expect(log.returned_chunk_ids).toEqual(['c1']);
    expect(log.outcome).toBe('answered');
  });

  it('records insufficient_evidence when nothing matched', async () => {
    const fake = db([]);
    const result = await service(fake).search('an unanswerable question', {});
    expect(result.chunks).toHaveLength(0);
    expect(fake.tables.kb_retrieval_logs[0].outcome).toBe(
      'insufficient_evidence',
    );
  });

  it('skips logging for the benchmark harness', async () => {
    const fake = db();
    await service(fake).search('documents', {}, { skipLogging: true });
    expect(fake.tables.kb_retrieval_logs ?? []).toHaveLength(0);
  });

  it('returns nothing for an empty query without calling the database', async () => {
    const fake = db();
    const result = await service(fake).search('   ', {});
    expect(result.chunks).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('caps the requested limit', async () => {
    const fake = db();
    await service(fake).search('documents', {}, { limit: 5000 });
    const finalCall = fake.rpcCalls[fake.rpcCalls.length - 1];
    expect(finalCall.args.p_limit).toBeLessThanOrEqual(500);
  });

  it('propagates a SQL failure rather than returning silently empty results', async () => {
    await expect(
      service(db([], { rpcThrows: true })).search('x', {}),
    ).rejects.toThrow(/hybrid search failed/);
  });

  it('prefers a requested source role without dropping the others', async () => {
    const fees = row({ chunk_id: 'fees', source_role: 'fees' });
    const reqs = row({ chunk_id: 'reqs', source_role: 'requirements' });
    const fake = db([reqs, fees]);
    fake.seed('visa_sources', [
      {
        id: 'src-1',
        canonical_url: 'https://www.canada.ca/en/visit.html',
        authority: 'IRCC',
        authority_rank: 1,
        role: 'fees',
        title: null,
        last_checked_at: new Date().toISOString(),
        freshness_sla: '30 days',
      },
    ]);
    const result = await service(fake).search('how much is the fee', {
      sourceRoles: ['fees'],
    });
    expect(result.chunks.map((c) => c.chunkId)).toContain('reqs');
    expect(result.chunks[0].chunkId).toBe('fees');
  });
});

describe('parseIntervalMs', () => {
  it('parses the Postgres verbose form', () => {
    expect(parseIntervalMs('30 days')).toBe(30 * 86_400_000);
    expect(parseIntervalMs('6 hours')).toBe(6 * 3_600_000);
    expect(parseIntervalMs('1 mon 2 days')).toBe(32 * 86_400_000);
  });

  it('parses the ISO-8601 form', () => {
    expect(parseIntervalMs('P30D')).toBe(30 * 86_400_000);
    expect(parseIntervalMs('PT6H')).toBe(6 * 3_600_000);
  });

  it('parses the clock form Postgres uses for sub-day intervals', () => {
    expect(parseIntervalMs('06:00:00')).toBe(6 * 3_600_000);
  });

  it('returns null on something it cannot parse', () => {
    expect(parseIntervalMs('soonish')).toBeNull();
    expect(parseIntervalMs(null)).toBeNull();
  });
});

describe('isStale', () => {
  it('is stale when never checked', () => {
    expect(isStale(null, '30 days')).toBe(true);
  });

  it('is not stale within the SLA', () => {
    expect(isStale(new Date().toISOString(), '30 days')).toBe(false);
  });

  it('is stale past the SLA', () => {
    expect(isStale('2020-01-01T00:00:00Z', '30 days')).toBe(true);
  });

  it('reports NOT stale on an unparseable interval', () => {
    // Flagging every citation stale over a formatting difference trains users
    // to ignore the flag, which is worse than not having it.
    expect(isStale('2020-01-01T00:00:00Z', 'whenever')).toBe(false);
  });
});
