/**
 * Retrieval benchmark and coverage report.
 *
 * WHAT IT MEASURES, and why each one is here rather than a proxy for it:
 *
 *   isolation   for every benchmark question, does any returned passage come
 *               from a country or visa type other than the one asked about?
 *               This is the only metric that must be 100%. Every other number
 *               is a quality target; this one is a correctness bound.
 *   hit@k       did any returned passage contain the expected evidence? The
 *               expectation is a SUBSTRING the government page actually
 *               publishes, not a hand-written ideal answer — an "ideal answer"
 *               benchmark measures the grader's taste, not the retriever.
 *   mrr         where in the ranking it landed, so a change that moves the
 *               right passage from position 8 to position 1 is visible.
 *   refusal     for questions the corpus genuinely cannot answer, did it
 *               return nothing? A retriever that always returns something
 *               scores well on hit@k and is dangerous.
 *   latency     p50/p95, cached and uncached, excluding model time.
 *
 * The question set is GENERATED from the registry — one per indexed country
 * and visa type, plus every form code the corpus actually contains — so
 * coverage grows with the corpus instead of decaying against a hand-written
 * list nobody updates. Hand-written probes are layered on top for the specific
 * failures worth pinning.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [OPENAI_API_KEY=...] \
 *     npx ts-node -P tsconfig.json scripts/knowledge-benchmark.ts \
 *       [--limit N] [--out report.json] [--k 10]
 */
import './lib/node20-websocket';
import { writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { KnowledgeRetrievalService } from '../src/modules/knowledge/knowledge-retrieval.service';
import { inBatches } from '../src/modules/knowledge/pg-batch';
import {
  DeterministicEmbeddingProvider,
  OpenAiEmbeddingProvider,
  type EmbeddingProvider,
} from '../src/modules/knowledge/embeddings/embedding.provider';

interface BenchQuestion {
  id: string;
  question: string;
  countryId: string | null;
  countryCode: string;
  visaTypeId: string | null;
  visaTypeName: string | null;
  /** Lowercased substrings, any of which counts as the right evidence. */
  expectAny: string[];
  /**
   * For a form-code question, the CANONICAL code the chunk must carry.
   *
   * Scored against `kb_chunks.form_codes` rather than against the chunk text,
   * because the two are deliberately different: the page writes "Form I-327",
   * the canonical identity is "I 327", and the whole point of extracting codes
   * at chunk time is that a user typing either one matches. A substring check
   * on the text scores that correct behaviour as a miss.
   */
  expectFormCode?: string;
  /** True when the corpus should have nothing and retrieval should return none. */
  expectNone?: boolean;
  kind: 'coverage' | 'form_code' | 'isolation' | 'unanswerable';
}

interface QuestionResult {
  id: string;
  question: string;
  kind: string;
  countryCode: string;
  returned: number;
  hit: boolean;
  rank: number | null;
  crossJurisdiction: number;
  strategy: string;
  latencyMs: number;
  topCitation: string | null;
}

function buildProvider(): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.KNOWLEDGE_EMBEDDING_PROVIDER === 'deterministic') {
    return new DeterministicEmbeddingProvider();
  }
  return new OpenAiEmbeddingProvider(
    apiKey,
    process.env.KNOWLEDGE_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  );
}

/**
 * Build the question set from what is actually indexed.
 *
 * The expectations come from the corpus itself: the most distinctive terms of
 * a real chunk under that route. That keeps the benchmark honest — it asserts
 * the retriever can find text the government published, not that it agrees
 * with a fixture written months ago.
 */
async function buildQuestions(
  db: SupabaseClient,
  limit: number,
): Promise<BenchQuestion[]> {
  const questions: BenchQuestion[] = [];

  const { data: chunkRows } = await db
    .from('kb_chunks')
    .select(
      'id, country_id, visa_type_id, source_role, form_codes, text_sha256, heading_path',
    )
    .eq('status', 'current')
    .limit(20_000);
  const chunks = (chunkRows ?? []) as Array<{
    country_id: string;
    visa_type_id: string | null;
    source_role: string;
    form_codes: string[];
    text_sha256: string;
    heading_path: string[];
  }>;

  if (chunks.length === 0) return questions;

  // Every lookup goes through inBatches: an unbatched `.in()` over a few
  // hundred sha256 hashes returns `414 URI Too Long`, which supabase-js
  // surfaces as an empty result — and an empty result here produces a
  // benchmark that silently scores nothing. See pg-batch.ts.
  const shas = [...new Set(chunks.map((c) => c.text_sha256))].slice(0, 5000);
  const textRows = await inBatches<{ sha256: string; text: string }>(
    shas,
    (b) => db.from('kb_chunk_texts').select('sha256, text').in('sha256', b),
    'benchmark chunk text lookup',
  );
  const textBySha = new Map(textRows.map((r) => [r.sha256, r.text]));

  const countryIds = [...new Set(chunks.map((c) => c.country_id))];
  const countryRows = await inBatches<{
    id: string;
    code: string;
    name: string;
  }>(
    countryIds,
    (b) => db.from('visa_countries').select('id, code, name').in('id', b),
    'benchmark country lookup',
  );
  const countries = new Map(countryRows.map((c) => [c.id, c]));

  const visaTypeIds = [
    ...new Set(chunks.map((c) => c.visa_type_id).filter(Boolean)),
  ] as string[];
  const typeRows = await inBatches<{ id: string; official_name: string }>(
    visaTypeIds,
    (b) => db.from('visa_types').select('id, official_name').in('id', b),
    'benchmark visa type lookup',
  );
  const types = new Map(typeRows.map((t) => [t.id, t]));

  // One coverage question per (country, visa type) that has content, asked in
  // the words an applicant would use.
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const key = `${chunk.country_id}|${chunk.visa_type_id ?? ''}`;
    if (seen.has(key)) continue;
    const country = countries.get(chunk.country_id);
    if (!country) continue;
    const text = textBySha.get(chunk.text_sha256);
    if (!text || text.length < 120) continue;
    seen.add(key);

    const typeName = chunk.visa_type_id
      ? (types.get(chunk.visa_type_id)?.official_name ?? null)
      : null;
    const subject = typeName ?? `a visa for ${country.name}`;

    questions.push({
      id: `coverage:${key}`,
      question: `What documents and requirements apply to ${subject}?`,
      countryId: chunk.country_id,
      countryCode: country.code,
      visaTypeId: chunk.visa_type_id,
      visaTypeName: typeName,
      expectAny: distinctiveTerms(text),
      kind: 'coverage',
    });
    if (questions.length >= limit) break;
  }

  // One exact-code question per official form the corpus actually contains.
  const formCodes = [...new Set(chunks.flatMap((c) => c.form_codes))].slice(
    0,
    40,
  );
  for (const code of formCodes) {
    const owner = chunks.find((c) => c.form_codes.includes(code))!;
    const country = countries.get(owner.country_id);
    if (!country) continue;
    questions.push({
      id: `form:${code}`,
      question: `What is ${code}?`,
      countryId: owner.country_id,
      countryCode: country.code,
      visaTypeId: null,
      visaTypeName: null,
      expectAny: [code.toLowerCase()],
      expectFormCode: code,
      kind: 'form_code',
    });
  }

  // Isolation probes: ask each country a question phrased for ANOTHER country,
  // scoped to the first. Nothing from the other may come back.
  const codes = [...countries.values()];
  for (let i = 0; i < Math.min(codes.length, 8); i++) {
    const self = codes[i];
    const other = codes[(i + 1) % codes.length];
    if (self.id === other.id) continue;
    questions.push({
      id: `isolation:${self.code}-vs-${other.code}`,
      question: `What are the visa requirements for ${other.name}?`,
      countryId: self.id,
      countryCode: self.code,
      visaTypeId: null,
      visaTypeName: null,
      expectAny: [],
      kind: 'isolation',
    });
  }

  // Questions the corpus cannot answer. A retriever that always returns
  // something scores well on hit@k and is dangerous.
  const first = codes[0];
  if (first) {
    for (const q of [
      'What is the average rainfall in the capital city?',
      'Which cryptocurrency does the immigration department accept for fees?',
      'What is the visa requirement for travel to the Moon?',
    ]) {
      questions.push({
        id: `unanswerable:${q.slice(0, 20)}`,
        question: q,
        countryId: first.id,
        countryCode: first.code,
        visaTypeId: null,
        visaTypeName: null,
        expectAny: [],
        expectNone: true,
        kind: 'unanswerable',
      });
    }
  }

  return questions;
}

/**
 * The distinctive terms of a passage: the longest words that are not corpus-wide
 * boilerplate. Used as the "did it find the right thing" expectation, so the
 * benchmark asserts against text the government published rather than against a
 * hand-written ideal.
 */
function distinctiveTerms(text: string): string[] {
  const COMMON = new Set([
    'the',
    'and',
    'you',
    'your',
    'must',
    'for',
    'with',
    'this',
    'that',
    'from',
    'have',
    'will',
    'are',
    'not',
    'can',
    'may',
    'apply',
    'application',
    'visa',
    'documents',
    'document',
    'requirements',
    'need',
    'also',
    'more',
    'about',
    'information',
    'page',
    'canada',
    'government',
    'services',
    'please',
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 6 && !COMMON.has(w));
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 5)
    .map(([w]) => w);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');

  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limit = Number(get('--limit') ?? 200);
  const k = Number(get('--k') ?? 10);
  const out = get('--out');

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const embeddings = buildProvider();
  const retrieval = new KnowledgeRetrievalService(db, embeddings);

  const questions = await buildQuestions(db, limit);
  if (questions.length === 0) {
    console.log(
      JSON.stringify(
        { error: 'corpus is empty — run knowledge-ingest first' },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const results: QuestionResult[] = [];
  const coldLatencies: number[] = [];
  const warmLatencies: number[] = [];

  for (const q of questions) {
    const cold = await retrieval.search(
      q.question,
      {
        countryId: q.countryId ?? undefined,
        visaTypeId: q.visaTypeId ?? undefined,
      },
      { limit: k, skipLogging: true },
    );
    coldLatencies.push(cold.latencyMs);

    // Second pass: same query, so Postgres has the pages warm. Reported apart
    // because a p95 measured only on a warm cache is a number that never
    // occurs in production.
    const warm = await retrieval.search(
      q.question,
      {
        countryId: q.countryId ?? undefined,
        visaTypeId: q.visaTypeId ?? undefined,
      },
      { limit: k, skipLogging: true },
    );
    warmLatencies.push(warm.latencyMs);

    const crossJurisdiction = q.countryId
      ? cold.chunks.filter((c) => c.countryId !== q.countryId).length
      : 0;

    let rank: number | null = null;
    if (q.expectFormCode) {
      const idx = cold.chunks.findIndex((c) =>
        c.formCodes.includes(q.expectFormCode!),
      );
      rank = idx >= 0 ? idx + 1 : null;
    } else if (q.expectAny.length > 0) {
      const idx = cold.chunks.findIndex((c) =>
        q.expectAny.some((term) => c.text.toLowerCase().includes(term)),
      );
      rank = idx >= 0 ? idx + 1 : null;
    }

    results.push({
      id: q.id,
      question: q.question,
      kind: q.kind,
      countryCode: q.countryCode,
      returned: cold.chunks.length,
      hit: q.expectNone ? cold.chunks.length === 0 : rank !== null,
      rank,
      crossJurisdiction,
      strategy: cold.strategy,
      latencyMs: cold.latencyMs,
      topCitation: cold.chunks[0]?.citation?.url ?? null,
    });
  }

  const byKind = (kind: string) => results.filter((r) => r.kind === kind);
  const scored = results.filter(
    (r) => r.kind === 'coverage' || r.kind === 'form_code',
  );
  const hits = scored.filter((r) => r.hit);
  const mrr =
    scored.length === 0
      ? 0
      : scored.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) /
        scored.length;

  const leaks = results.filter((r) => r.crossJurisdiction > 0);

  const report = {
    generatedAt: new Date().toISOString(),
    embeddingModel: embeddings.model,
    k,
    questions: results.length,
    isolation: {
      // The one metric that must be perfect.
      questionsWithCrossJurisdictionResult: leaks.length,
      passed: leaks.length === 0,
      offenders: leaks
        .slice(0, 10)
        .map((r) => ({ id: r.id, count: r.crossJurisdiction })),
    },
    relevance: {
      scoredQuestions: scored.length,
      [`hitAt${k}`]: scored.length
        ? Number((hits.length / scored.length).toFixed(4))
        : 0,
      mrr: Number(mrr.toFixed(4)),
      byKind: {
        coverage: rate(byKind('coverage')),
        formCode: rate(byKind('form_code')),
      },
    },
    refusal: {
      unanswerableQuestions: byKind('unanswerable').length,
      correctlyReturnedNothing: byKind('unanswerable').filter((r) => r.hit)
        .length,
      // Not asserted as a pass/fail: a lexical match on an unrelated word is a
      // retrieval result, and the ANSWER layer is what must refuse. Reported so
      // a regression in either is visible.
      note: 'retrieval may return weak matches; the answer layer refuses when grounding fails',
    },
    latencyMs: {
      uncached: {
        p50: percentile(coldLatencies, 0.5),
        p95: percentile(coldLatencies, 0.95),
      },
      warm: {
        p50: percentile(warmLatencies, 0.5),
        p95: percentile(warmLatencies, 0.95),
      },
    },
    misses: scored
      .filter((r) => !r.hit)
      .slice(0, 20)
      .map((r) => ({ id: r.id, question: r.question })),
    results,
  };

  const json = JSON.stringify(report, null, 2);
  if (out) {
    writeFileSync(out, json);
    process.stderr.write(`[knowledge-benchmark] wrote ${out}\n`);
  }
  console.log(json);

  // A jurisdiction leak fails the run. Everything else is a quality signal.
  if (!report.isolation.passed) process.exit(2);
}

function rate(rows: QuestionResult[]): {
  total: number;
  hit: number;
  rate: number;
} {
  const hit = rows.filter((r) => r.hit).length;
  return {
    total: rows.length,
    hit,
    rate: rows.length ? Number((hit / rows.length).toFixed(4)) : 0,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
