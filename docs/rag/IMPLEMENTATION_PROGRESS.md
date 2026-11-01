# Implementation progress

Machine-readable checkpoint: [`checkpoint.json`](./checkpoint.json).
This file is the human-readable companion.

**Status: complete on the development stack.** Production apply and the
embedding credential are the two outstanding external actions
(`REMAINING_EXTERNAL_ACTIONS.md`).

---

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| 1 — Discover the existing system | done | baseline captured (409 suites / 3,200 tests, 0 failures); registry inventoried; three pre-existing defects found |
| 2 — Official source registry | done (already existed) | 385 sources, 353 rank-1; allowlist now **derived** from it rather than duplicated |
| 3 — Ingestion pipeline | done | 67 real government pages ingested end to end; 0 quarantined, 0 failed |
| 4 — Storage optimisation | done | content-addressed at 4 levels; 22.0% chunk-text dedup measured |
| 5 — Data model and migrations | done | 13 tables + 1 view + 1 function; forward→rollback→forward verified |
| 6 — Chunking, embeddings, retrieval | done | hybrid RRF in SQL; hit@10 0.964, MRR 0.895 |
| 7 — Grounded answer generation | done | claim-level citations; 8 rejection rules; 21 tests over every refusal path |
| 8 — Updates and change detection | done | incremental re-index; structured semantic diff; freshness policies seeded |
| 9 — Administration and observability | done | 9 admin endpoints + `/knowledge` screen; structured logs |
| 10 — Security and privacy | done | 14 controls; private-document exclusion enforced by schema, asserted by test |
| 11 — Testing | done | +438 tests; 445/445 suites, 3,638/3,638 tests pass with DB live |
| 12 — Performance | done | p95 30 ms uncached, against a 2,000 ms target |
| 13 — Deployment and recovery | done | dry-run mode, resumable backfill, verified rollback, runbook |

---

## What was built

### Database — `supabase/migrations/20260903120000_visa_knowledge_rag.sql` (1,137 lines)

13 tables, 1 view, 1 function, 1 storage bucket, 12 seeded freshness policies,
one additive column on `visa_source_versions`.

```
kb_blobs              content-addressed originals (sha256 PK)
kb_extractions        clean text per (version, extractor, extractor version)
kb_sections           headings, lists, tables, page numbers
kb_chunk_texts        one row per distinct passage (sha256 PK) + tsvector + trigram
kb_chunks             provenance + denormalised retrieval filters
kb_chunk_scopes       shared-content applicability (modelled, unpopulated)
kb_embeddings         one vector per (text, model) — PK is the dedup guarantee
kb_ingestion_jobs     idempotency-keyed, resumable
kb_freshness_policies per-risk-class cadence; volatile cannot auto-promote (CHECK)
kb_quarantine         what was refused, and why
kb_retrieval_logs     owner-scoped; the only table here with personal data
kb_answer_citations   claim → passage → version
kb_review_queue       dedupe_key collapses recurrence into an occurrence count
kb_storage_stats      view: corpus size and the deduplication saving
kb_search_hybrid()    vector + lexical, RRF-fused, filters inside both arms
```

Rollback: `supabase/migrations/rollback/20260903120000_visa_knowledge_rag.down.sql`,
verified forward → rollback → forward on a scratch database with the source
registry intact throughout.

### API — `apps/api/src/modules/knowledge/` (~15,000 lines with tests)

**Pure, no Nest context, directly testable** — these carry the safety properties:

| File | Job |
|---|---|
| `source-policy.ts` | official-domain allowlisting, public-suffix-aware matching, authority ordering |
| `mime.ts` | magic-byte sniffing; declared-type contradiction detection |
| `content-safety.ts` | injection scoring, secret redaction, active-content stripping |
| `content-hash.ts` | NFC-normalised content addressing, idempotency keys, query hashing |
| `chunking.ts` | structure-respecting chunking |
| `form-codes.ts` | per-authority code extraction, canonicalisation, query detection |
| `language.ts` | conservative detection; `und` rather than a guess |
| `rerank.ts` | deterministic feature reranker |
| `answer-grounding.ts` | the 8 rules that decide whether a claim may ship |
| `version-diff.ts` | structured semantic diff |
| `pg-batch.ts` | request-URI-safe `.in()` batching |
| `row-values.ts` | safe scalar reads from untyped rows |

**Extraction** — `extract/`: HTML, PDF, DOCX, spreadsheet, CSV/JSON/XML, OCR port.

**Services** — ingestion, retrieval, answer, freshness/coverage; plus
`claim-generator.ts` (the only file that knows a model exists), controllers,
BullMQ processor and scheduler.

### Operational scripts — `apps/api/scripts/`

| Script | Purpose |
|---|---|
| `knowledge-ingest.ts` | backfill/re-index, `--dry-run`, `--country`, bounded concurrency, resumable |
| `knowledge-benchmark.ts` | retrieval benchmark; exits non-zero on a jurisdiction leak |
| `knowledge-coverage.ts` | coverage + freshness report, `--raise`, `--markdown` |

### Web — `apps/web/app/[locale]/(admin)/knowledge/page.tsx`

Coverage (both gap classes separately), corpus and storage with the dedup
ratio, pipeline state, review queue, per-route table. Nav entry in all 15
locales.

### Files touched outside the module

| File | Change | Why |
|---|---|---|
| `visa-sync/source-fetcher.ts` | `readCappedBytes` + `bodyBytes` on the ok outcome | it UTF-8-decoded every body, destroying PDFs |
| `shared/ai/task-registry.ts` | added `visa_knowledge_answer` | model choice belongs in the registry, not a literal |
| `shared/queue/queue.constants.ts` | added `KNOWLEDGE_QUEUE` | |
| `app.module.ts` | registered `KnowledgeModule` | |
| `apps/api/package.json` | `pdfjs-dist`, `mammoth` | PDF and DOCX extraction |
| `test/applications-update-rls.spec.ts` | redeem the magic link on a separate client | the test signed the admin client in as the stranger |
| `apps/web/lib/api/admin.ts`, `nav-config.ts`, 15 locale files | admin client + nav | |

---

## Measured results

```
Tests            445/445 suites, 3,638/3,638 tests, 0 failures (DB live)
                 baseline was 409 suites / 3,200 tests

Coverage         17 supported countries, 192 active visa types
                 192/192 routes have a mapped official source
                 3 countries / 14 routes indexed in the dev corpus
                 189 routes reported as an indexing gap, 189 review items filed

Corpus           67 government pages, 5,074 sections, 1,242 passages
                 892 distinct texts, 892 embeddings, 0 quarantined
                 22.0% chunk-text deduplication

Retrieval        isolation PASS (0 cross-jurisdiction results, 62 questions)
                 hit@10 0.9643, MRR 0.8948
                 form-code questions 40/40
                 p50 17 ms, p95 30 ms uncached

Ingestion        p50 537 ms, p95 3,248 ms per page (fetch + extract + chunk + embed)
                 forced re-ingest: 0 embeddings recomputed, 213 reused
```

11 defects found and fixed during implementation, 3 pre-existing defects found
(2 fixed, 1 reported). All in `RAG_TEST_REPORT.md` §4.

---

## Resuming this work

`checkpoint.json` carries the machine-readable state. The next actions, in
order:

1. Supply a working `OPENAI_API_KEY`, re-embed, re-run the benchmark, and
   compare against the `deterministic-hash-v1` numbers.
2. Apply the migration to the VPS (check `vector` availability first).
3. Backfill the remaining 14 countries, **from the VPS**.
4. Decide `redistribution` per authority.

Nothing in that list needs a code change.
