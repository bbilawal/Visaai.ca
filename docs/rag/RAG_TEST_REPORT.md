# Visa Knowledge System — test and benchmark report

Generated 2026-09-03. All figures are measured, not projected.

Environment: local Supabase stack (Postgres 17.6, pgvector), Node 24 on macOS.
Embedding model: `deterministic-hash-v1` — the offline provider. See §6 for
why the production model is not in these numbers.

---

## 1. Test totals

| Run | Suites | Tests | Failures |
|---|---:|---:|---:|
| **Baseline** (before any change) | 409 passed, 15 skipped | 3,200 passed, 51 skipped | 0 |
| **Final**, no database | 429 passed, 16 skipped | 3,565 passed, 73 skipped | 0 |
| **Final**, database live | **445 passed, 0 skipped** | **3,638 passed, 0 skipped** | **0** |

Net new: **+36 suites, +438 tests**. 365 of those are the knowledge module's own
unit suites; 22 are the SQL/RLS integration spec; the rest are integration
suites that were previously skipping for want of a database and now run.

Reproduce:

```bash
# unit only
pnpm --filter api test

# everything, including the DB-gated integration suites
eval "$(npx supabase@latest status -o env | sed 's/^/export /')"
SUPABASE_URL="$API_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
SUPABASE_ANON_KEY="$ANON_KEY" \
  pnpm --filter api exec jest --ci
```

### Knowledge module, by suite

| Suite | Tests | Covers |
|---|---:|---|
| `source-policy.spec.ts` | 19 | allowlisting, public-suffix matching, lookalike domains, credentials-in-URL, authority ordering |
| `mime.spec.ts` | 20 | magic-byte sniffing, OOXML flavour, declared/actual mismatch, CSV heuristic |
| `content-safety.spec.ts` | 18 | injection detection, false-positive resistance, regex re-entrancy, secret redaction, hidden-content stripping |
| `content-hash.spec.ts` | 13 | NFC normalisation, dedup identity, query-hash filter inclusion |
| `chunking.spec.ts` | 19 | heading boundaries, list/table integrity, header repetition, page boundaries, determinism |
| `form-codes.spec.ts` | 54 | per-authority extraction, canonicalisation, false positives, **round-trip invariant** |
| `language.spec.ts` | 9 | script ranges, ja/zh separation, `und` on low signal, hint handling |
| `extract/html.extractor.spec.ts` | 20 | heading paths, checklists, tables, chrome removal, invalid markup, date parsing |
| `extract/office.extractor.spec.ts` | 20 | CSV quoting, JSON flattening, feeds, cell rendering |
| `extract/pdf.extractor.spec.ts` | 13 | line reassembly, font-size headings, hyphen repair, page boundaries |
| `extract/index.spec.ts` | 9 | extractor selection, OCR fallback, confidence floor, loud failure |
| `rerank.spec.ts` | 17 | visa-type match, form pinning, superseded demotion, determinism, bounded influence |
| `answer-grounding.spec.ts` | 26 | citation checks, jurisdiction checks, quote verification, prohibited claims, refusals |
| `version-diff.spec.ts` | 11 | fee/duration changes, form withdrawal, requirement removal, classification |
| `embeddings/embedding.provider.spec.ts` | 15 | determinism, unit length, ordering, pgvector literal |
| `knowledge.dto.spec.ts` | 13 | strict validation, unknown-key rejection, bounds |
| `knowledge-ingestion.spec.ts` | 20 | end-to-end pipeline, idempotency, dedup, quarantine, supersession, redaction |
| `knowledge-retrieval.spec.ts` | 22 | filter propagation, strategy selection, degradation, citations, logging |
| `knowledge-answer.spec.ts` | 21 | grounded answers, every refusal path, prompt fencing, model-output parsing |
| `knowledge-freshness.spec.ts` | 17 | policy precedence, due detection, stale sweep, coverage gaps, change propagation |
| `test/knowledge-hybrid-search.spec.ts` | 22 | **real Postgres**: SQL filtering, RRF, RLS, unique indexes |
| **Total** | **365 + 22** | |

---

## 2. What the SQL integration spec proves

These are the properties a mocked client cannot test, because a mock has no
query planner, no constraints and no RLS.

| Property | Assertion |
|---|---|
| Jurisdiction isolation | with `p_country_id` set, **no** row from another country is returned |
| Filter is inside the ranking arms | with `p_limit: 1`, the single result is still the requested country — a post-filter would return the globally best match |
| Superseded excluded by default | the older fee passage is absent unless `p_include_superseded` |
| Superseded retrievable on request | history is queryable for diffing |
| RRF fuses both arms | the top hit carries both `vector_rank` and `lexical_rank` |
| Vector-only path | a query with no lexical match still returns results |
| Lexical-only path | a null embedding still returns results, with `vector_rank` null |
| Exact form code | `p_form_codes: ['IMM 5257']` returns exactly the chunk carrying it |
| Country-level scope | a chunk with `visa_type_id` null is in scope for a specific route |
| Chunk-text dedup | inserting the same text twice yields one row |
| Embedding uniqueness | a second `(text, model)` insert is rejected with `duplicate key` |
| Multi-model coexistence | the same text under a second model is accepted — this is how re-indexing works |
| **Private-document exclusion** | a chunk with a null `source_version_id` is **rejected by the schema** |
| Freshness seed | a corpus default exists; every `volatile` policy has `auto_promote = false` |
| RLS: embeddings | `anon` reads zero rows from `kb_embeddings` |
| RLS: search function | `anon` cannot execute `kb_search_hybrid` |
| RLS: retrieval logs | `anon` reads zero rows |
| RLS: operational tables | `anon` reads zero from jobs, quarantine, review, extractions |
| RLS: corpus is read-only | an `anon` insert into `kb_chunk_texts` is rejected |

---

## 3. Retrieval benchmark

Corpus: **1,242 current passages** from **67 real government pages** (Canada 749,
UK 390, US 103), fetched live through the production sync path.

Question set is **generated from the corpus**, so it grows with it: one coverage
question per (country, visa type) that has content, one exact-code question per
official form the corpus actually contains, cross-jurisdiction probes, and
unanswerable controls. Expectations come from the government text itself, not
from a hand-written ideal answer.

```
questions                 62
scored questions          56

isolation                 PASS  (0 questions returned another jurisdiction)
hit@10                    0.9643
MRR                       0.8948
  coverage questions      14/16   (0.875)
  form-code questions     40/40   (1.000)

latency (excl. model time)
  uncached  p50  17 ms   p95  30 ms
  warm      p50  17 ms   p95  34 ms
```

Reproduce:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... KNOWLEDGE_EMBEDDING_PROVIDER=deterministic \
  npx ts-node -P apps/api/tsconfig.json apps/api/scripts/knowledge-benchmark.ts --k 10
```

The script **exits non-zero on a jurisdiction leak** and only on that. Every
other number is a quality signal; isolation is a correctness bound.

### The two remaining misses, unfixed and reported

Both are GB coverage questions of the form *"What documents and requirements
apply to Family visas: apply, extend or switch?"*. The benchmark's expectation
is the five most distinctive words of **one specific chunk** under that route;
at k=10 the retriever returns ten other chunks from the same route, any of which
is a reasonable answer to a question that broad.

This is benchmark strictness, not a retrieval defect — and it is left failing
rather than loosened, because an expectation tuned until it passes measures
nothing. The honest reading of 0.875 on coverage is *"the retriever finds the
route reliably and the specific passage 14 times in 16"*.

---

## 4. Defects found and fixed during implementation

Each was found by a test or a benchmark run, not by inspection.

| # | Defect | How it was found | Fix |
|---|---|---|---|
| 1 | **`.in()` overflows the PostgREST request URI.** 500 sha256 hashes is ~33 KB of query string; the server returns `414`, supabase-js returns `{data: null, error}`, and every call site read `data ?? []` as "nothing found". Consequences: dedup reported as 0% on large documents, **already-embedded text re-embedded at cost**, and coverage reporting every visa type as a gap. | Benchmark generated zero coverage questions; instrumenting showed `URI too long` | `pg-batch.ts` — batches sized by **bytes**, and `inBatches` **throws** on error instead of returning empty. Applied at all 9 call sites. |
| 2 | **The provenance gate approved itself.** `registeredHosts` included the source's own URL, so every URL matched itself and the official-domain check passed unconditionally. A `visa_sources` row pointing at a blog would have been ingested and quoted as government policy. | `knowledge-ingestion.spec.ts` — "rejects a source whose URL is not a registered official host" | Exclude the row under test; compare against the country's declared authority domains plus **other** registered sources. Unvalidatable first-source case is allowed and flagged, not silently passed. |
| 3 | **Greedy regex ate the day digit from a page date.** `<?[^>]*>?` backtracked into "15 March 2026", capturing "5 March 2026" — a page date ten days early, silently. | `html.extractor.spec.ts` date test | Tag-skip is now a sequence of whole tags, `(?:<[^>]{0,200}>\s*)*` |
| 4 | **A trailing full stop defeated fee normalisation.** `£1,000.00.` normalised to `£1000.00.`, so the `.00` strip never matched and the same fee written two ways diffed as a **fee change** — a false material change on any page ending a sentence with a figure. | `version-diff.spec.ts` | Strip trailing punctuation before the `.00` suffix |
| 5 | **A processing-time change was classified as editorial churn.** Bigram similarity of "Processing takes 14 days." vs "…28 days." is 0.33, below the 0.6 reword threshold, so the pair was reported as one line removed and one added — losing the figure change entirely. | `version-diff.spec.ts` | Similarity is now `max(bigram, unigram)` Dice; the same pair scores 0.75 |
| 6 | **Spurious form code `FORM I`.** The Indian Roman-numeral pattern matched the "Form I" of "Form I-551", a US form cited on canada.ca's eTA page. | Corpus inspection after the first benchmark | Negative lookahead `(?![-\s]?\d)` |
| 7 | **The form-code detector could not recognise its own output.** Canonicalisation produces `O 1A`; the class patterns only accepted `O-1A`. A user typing the code the way the system *displays* it got no exact match. | Benchmark misses on `FORM 918` and `O 1A` | Separator `[-\s]?`, case-insensitive query scanning, and a **round-trip property test** over 20 codes |
| 8 | **Quarantine threshold too aggressive.** A single medium finding quarantined any page under 8 kB, so an editorial `TODO:` in a fee page removed the fee from the corpus. | `content-safety.spec.ts` | Requires a high-severity hit, or ≥3 non-low findings **and** density |
| 9 | **`raiseReview` relied on a column default it then queried.** The dedupe read filters on `state`; rows inserted without one were invisible to it, so every recurrence filed another ticket. | `knowledge-ingestion.spec.ts` dedup test | Set `state` and `occurrences` explicitly |
| 10 | **`String()` on untyped rows.** `String(null)` → `"null"` in review titles; `String(obj)` → `"[object Object]"`. | Lint (`no-base-to-string`), then read | `row-values.ts` — `asText` handles null explicitly and makes an unexpected object loud |
| 11 | **Test double masked a bug class.** `filter(Boolean)` does not narrow, so a null could reach an insert payload. | `tsc` | `flatMap` |

### Pre-existing defects found

| Finding | Evidence | Status |
|---|---|---|
| **The migration chain was not replayable from empty.** `supabase db reset` failed at `20260821120000_ca_visitor_visa_requirements.sql`: it binds requirements to a `visa_source_versions` row that **no migration creates** — versions come from the live sync job. 195 of 248 subsequent failures cascaded from this one cause. | `supabase db reset` output; `grep -ril "insert into public.visa_source_versions" supabase/migrations/` returned nothing | **Fixed** (2026-09-04) — `20260820170000` carries 306 real active versions exported from production and plants them through a trigger, since 72 later migrations register more sources; `20260903130000` removes the whole apparatus at the end of the chain. Sources no authority will serve us (migri.fi, immi.homeaffairs) are recorded in `visa_requirement_bootstrap_skips` and skipped rather than fabricated. 480 migrations now apply from empty with zero errors, reaching parity with production: 385 sources, 306 active versions, 2625 requirements, 192 visa types. See `MIGRATION_REPLAY.md`. |
| **`fetchSource` UTF-8-decoded every body**, destroying any non-text format. A PDF round-tripped through it is unparseable and hashes to a value unrelated to what was served. | Adding PDF support required binary bytes | **Fixed** — `readCappedBytes` returns bytes; `bodyBytes` added to the ok outcome; the decoded string the change-detection path has always seen is unchanged. |
| **`applications-update-rls.spec.ts` failed.** `admin.auth.verifyOtp()` signs the *admin* client in as the stranger, so the verification read ran under RLS and saw nothing. The test failed while RLS worked correctly. | Full run with DB env | **Fixed** — redeem the magic link on a separate client. |

---

## 5. Storage and deduplication, measured

```
blobs                          80   (all text/html; 5.34 MB logical)
extractions                    67
sections                    5,074
chunk instances             1,242
distinct chunk texts          892
embeddings                    892   (one model)

chunk text stored          440,614 chars
naive (per instance)       564,485 chars
deduplication saving          22.0%
```

Deduplication is a schema property, not a job: `kb_chunk_texts.sha256` is the
primary key, so 1,242 provenance records share 892 physical texts. The ratio
grows with corpus size — most shared text is cross-page boilerplate, and the
number of distinct boilerplate strings is roughly constant per authority.

**No source bytes are cached.** Every registered source has
`redistribution = 'unknown'`, which the pipeline treats as "do not
redistribute", so `kb_blobs.storage_path` is null throughout and
`blob_stored_bytes = blob_logical_bytes`. Compression is implemented and
exercised by unit tests; it has no production data to act on until an authority's
terms are reviewed.

### Idempotency, measured

A forced re-ingest of an unchanged corpus:

```
requested 12   ingested 12   quarantined 0   failed 0
chunks 213     reusedChunkTexts 213
embeddingsCreated 0   embeddingsReused 213
```

Zero embeddings recomputed. That is the invariant, observed rather than asserted.

---

## 6. What is NOT covered by these numbers

Stated plainly, because a benchmark that hides its gaps is worse than none.

- **The production embedding model was never exercised end to end.** The
  `OPENAI_API_KEY` in `apps/api/.env` returns `401 Incorrect API key provided`.
  Every retrieval number above is from `deterministic-hash-v1`, a hashed n-gram
  projection. It is sufficient to test the *pipeline* — fusion, filtering,
  ranking rules, isolation are all properties of the code — and it is **not**
  a measure of semantic retrieval quality. Re-run the benchmark with a working
  key before reading `hit@10` as a quality claim.
  - The failure path itself is verified: the 401 run left 213 chunks, **0
    chunks without a vector**, 12 `failed` job rows, and no partial corruption.
- **OCR is untested against a real scanned document.** The registry has no OCR
  provider configured, so the fallback is tested with a stub. The contract, the
  confidence floor and the loud-failure path are covered; a real scan is not.
- **PDF, DOCX and XLSX extraction have no live-document coverage.** All 80 blobs
  in the corpus are HTML — the only formats the currently-registered sources
  serve. The extractors are unit-tested against constructed inputs.
- **The corpus is 3 countries of 17 supported.** 189 routes have registered
  sources and nothing indexed; that is a run-length problem, not a capability
  gap, and it is reported by the coverage endpoint rather than hidden.
- **No load test.** Latency is measured on a 1,242-chunk corpus at concurrency 1.
  See `PERFORMANCE` in the architecture doc for the extrapolation caveats.
- **One transient full-suite failure.** Across five full runs with the database
  live, one reported 2 failed suites at 79.9 s wall clock (versus ~41 s
  typical); three subsequent runs were clean at 445/445. The failing suite names
  were not captured before the log was overwritten. Recorded as observed rather
  than explained away — most likely a DB-integration timeout under load, but
  that is a hypothesis, not a finding.
