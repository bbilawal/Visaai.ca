import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  embedDeterministic,
  toVectorLiteral,
} from '../src/modules/knowledge/embeddings/embedding.provider';
import { hashText } from '../src/modules/knowledge/content-hash';

/**
 * `kb_search_hybrid` against a real Postgres.
 *
 * The unit suite covers everything the pipeline decides in TypeScript. This
 * covers what only SQL can: that the jurisdiction filter is applied INSIDE both
 * ranking arms, that RRF actually fuses two rankings, that superseded content
 * is excluded by default, that the unique indexes make the deduplication
 * guarantees real rather than aspirational, and that RLS denies what it should.
 *
 * Those are exactly the properties a fake client cannot test, because a fake
 * client has no query planner, no constraints and no RLS.
 *
 * GATED on env so the default `pnpm test` stays green without a database:
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SUPABASE_ANON_KEY=... \
 *   npx jest knowledge-hybrid-search
 */
const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

const MODEL = 'deterministic-hash-v1';
const RUN = `kbtest-${Date.now()}`;

/** Fixture text. Two countries say overlapping things about the same topic. */
const FIXTURES = [
  {
    key: 'ca-documents',
    country: 'CA',
    text:
      'Documents you must provide > You must provide a valid passport and bank statements ' +
      'covering the last six months for a visitor visa to Canada.',
    status: 'current',
    formCodes: ['IMM 5257'],
  },
  {
    key: 'ca-fees',
    country: 'CA',
    text: 'Fees > The application fee for a visitor visa is 100 CAD and is not refundable.',
    status: 'current',
    formCodes: [],
  },
  {
    key: 'ca-old-fees',
    country: 'CA',
    text: 'Fees > The application fee for a visitor visa is 85 CAD and is not refundable.',
    status: 'superseded',
    formCodes: [],
  },
  {
    key: 'au-documents',
    country: 'AU',
    text:
      'Documents you must provide > You must provide a valid passport and bank statements ' +
      'covering the last six months for a visitor visa to Australia.',
    status: 'current',
    formCodes: [],
  },
];

describeIf('kb_search_hybrid', () => {
  jest.setTimeout(60_000);

  let admin: SupabaseClient;
  const countryIds: Record<string, string> = {};
  const chunkIds: Record<string, string> = {};
  let visaTypeId = '';

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Two throwaway countries with a pseudo-code, so nothing collides with the
    // real registry and cleanup is unambiguous.
    for (const code of ['CA', 'AU']) {
      const pseudo = `ZZ${code}`;
      const { data, error } = await admin
        .from('visa_countries')
        .upsert(
          {
            code: pseudo,
            name: `${RUN} ${code}`,
            slug: `${RUN.toLowerCase()}-${code.toLowerCase()}`,
          },
          { onConflict: 'code' },
        )
        .select('id')
        .single();
      if (error) throw new Error(`country seed failed: ${error.message}`);
      countryIds[code] = data.id;
    }

    const { data: vt, error: vtErr } = await admin
      .from('visa_types')
      .upsert(
        {
          country_id: countryIds.CA,
          visaai_id: `${RUN.toLowerCase()}-visitor`,
          category: 'visitor',
          official_name: 'Test visitor visa',
          slug: 'visitor',
        },
        { onConflict: 'visaai_id' },
      )
      .select('id')
      .single();
    if (vtErr) throw new Error(`visa type seed failed: ${vtErr.message}`);
    visaTypeId = vt.id;

    // One source + version per country.
    const sourceIds: Record<string, string> = {};
    const versionIds: Record<string, string> = {};
    for (const code of ['CA', 'AU']) {
      // Plain insert, not upsert: the registry's uniqueness on visa_sources is
      // (source_url, visa_type_id) since 20260820160000, and the URL is
      // per-run unique here anyway.
      const { data: src, error: srcErr } = await admin
        .from('visa_sources')
        .insert({
          country_id: countryIds[code],
          role: 'documents',
          authority: `${RUN} authority ${code}`,
          authority_rank: 1,
          canonical_url: `https://example.test/${RUN}/${code}`,
          source_url: `https://example.test/${RUN}/${code}`,
          language: 'en',
        })
        .select('id')
        .single();
      if (srcErr) throw new Error(`source seed failed: ${srcErr.message}`);
      sourceIds[code] = src.id;

      const { data: ver, error: verErr } = await admin
        .from('visa_source_versions')
        .insert({
          source_id: sourceIds[code],
          version_number: 1,
          raw_sha256: hashText(`${RUN}-raw-${code}`),
          normalized_sha256: hashText(`${RUN}-norm-${code}`),
          is_active: true,
        })
        .select('id')
        .single();
      if (verErr) throw new Error(`version seed failed: ${verErr.message}`);
      versionIds[code] = ver.id;
    }

    // One extraction per country, so kb_chunks can reference a section-free row.
    const extractionIds: Record<string, string> = {};
    for (const code of ['CA', 'AU']) {
      const { data, error } = await admin
        .from('kb_extractions')
        .insert({
          source_version_id: versionIds[code],
          extractor: 'test',
          extractor_version: 'v1',
          text_sha256: hashText(`${RUN}-${code}`),
          char_count: 10,
          text: `${RUN} ${code}`,
          language: 'en',
        })
        .select('id')
        .single();
      if (error) throw new Error(`extraction seed failed: ${error.message}`);
      extractionIds[code] = data.id;
    }

    // Chunk texts, chunks and embeddings.
    let ordinal = 0;
    for (const f of FIXTURES) {
      const sha = hashText(f.text);
      await admin.from('kb_chunk_texts').upsert(
        {
          sha256: sha,
          text: f.text,
          char_count: f.text.length,
          token_estimate: Math.ceil(f.text.length / 4),
        },
        { onConflict: 'sha256', ignoreDuplicates: true },
      );

      await admin.from('kb_embeddings').upsert(
        {
          text_sha256: sha,
          model: MODEL,
          dimensions: 1536,
          embedding: toVectorLiteral(embedDeterministic(f.text)),
        },
        { onConflict: 'text_sha256,model', ignoreDuplicates: true },
      );

      const { data, error } = await admin
        .from('kb_chunks')
        .insert({
          extraction_id: extractionIds[f.country],
          source_version_id: versionIds[f.country],
          source_id: sourceIds[f.country],
          text_sha256: sha,
          ordinal: ordinal++,
          country_id: countryIds[f.country],
          visa_type_id: f.country === 'CA' ? visaTypeId : null,
          authority_rank: 1,
          source_role: 'documents',
          language: 'en',
          heading_path: ['Documents'],
          form_codes: f.formCodes,
          status: f.status,
        })
        .select('id')
        .single();
      if (error)
        throw new Error(`chunk seed failed (${f.key}): ${error.message}`);
      chunkIds[f.key] = data.id;
    }
  });

  afterAll(async () => {
    if (!admin) return;
    // Cascades take chunks, extractions and versions with the countries.
    for (const code of ['CA', 'AU']) {
      await admin.from('visa_countries').delete().eq('code', `ZZ${code}`);
    }
    // kb_chunk_texts is referenced ON DELETE RESTRICT, so it is NOT cascaded —
    // that is deliberate (a chunk must never lose its text), and it means the
    // test has to remove its own rows or leave residue behind.
    const shas = [...new Set(FIXTURES.map((f) => hashText(f.text)))];
    await admin.from('kb_embeddings').delete().in('text_sha256', shas);
    await admin.from('kb_chunk_texts').delete().in('sha256', shas);
  });

  const search = async (
    query: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const { data, error } = await admin.rpc('kb_search_hybrid', {
      p_query_text: query,
      p_query_embedding: toVectorLiteral(embedDeterministic(query)),
      p_embedding_model: MODEL,
      p_country_id: null,
      p_visa_type_id: null,
      p_languages: null,
      p_form_codes: null,
      p_include_superseded: false,
      p_as_of: null,
      p_limit: 20,
      p_candidate_limit: 100,
      p_rrf_k: 60,
      ...overrides,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<Record<string, unknown>>;
  };

  const ours = (rows: Array<Record<string, unknown>>) =>
    rows.filter((r) => Object.values(chunkIds).includes(String(r.chunk_id)));

  it('never returns another country when a country filter is set', async () => {
    // The single most important property in this system.
    const rows = await search('what documents must I provide', {
      p_country_id: countryIds.CA,
    });
    const ids = ours(rows).map((r) => String(r.chunk_id));

    expect(ids).toContain(chunkIds['ca-documents']);
    expect(ids).not.toContain(chunkIds['au-documents']);
    for (const r of rows) expect(String(r.country_id)).toBe(countryIds.CA);
  });

  it('applies the filter inside the ranking arms, not after them', async () => {
    // With a 1-row limit, a filter applied after ranking would return the
    // globally best match — which for this query is the Australian passage in
    // half the orderings. Inside the arm, the top result is always Canadian.
    const rows = await search(
      'valid passport and bank statements for six months',
      {
        p_country_id: countryIds.CA,
        p_limit: 1,
      },
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].country_id)).toBe(countryIds.CA);
  });

  it('excludes superseded content by default', async () => {
    const rows = await search('application fee for a visitor visa', {
      p_country_id: countryIds.CA,
    });
    const ids = ours(rows).map((r) => String(r.chunk_id));
    expect(ids).toContain(chunkIds['ca-fees']);
    expect(ids).not.toContain(chunkIds['ca-old-fees']);
  });

  it('returns superseded content only when explicitly asked', async () => {
    const rows = await search('application fee for a visitor visa', {
      p_country_id: countryIds.CA,
      p_include_superseded: true,
    });
    const ids = ours(rows).map((r) => String(r.chunk_id));
    expect(ids).toContain(chunkIds['ca-old-fees']);
  });

  it('fuses both arms — a hit found by both ranks above one found by either', async () => {
    const rows = await search('valid passport bank statements', {
      p_country_id: countryIds.CA,
    });
    const top = ours(rows)[0];
    expect(top.vector_rank).not.toBeNull();
    expect(top.lexical_rank).not.toBeNull();
    expect(Number(top.score)).toBeGreaterThan(0);
  });

  it('still answers when the query has no lexical match at all', async () => {
    // Vector-only path: nonsense tokens, but the embedding still lands nearby.
    const rows = await search('zzzz qqqq wwww', {
      p_country_id: countryIds.CA,
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('still answers when no embedding is supplied', async () => {
    // Lexical-only path: the degraded mode the service falls back to.
    const rows = await search('passport', {
      p_country_id: countryIds.CA,
      p_query_embedding: null,
    });
    expect(ours(rows).length).toBeGreaterThan(0);
    expect(ours(rows)[0].vector_rank).toBeNull();
  });

  it('filters on an exact official form code', async () => {
    const rows = await search('IMM 5257', {
      p_country_id: countryIds.CA,
      p_form_codes: ['IMM 5257'],
    });
    const ids = ours(rows).map((r) => String(r.chunk_id));
    expect(ids).toEqual([chunkIds['ca-documents']]);
  });

  it('keeps a country-level chunk in scope for a specific visa type', async () => {
    const rows = await search('valid passport', {
      p_country_id: countryIds.CA,
      p_visa_type_id: visaTypeId,
    });
    expect(ours(rows).length).toBeGreaterThan(0);
  });

  it('reports the corpus size and the deduplication saving', async () => {
    // Asserted here, while the fixtures still exist — the cleanup below drops
    // them. `naive_chunk_chars >= distinct_chunk_chars` is the invariant that
    // matters: content addressing can only ever save, never cost.
    const { data, error } = await admin
      .from('kb_storage_stats')
      .select('*')
      .maybeSingle();
    expect(error).toBeNull();
    const stats = (data ?? {}) as Record<string, number>;
    expect(Number(stats.chunk_count)).toBeGreaterThanOrEqual(FIXTURES.length);
    expect(Number(stats.embedding_count)).toBeGreaterThanOrEqual(1);
    expect(Number(stats.naive_chunk_chars)).toBeGreaterThanOrEqual(
      Number(stats.distinct_chunk_chars),
    );
  });

  it('stores one chunk text per distinct text even across countries', async () => {
    // The two document fixtures differ only in the country name, so they are
    // distinct texts; a byte-identical pair would be one row. Verified by
    // counting the rows our fixtures actually created.
    const shas = [...new Set(FIXTURES.map((f) => hashText(f.text)))];
    const { count } = await admin
      .from('kb_chunk_texts')
      .select('sha256', { count: 'exact', head: true })
      .in('sha256', shas);
    expect(count).toBe(shas.length);
  });

  it('returns the citation columns the answer layer needs', async () => {
    const rows = await search('valid passport', {
      p_country_id: countryIds.CA,
    });
    const row = ours(rows)[0];
    expect(row.source_version_id).toBeTruthy();
    expect(row.source_id).toBeTruthy();
    expect(row.authority_rank).toBe(1);
    expect(row.heading_path).toEqual(['Documents']);
  });
});

describeIf('knowledge schema guarantees', () => {
  jest.setTimeout(60_000);
  let admin: SupabaseClient;

  beforeAll(() => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('stores one row per distinct chunk text, whatever the insert order', async () => {
    const text = `${RUN} dedup probe: you must have a valid passport`;
    const sha = hashText(text);
    const row = {
      sha256: sha,
      text,
      char_count: text.length,
      token_estimate: 10,
    };

    await admin
      .from('kb_chunk_texts')
      .upsert(row, { onConflict: 'sha256', ignoreDuplicates: true });
    await admin
      .from('kb_chunk_texts')
      .upsert(row, { onConflict: 'sha256', ignoreDuplicates: true });

    const { count } = await admin
      .from('kb_chunk_texts')
      .select('sha256', { count: 'exact', head: true })
      .eq('sha256', sha);
    expect(count).toBe(1);

    await admin.from('kb_chunk_texts').delete().eq('sha256', sha);
  });

  it('refuses a second embedding for the same (text, model)', async () => {
    const text = `${RUN} embedding uniqueness probe`;
    const sha = hashText(text);
    await admin
      .from('kb_chunk_texts')
      .upsert(
        { sha256: sha, text, char_count: text.length, token_estimate: 10 },
        { onConflict: 'sha256' },
      );

    const vec = toVectorLiteral(embedDeterministic(text));
    const first = await admin.from('kb_embeddings').insert({
      text_sha256: sha,
      model: MODEL,
      dimensions: 1536,
      embedding: vec,
    });
    expect(first.error).toBeNull();

    const second = await admin.from('kb_embeddings').insert({
      text_sha256: sha,
      model: MODEL,
      dimensions: 1536,
      embedding: vec,
    });
    expect(second.error).not.toBeNull();
    expect(second.error!.message).toMatch(/duplicate key/i);

    await admin.from('kb_chunk_texts').delete().eq('sha256', sha);
  });

  it('allows the same text under a different model — that is how a re-index works', async () => {
    const text = `${RUN} multi-model probe`;
    const sha = hashText(text);
    await admin
      .from('kb_chunk_texts')
      .upsert(
        { sha256: sha, text, char_count: text.length, token_estimate: 10 },
        { onConflict: 'sha256' },
      );

    const vec = toVectorLiteral(embedDeterministic(text));
    const a = await admin.from('kb_embeddings').insert({
      text_sha256: sha,
      model: MODEL,
      dimensions: 1536,
      embedding: vec,
    });
    const b = await admin.from('kb_embeddings').insert({
      text_sha256: sha,
      model: `${MODEL}-next`,
      dimensions: 1536,
      embedding: vec,
    });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    await admin.from('kb_chunk_texts').delete().eq('sha256', sha);
  });

  it('rejects a chunk with no source version — private documents cannot enter the corpus', async () => {
    const { error } = await admin.from('kb_chunks').insert({
      extraction_id: null,
      source_version_id: null,
      source_id: null,
      text_sha256: hashText('orphan'),
      ordinal: 0,
      country_id: null,
      authority_rank: 1,
      source_role: 'documents',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/null value|violates not-null/i);
  });

  it('seeds a corpus-wide default freshness policy and volatile role policies', async () => {
    const { data } = await admin
      .from('kb_freshness_policies')
      .select('source_role, risk_class, auto_promote')
      .eq('active', true);
    const rows = (data ?? []) as Array<{
      source_role: string | null;
      risk_class: string;
      auto_promote: boolean;
    }>;

    expect(
      rows.some((r) => r.source_role === null && r.risk_class === 'standard'),
    ).toBe(true);
    expect(rows.find((r) => r.source_role === 'fees')!.risk_class).toBe(
      'volatile',
    );
    // Volatile content can never auto-promote — enforced by a check constraint.
    for (const r of rows.filter((x) => x.risk_class === 'volatile')) {
      expect(r.auto_promote).toBe(false);
    }
  });
});

const describeAnon = CONFIGURED && ANON_KEY ? describe : describe.skip;

describeAnon('knowledge RLS', () => {
  jest.setTimeout(60_000);
  let anon: SupabaseClient;

  beforeAll(() => {
    anon = createClient(URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('denies anon any read of the embedding vectors', async () => {
    // A lossy but non-trivial reconstruction surface with no client-side use.
    const { data } = await anon
      .from('kb_embeddings')
      .select('text_sha256')
      .limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it('denies anon the similarity-search function', async () => {
    const { error } = await anon.rpc('kb_search_hybrid', {
      p_query_text: 'passport',
      p_query_embedding: toVectorLiteral(embedDeterministic('passport')),
      p_embedding_model: MODEL,
    });
    expect(error).not.toBeNull();
  });

  it('denies anon any read of retrieval logs', async () => {
    const { data } = await anon.from('kb_retrieval_logs').select('id').limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it('denies anon any read of the operational tables', async () => {
    for (const table of [
      'kb_ingestion_jobs',
      'kb_quarantine',
      'kb_review_queue',
      'kb_extractions',
    ]) {
      const { data } = await anon.from(table).select('id').limit(1);
      expect(data ?? []).toHaveLength(0);
    }
  });

  it('refuses an anon write to the corpus', async () => {
    const { error } = await anon.from('kb_chunk_texts').insert({
      sha256: hashText(`${RUN}-anon-write`),
      text: 'injected',
      char_count: 8,
      token_estimate: 2,
    });
    expect(error).not.toBeNull();
  });
});
