# Official source registry

**The registry is the database, not this document.** `visa_sources` and
`visa_countries` are the source of truth; this file records the *rules* the
registry enforces and a snapshot of what it currently holds.

A second hand-maintained list of domains would drift from the tables within a
release, and the drift would be invisible — which is why the ingestion
allowlist is **derived from the registry at run time** rather than written down
(`modules/knowledge/source-policy.ts`).

---

## 1. Authority hierarchy

The rank stored in `visa_sources.authority_rank`, constrained to 1–5. Anything
above 5 is not an official source and **cannot be stored** — the check
constraint makes it unrepresentable.

| Rank | Kind | Example |
|---|---|---|
| 1 | National immigration / home affairs department | IRCC, UKVI, USCIS, Migri, IND, UDI |
| 2 | Official government visa or application portal | eTA portal, ESTA, e-Visa portals |
| 3 | Official legislation or policy publication | statutes, policy manuals, gazettes |
| 4 | Official embassy or consulate | a mission's own visa page |
| 5 | Government-authorised visa application centre | VFS/TLS **only where the authority names them** |

**Rank is used for ranking, never for admission.** A rank-4 consulate page and
a rank-1 department page saying different things is a *conflict*, resolved by
`compareAuthority()`: lower rank wins; on equal rank the more recently
**changed** source wins (re-reading an unchanged page tells you nothing about
which of two contradictory statements is current); otherwise it returns 0 and
the caller must surface a conflict rather than pick one.

### What is never authoritative

Blogs, immigration consultants, forums, social media, aggregators and
AI-generated content. There is no rank for them. A "secondary" host requires an
explicit `approvedSecondaryHosts` entry passed to `evaluateSource`, is labelled
`trust: 'secondary'` in the verdict, and is empty by default — a secondary
source is a recorded decision, never a fallback the pipeline reaches for.

---

## 2. Fields on every source record

`visa_sources`, plus the version chain that carries retrieval state.

| Requirement | Column |
|---|---|
| Country and jurisdiction | `country_id` → `visa_countries` (`code`, `is_bloc`, `jurisdiction_note`) |
| Government department | `authority` |
| Visa categories covered | `visa_type_id` (null = country-level, governs every route) |
| Official base domain | derived from `canonical_url`; validated by `source-policy.ts` |
| Exact source URL | `source_url` (fetched) vs `canonical_url` (cited) |
| Source type | `role` — index, landing, eligibility, requirements, documents, forms, fees, processing_times, application, policy, news |
| Supported language | `language` (BCP-47) |
| Retrieval method | implied by `role` + sniffed content type; recorded per version |
| Expected file format | `visa_source_versions.content_type` + `kb_blobs.content_type` (sniffed) |
| Update frequency | `check_interval`, overridden by `kb_freshness_policies` |
| Last successful check | `last_success_at` |
| Last content change | `last_changed_at` |
| Content hash | `visa_source_versions.raw_sha256` + `normalized_sha256`; `kb_blobs.sha256` |
| HTTP validators (ETag/Last-Modified) | **not yet stored — see §6** |
| Trust level | `authority_rank` |
| Citation requirements | `canonical_url` is what is cited, never the cache |
| Terms / robots / access | `robots_state`, `redistribution` |
| Status | `active`, `failure_streak`, plus `kb_quarantine` and `kb_review_queue` |

**`redistribution` defaults to `unknown`, and `unknown` means "do not
redistribute".** Bytes are cached only on `permitted`; otherwise the hash and
size are kept — enough to detect change and to prove what was read — and the
user is linked to the authority's own page. That is the default posture, not a
degraded one.

---

## 3. Registry snapshot

Taken from the development database on 2026-09-03. `supabase/migrations/`
contains the seeding migrations; these numbers move as countries are onboarded.

**385 active sources · 353 rank-1 · 32 rank-2 · 0 below rank 2.**

### Supported destinations

| Code | Country | Active visa types | Registered sources |
|---|---|---:|---:|
| AE | United Arab Emirates | 3 | 3 |
| AT | Austria | 11 | 11 |
| CA | Canada | 8 | 41 |
| CN | China | 5 | 6 |
| EG | Egypt | 1 | 1 |
| FI | Finland | 5 | 12 |
| GB | United Kingdom | 7 | 32 |
| HK | Hong Kong SAR | 4 | 4 |
| IE | Ireland | 5 | 8 |
| LB | Lebanon | 10 | 16 |
| MY | Malaysia | 3 | 3 |
| NL | Netherlands | 5 | 6 |
| NO | Norway | 5 | 10 |
| SE | Sweden | 5 | 7 |
| SG | Singapore | 8 | 31 |
| TR | Türkiye | 15 | 29 |
| US | United States of America | 9 | 56 |

Sources are also registered for destinations not yet in `supported` state
(AU, DK, FR, JP, NZ, OM, PT, QA, JO, TH) — the registry runs ahead of the
picker, which is the intended direction.

### Authorities, by country

| Country | Authority | Sources |
|---|---|---:|
| AE | Federal Authority for Identity, Citizenship, Customs & Port Security (ICP) | 3 |
| AT | Migration Platform of the Austrian Federal Government | 11 |
| AU | Department of Home Affairs | 32 |
| CA | Immigration, Refugees and Citizenship Canada | 41 |
| CN | National Immigration Administration (NIA) | 6 |
| DK | SIRI — Danish Agency for International Recruitment and Integration | 7 |
| DK | Danish Immigration Service (Udlændingestyrelsen) | 3 |
| EG | Ministry of Interior — Arab Republic of Egypt | 1 |
| FI | Maahanmuuttovirasto (Finnish Immigration Service, Migri) | 12 |
| FR | Service-Public.gouv.fr — DILA | 18 |
| GB | UK Visas and Immigration | 32 |
| HK | Immigration Department of the HKSAR | 4 |
| IE | Immigration Service Delivery | 8 |
| JO | Government of Jordan — national eGovernment portal | 1 |
| JP | Immigration Services Agency (出入国在留管理庁) | 13 |
| LB | General Directorate of General Security | 16 |
| MY | Jabatan Imigresen Malaysia | 3 |
| NL | Immigratie- en Naturalisatiedienst (IND) | 6 |
| NO | Utlendingsdirektoratet (UDI) | 10 |
| NZ | Immigration New Zealand | 8 |
| OM | Ministry of Labour (وزارة العمل) | 6 |
| PT | AIMA — Agência para a Integração, Migrações e Asilo | 17 |
| QA | Ministry of Foreign Affairs — Consular Affairs | 1 |
| SE | Migrationsverket | 7 |
| SG | Ministry of Manpower (MOM) | 21 |
| SG | Immigration & Checkpoints Authority (ICA) | 10 |
| TH | Department of Consular Affairs, MFA (กรมการกงสุล) | 3 |
| TR | Ministry of Foreign Affairs | 16 |
| TR | Presidency of Migration Management (Göç İdaresi Başkanlığı) | 13 |
| US | U.S. Citizenship and Immigration Services | 50 |
| US | U.S. Customs and Border Protection | 4 |
| US | ICE — Student and Exchange Visitor Program | 2 |

Two authorities appear twice for IE, NZ and SE with slightly different names —
a data-hygiene item, not a correctness one. Filed as a registry cleanup task.

### By source role

| Role | Sources |
|---|---:|
| requirements | 170 |
| landing | 40 |
| fees | 39 |
| eligibility | 32 |
| application | 27 |
| index | 25 |
| forms | 20 |
| policy | 16 |
| documents | 16 |

### Access posture

| robots_state | redistribution | Sources |
|---|---|---:|
| allowed | unknown | 304 |
| unknown | unknown | 79 |
| **disallowed** | unknown | **2** |

The 2 disallowed sources are **never fetched again**. `redistribution` is
`unknown` across the board, so **no source bytes are currently cached** —
metadata plus a link to the authority is the whole posture today. Moving a
source to `permitted` is a deliberate, per-authority terms review.

---

## 4. Domain matching

`registrableDomain()` in `source-policy.ts` is public-suffix aware, because
naive last-two-labels matching gets government domains catastrophically wrong:

- `gov.uk` would become "the registrable domain", making `evil.gov.uk` and
  `homeoffice.gov.uk` "the same site"
- same for `gov.au`, `go.jp`, `gouv.qc.ca`, and ~90 more

A suffix missing from the list degrades **safely**: the registrable domain
comes out one label shorter, so the comparison becomes stricter, never looser.

`isSameSite()` accepts a subdomain only within the same registrable domain, so
`ircc.canada.ca` matches `canada.ca` and `canada.ca.evil.test` does not.

---

## 5. Adding a source

1. Insert into `visa_sources` with `country_id`, `role`, `authority`,
   `authority_rank`, `canonical_url`, `source_url`, `language`.
2. Run `scripts/check-robots.ts` and set `robots_state`.
3. Review the authority's terms and set `redistribution` (default `unknown` is
   correct until reviewed).
4. Run `visa-sync-run.ts` to create version 1.
5. Run `knowledge-ingest.ts --source-id <id>` to index it.
6. Confirm in `GET /admin/knowledge/coverage`.

Steps 4–6 happen automatically on the next scheduled run; the manual sequence
exists for onboarding and for verification.

---

## 6. Known gaps in this registry

- **ETag / Last-Modified are not stored.** `visa_source_versions` carries the
  two content hashes but no HTTP validators, so change detection is a
  full-fetch-and-hash rather than a conditional GET. Correct but not minimal:
  a `304 Not Modified` would avoid the body transfer entirely. Adding
  `etag` / `last_modified` columns and an `If-None-Match` header is a small,
  additive migration — recorded here rather than done, because it changes the
  fetch path that the sync's 71 existing tests cover.
- **`kb_chunk_scopes` is unpopulated.** The Schengen bloc case (one rule set
  applying to many member states) is modelled but needs a per-bloc mapping
  decision that belongs with the registry.
- **Duplicate authority names** for IE, NZ and SE (see §3).
- **79 sources have `robots_state = 'unknown'`** — they have never been
  successfully checked in this environment. The ingestion path re-evaluates
  robots before its own fetch, so this is a reporting gap rather than a
  compliance one.
