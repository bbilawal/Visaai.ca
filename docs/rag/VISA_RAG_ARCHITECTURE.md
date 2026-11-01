# Visa Knowledge System — architecture

**Status:** implemented, running against the local development stack.
**Scope:** retrieval-augmented generation over official government immigration sources.

---

## 1. What already existed, and what this adds

VisaAI already had a serious **official-source registry**, added by
`20260820120000_visa_registry_core.sql`. It models:

| Table | What it holds |
|---|---|
| `visa_countries` | 196 destinations, their immigration authority and portals |
| `visa_types` | 192 active visa/permit categories as the authority defines them |
| `visa_sources` | 385 monitored official pages, ranked `authority_rank` 1–5 |
| `visa_source_versions` | immutable per-fetch snapshots, raw + normalized hash |
| `visa_source_checks` | per-run fetch outcomes |
| `visa_source_changes` | `detected → parsed → validated → tested → approved → active` |
| `visa_requirements` | typed, reviewed requirements, each citing a source **version** |

Plus a daily monitor (`modules/visa-sync/`) with SSRF-hardened fetching,
robots.txt evaluation, normalization and change classification.

**That set answers "what does the government require, and where did we read it".
It cannot answer "what does the page actually SAY about X"** — the sync hashes
normalized text for change detection and throws the text away.

This system adds exactly the missing layer and nothing else:

```
visa_sources ──▶ visa_source_versions ──▶ kb_blobs           (bytes, content-addressed)
                          │
                          ├──▶ kb_extractions                (clean text per extractor version)
                          │            │
                          │            ├──▶ kb_sections      (headings, lists, tables, pages)
                          │            │
                          │            └──▶ kb_chunks ───────▶ kb_chunk_texts (deduplicated)
                          │                     │                     │
                          │                     │                     └──▶ kb_embeddings
                          │                     │                            (one per text × model)
                          │                     └──▶ kb_chunk_scopes
                          │                            (shared content → other countries)
                          └──▶ kb_ingestion_jobs / kb_quarantine / kb_review_queue
```

Retrieval and answering sit on top:

```
question ──▶ KnowledgeRetrievalService ──▶ kb_search_hybrid (SQL)
                    │                            │
                    │                            ├── vector arm  (pgvector, cosine)
                    │                            └── lexical arm (tsvector, websearch)
                    │                                  └── RRF fusion, filters INSIDE both
                    ├──▶ rerank.ts (deterministic feature reranker)
                    └──▶ hydrateCitations()
                              │
                              ▼
             KnowledgeAnswerService ──▶ ClaimGenerator (model)
                              │
                              ▼
             answer-grounding.ts ──▶ accept / drop / refuse
```

---

## 2. The four deduplication points

Requirement: *"Store only one physical copy of identical content"* and
*"Store embeddings once per unique chunk and embedding-model version."*

Deduplication here is a **property of the schema**, not a job someone runs.

| Level | Key | What it saves |
|---|---|---|
| Bytes | `kb_blobs.sha256` (PK) | Two countries linking the same PDF store one copy |
| Extracted text | `kb_extractions (version, extractor, extractor_version)` unique | A parser re-run on an unchanged version is a no-op |
| Chunk text | `kb_chunk_texts.sha256` (PK) | Boilerplate on 300 pages is one row |
| Embeddings | `kb_embeddings (text_sha256, model)` (PK) | One vector per distinct text per model |

`kb_chunks` is the cheap provenance record that points at a shared
`kb_chunk_texts` row. Measured on the current dev corpus: **213 chunk instances
over 163 distinct texts** — 23% of chunk instances share text with another,
from only 12 pages of one authority. That ratio grows with corpus size.

**Content hashing is normalised before hashing text** (`content-hash.ts`): NFC,
LF line endings, collapsed intra-line whitespace. Without NFC, `é` typed two
ways hashes twice and the same French requirement is embedded twice.
`hashBytes` deliberately does **not** normalise — a blob hash must record
exactly what was served.

---

## 3. Ingestion pipeline

`modules/knowledge/knowledge-ingestion.service.ts`. One source version in,
retrievable chunks out.

1. **Provenance gate** (`source-policy.ts`) — the URL's host must match the
   country's declared authority domains or another registered source for that
   country. The row being checked is *excluded* from its own comparison set; a
   control its own subject can satisfy is not a control.
2. **Fetch** — normally reuses bytes the sync already downloaded. Only the
   backfill path fetches, through `visa-sync/source-fetcher.ts`, which keeps
   the SSRF controls (scheme allowlist, private-IP rejection, resolve-then-check
   DNS, per-hop redirect validation, size cap, timeout).
3. **Format sniff** (`mime.ts`) — magic bytes, never the extension, with the
   declared Content-Type used only to detect a *contradiction*. A container
   mismatch is a quarantine event.
4. **Blob store** — content-addressed. Uploaded only when
   `visa_sources.redistribution = 'permitted'`; otherwise hash + size only, and
   the citation points at the authority's own URL.
5. **Extract** (`extract/`) — HTML, PDF, DOCX, XLSX, CSV, JSON, XML/feeds, plus
   OCR for images and text-layer-less PDFs.
6. **Safety** (`content-safety.ts`) — secret redaction *before* hashing or
   storage, then a prompt-injection scan. High-severity findings quarantine.
7. **Language detection** (`language.ts`) — conservative; returns `und` rather
   than guessing on a fee table.
8. **Chunk** (`chunking.ts`) — semantic, never fixed-size. See §4.
9. **Persist** — chunk texts deduplicated, chunks written with denormalised
   filters and provenance.
10. **Embed** — only texts with no vector for the current model.
11. **Supersede** — previous versions' chunks marked `superseded`, never deleted.

**Every step is idempotent**, each for its own reason, which is what makes the
BullMQ retry policy safe on a pipeline that writes. A worker killed halfway
through embedding restarts and re-does only the missing embeddings.

**Ordering note:** chunks are written before embeddings. If the embedding
provider fails, the corpus is left with lexically-searchable chunks that the
vector arm cannot see — degraded, not incorrect — and the job is marked
`failed` so a retry completes it. Verified: a 401 from the embedding provider
mid-run left 213 chunks, 0 chunks without a vector (the previous model's
vectors still applied), and 12 `failed` job rows.

### Supported formats

| Format | Extractor | Structure preserved |
|---|---|---|
| HTML / XHTML | `html.extractor.ts` | headings, lists, checklists, tables (row-wise with header) |
| PDF | `pdf.extractor.ts` | page numbers, heading-by-font-size, paragraph merge, hyphen repair |
| DOCX | `office.extractor.ts` (mammoth → HTML path) | as HTML |
| XLSX / XLS | `office.extractor.ts` (exceljs) | header-per-cell serialisation |
| CSV | `office.extractor.ts` | quote-aware parse, header per cell |
| JSON | `office.extractor.ts` | flattened `path: value` lines |
| XML / RSS / Atom | `office.extractor.ts` | one section per feed entry |
| Images, scanned PDFs | OCR port | paragraphs only; no structure is invented |

---

## 4. Chunking

Fixed-size chunking is wrong for this corpus, concretely: a UK Standard Visitor
page has *"Documents you must provide"* (11 bullets) followed by *"Documents you
do not need to provide"* (4 bullets). Cut at 800 characters and one chunk
contains the tail of the first list and the heading of the second. Retrieved for
"do I need bank statements", it says yes and no in the same passage.

Rules, in priority order:

1. Never cross a heading boundary.
2. Never split a table row from its header.
3. Never split a list item.
4. Prefer to keep a whole list or table in one chunk.
5. Only then, inside a single oversized section, split on sentence boundaries.

**Overlap is structural, not character-based.** The heading path is repeated at
the top of every chunk (`Standard Visitor visa > Fees > Long-term visit: £490`)
rather than duplicating 200 characters of the previous chunk. Repeating the
heading makes a fragment self-describing to an embedding model; duplicating
characters mostly buys near-duplicate vectors.

Table chunks **always** carry their header row, whether or not the table split.

---

## 5. Retrieval

`kb_search_hybrid(...)` — a SQL function, deliberately.

**The jurisdiction filter is applied inside both ranking arms, not after the
union.** A top-k vector search over the whole corpus followed by a country
filter can return k results of which zero are for the requested country.
Filtering first means k results for the right country — the only correct
behaviour when the failure mode is quoting another country's rules. Verified
against a real Postgres in `test/knowledge-hybrid-search.spec.ts`.

**Reciprocal Rank Fusion, not a weighted score blend.** Cosine similarity and
`ts_rank_cd` are on incomparable scales whose distributions shift with corpus
size and query length; blending them needs a normalisation constant that must
be retuned whenever the corpus grows. RRF reads only *rank*, so it needs no
tuning and cannot be silently miscalibrated by a corpus change.

**`tsvector` config is `simple`, not `english`.** The corpus is multilingual by
definition, and it leaves official form codes (`IMM 5257`, `DS-160`) as literal
lexemes — which is what makes exact form-number search work at all.

### Three strategies, chosen from the query

| Strategy | When | Why |
|---|---|---|
| `form_code` | the question names an official form | Dense retrieval cannot separate `IMM 5257` from `IMM 5645` — same token shape, different number. An exact GIN lookup on `kb_chunks.form_codes` can. Hits are **pinned** above semantic results. |
| `hybrid` | default | vector + lexical, RRF-fused |
| `lexical` | embedding provider unavailable | degraded and reported as such, rather than a 500 on a page about visa rules |

### Reranking

`rerank.ts` — a deterministic feature function, not a cross-encoder. Three
reasons, in order of weight:

1. The signals that matter most here are **not semantic**: whether a passage is
   the visa type asked about, whether it is a checklist or a nav crumb, whether
   it names the form the user typed. A model would be asked to re-derive from
   text what the schema already states.
2. It is another inference call on the request path, which already has one.
3. **It can be tested.** Every rule is asserted with a fixed input and a fixed
   expected order. A model's ranking is only assertable statistically, and the
   failure being defended against — another country's rule ranking first — needs
   a hard guarantee.

Adjustments are bounded multipliers on the fused score, so no single signal can
invert a large relevance gap. Asserted by test: a checklist bonus cannot promote
an irrelevant passage over a well-matching one.

---

## 6. Grounded answer generation

The model is asked for **claims with citations**, never prose. Then
`answer-grounding.ts` — pure, tested, model-free — decides what may ship.

Every claim must pass:

| Check | Rejection reason |
|---|---|
| has at least one citation | `no citation` |
| cites evidence that was actually retrieved | `citation refers to evidence that was not retrieved` |
| every citation is the expected jurisdiction | `citation is from another jurisdiction` |
| not scoped to a different visa type | `citation is scoped to a different visa type` |
| not exclusively superseded evidence | `every citation is superseded content` |
| its quote appears verbatim in the cited chunk | `quoted text does not appear in the cited source` |
| mandatory claims carry a quote | `mandatory claim carries no supporting quote` |
| makes no approval promise | `prohibited claim (approval-guarantee)` |

**An uncited claim is dropped, not softened.** Marking it "unverified" and
keeping it is worse than it sounds: a person reading a visa answer does not
calibrate on a hedge, they read the sentence. If nothing survives, the system
refuses and names the official page.

Answers carry: mandatory/recommended separation, per-claim citations with
authority + URL + page number + version, a `freshnessAsOf` date (the oldest
`last_checked_at` across cited sources), a stale-source flag, and a standing
disclaimer.

---

## 7. Change detection and updates

`visa-sync` detects that a page changed. `KnowledgeFreshnessService` propagates
the consequence:

- **only that source's chunks are touched** — nothing else in the corpus is
  invalidated by one page moving
- a `reindex` job is queued with idempotency key `reindex:<versionId>`
- material/structural changes raise a `kb_review_queue` item; **cosmetic changes
  re-index and page nobody** — that is what the normalized hash is for
- the previously reviewed version keeps serving until a human approves

`version-diff.ts` produces a **structured** diff for the reviewer: which
monetary amounts changed and to what, which durations changed, which official
form codes appeared or disappeared, which requirement-shaped lines were added or
removed. A red-and-green character diff cannot answer "did a requirement change
or did the CMS reflow the page", which is the only question the reviewer has.

### Freshness policy

`kb_freshness_policies`, seeded and operator-tunable without a deploy. Most
specific match wins: visa type → country → source role → corpus default.

| Role | Risk | Check every | Stale after | Auto-promote |
|---|---|---|---|---|
| `fees`, `forms` | volatile | 6 h | 7 d | never |
| `processing_times`, `application` | volatile | 12 h | 14 d | never |
| `news` | volatile | 6 h | 7 d | never |
| `eligibility`, `requirements`, `documents` | standard | 1 d | 30 d | no |
| `landing`, `index` | standard | 3 d | 45 d | yes |
| `policy` | stable | 7 d | 180 d | yes |
| *(default)* | standard | 1 d | 30 d | no |

A CHECK constraint makes `risk_class = 'volatile' AND auto_promote = true`
unrepresentable — the safety rule is enforced by the schema, not by the worker.

---

## 8. Security

| Control | Where |
|---|---|
| SSRF (scheme, private IP, DNS rebinding, per-hop redirects, size, timeout) | `visa-sync/source-fetcher.ts` (reused) |
| Official-domain allowlisting | `source-policy.ts`, derived from the registry |
| Public-suffix-aware domain matching | `source-policy.ts` — `evil.gov.uk` ≠ `homeoffice.gov.uk` |
| robots.txt respect | `visa-sync/robots.ts` (reused); `disallowed` is never re-fetched |
| MIME validation | `mime.ts`; container mismatch quarantines |
| Download size cap | `DEFAULT_FETCH_POLICY.maxBytes` (8 MB) |
| Active-content stripping | `content-safety.ts` — script, style, iframe, comments, `display:none`, `aria-hidden` |
| Prompt-injection scan | `content-safety.ts`; high-severity quarantines |
| Prompt fencing | `shared/ai/untrusted.ts` (reused) — every passage fenced as DATA |
| Secret redaction | `content-safety.ts`, applied **before** hashing/storage/embedding |
| Encryption in transit / at rest | HTTPS fetch; Supabase storage + Postgres |
| Least privilege | RLS denies writes to every role; only the service-role worker writes |
| Admin RBAC | `JwtGuard` + `RolesGuard` + class-level `@RequireRole('admin')` |
| Tenant/user isolation | `kb_retrieval_logs` owner-scoped; `kb_answer_citations` via its parent |
| Audit logging | `kb_ingestion_jobs`, `kb_quarantine`, `kb_review_queue`, `visa_source_checks` |
| Rate limiting | `@Throttle` — 30/min search, 12/min answer |

### Private applicant documents are structurally excluded

`kb_chunks.source_version_id` is **NOT NULL** and references
`visa_source_versions`. A chunk cannot exist unless it came from an official
government source version. Nothing in the schema references `public.documents`.
That is the structural guarantee behind "applicant documents are never added to
the shared index" — asserted by an integration test that tries to insert an
orphan chunk and expects the write to fail.

### Embeddings are not readable by any client

`kb_embeddings` has RLS enabled and **no SELECT policy** for `anon` or
`authenticated`. Vectors are a lossy but non-trivial reconstruction surface with
no client-side use — retrieval happens server-side through `kb_search_hybrid`,
which `anon` also cannot execute.

---

## 9. Observability

`GET /admin/knowledge/status` returns, in one payload: storage stats with the
deduplication and compression ratios, job counts by state, open quarantine by
reason, open review items by severity and kind, and the last five sync runs.

Also: `/coverage`, `/sources`, `/jobs`, `/quarantine`, `/review`,
`/sources/:id/diff`, `POST /ingest` (with `dryRun`), `POST /sweep`.

Structured logs at the points that matter: quarantines at `warn`, missing
embedding provider at `error`, coverage gaps at `warn` with a count, blocked
sources at `warn` (not an error to retry).

---

## 10. Deliberate limitations

- **No cross-encoder reranker.** See §5. Revisit when a measured benchmark shows
  the deterministic reranker is the bottleneck.
- **No query-side LLM expansion.** Synonym expansion that changes legal intent
  is worse than a missed result; the lexical arm handles vocabulary variance.
- **OCR is a port with no default provider.** A scanned document without a
  configured provider is quarantined rather than silently dropped.
- **`kb_chunk_scopes` is modelled but not yet populated.** The Schengen bloc
  case needs a per-bloc mapping decision that belongs with the registry, not
  here. Retrieval already reads the table.
- **Answer caching is not implemented.** The retrieval layer caches nothing per
  answer, because a cache key cannot capture "the government has not changed
  this page since". Evidence is cached by content hash instead, where staleness
  is detectable.
