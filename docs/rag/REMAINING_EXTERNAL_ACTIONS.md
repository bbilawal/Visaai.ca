# Remaining external actions

Everything here needs a credential, an account, or a decision that is not mine
to make. Nothing here is blocked on code.

Ordered by what blocks production.

---

## 1. `OPENAI_API_KEY` — NOT a production blocker. Corrected 2026-09-04.

**This item was wrong as first written.** It said the key was invalid and that
this blocked production. What was actually true: the key in the LOCAL
`apps/api/.env` returns 401. Production carries a different key, and it works.

Checked 2026-09-04 by calling `GET https://api.openai.com/v1/models` with each
key and recording only the status code:

| Where | Status |
|---|---|
| `apps/api/.env` (local dev) | **401** |
| `apps/web/.env.local` (local dev, a different key) | **401** |
| `/var/www/visaai/VisaAI/apps/api/.env` (production) | **200** |

So the deployed API already embeds against `text-embedding-3-small`. What is
left is not a credential, it is a run:

```bash
# ON THE VPS. Do not run this locally: the local key is dead, and local egress
# reaches authorities production cannot.
ssh -i ~/.ssh/visaai_vps root@2.24.196.5
cd /var/www/visaai/VisaAI
npx ts-node -P apps/api/tsconfig.json apps/api/scripts/knowledge-ingest.ts \
  --limit 500 --concurrency 4
```

Cost: 892 distinct texts x ~110 tokens ~ 100k tokens on
`text-embedding-3-small`. Under $0.01 for the current corpus, roughly linear
thereafter. Re-runs cost nothing — the `(text, model)` primary key means
unchanged text is never re-embedded.

**What still matters from the original note.** Any corpus built while the key
was missing carries model id `deterministic-hash-v1`, a hashed n-gram
projection, not a semantic embedding. The mismatch is safe rather than silent:
`kb_embeddings` is keyed by `(text_sha256, model)` and `kb_search_hybrid` filters
on the model, so a query under one model against a corpus embedded under another
matches nothing rather than returning wrong neighbours.

**Verify:**

```sql
select model, count(*) from kb_embeddings group by model;
```

Then re-run `knowledge-benchmark.ts` and compare `hit@10` against the
`deterministic-hash-v1` numbers in `RAG_TEST_REPORT.md`.

**Local development** still needs a working key in `apps/api/.env`, or it runs
on the deterministic provider. That is a developer-environment fix, not a
production one.

---

## 2. Apply the migration to production — DONE 2026-09-04

**Applied to production on 2026-09-04**, together with the two replay
migrations, in timestamp order: `20260820170000`, `20260903120000`,
`20260903130000`. A schema-only `pg_dump` was taken first
(`/root/backups/public-schema-20260904-195435.sql`).

Verified afterwards: 14 `kb_*` tables, `vector` 0.8.0 and `pg_trgm` 1.6
installed, `kb_search_hybrid` present, 12 freshness policies seeded,
`visa_source_versions.blob_sha256` added. The bootstrap reported
`planted 0 of 385 already-registered sources` and the drop reported
`0 skips across 0 visa types` — inert, as intended. Registry counts were
unchanged: 385 sources, 807 versions (306 active), 2625 requirements (2623
active). No process was restarted and no request was dropped; `api.visaai.co`
answered 200 throughout.

The code is not deployed — `KnowledgeModule` lives on `feat/visa-knowledge-rag`
(PR #48). The schema is deliberately ahead of the code, and no user-facing path
reaches it either way.

The original instructions, kept for a rebuild:

```bash
scp -i ~/.ssh/visaai_vps \
  supabase/migrations/20260903120000_visa_knowledge_rag.sql \
  root@2.24.196.5:/tmp/kb.sql

ssh -i ~/.ssh/visaai_vps root@2.24.196.5 \
  'docker exec -i selfhosted_db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 < /tmp/kb.sql'
```

`-U supabase_admin`, not `-U postgres`: the app tables are owned by
`supabase_admin` and `postgres` gets `must be owner of table` on the
`alter table visa_source_versions` step.

`-1` wraps it in one transaction, and the migration asserts its own end state,
so a partial apply rolls back.

**Prerequisite — CHECKED 2026-09-04, satisfied.** The `vector` extension must be
installable, and it is:

```
pg_trgm|1.6|
vector|0.8.0|
```

(name | default_version | installed_version, from `pg_available_extensions` on
`selfhosted_db`.) Both are available and neither is installed yet, which is the
expected state — the migration installs them itself, into the `extensions`
schema rather than `public`. Re-check with:

```bash
ssh -i ~/.ssh/visaai_vps root@2.24.196.5 \
  "docker exec -i selfhosted_db psql -U postgres -d postgres -tAc \
   \"select name, default_version, installed_version from pg_available_extensions where name in ('vector','pg_trgm');\""
```

So no infrastructure change is needed. Had `vector` been absent, the migration
would have failed on its first statement with nothing else applied, and adding
pgvector to the self-hosted image would have been an infrastructure change, not
a migration.

**Rollback:** `supabase/migrations/rollback/20260903120000_visa_knowledge_rag.down.sql`.
Verified end to end on a scratch database: forward → rollback → forward, with
the source registry intact throughout.

---

## 3. Decide `redistribution` per authority

Every one of the 385 registered sources has `redistribution = 'unknown'`, which
the pipeline correctly treats as "do not cache the bytes". Consequence: the
`visa-knowledge` bucket stays empty, and `kb_blobs.storage_path` is null
throughout.

Nothing is broken by this — the hash and size are still recorded, change
detection still works, and citations point at the authority's own URL, which is
where they should point regardless. What is lost is the ability to show a user
the exact document version an answer was based on when the authority later
removes it.

This is a **terms review per authority**, not an engineering task. A worksheet
with every authority, its source count and a column for the verdict is at
[`REDISTRIBUTION_REVIEW.md`](./REDISTRIBUTION_REVIEW.md).

One correction to the priority below: as of 2026-09-04 **no active version in
production is a PDF** — all 306 are `text/html`. The PDF-first ordering is still
the right instinct, but it describes the authority you onboard next, not any
source registered today. For each, read the site's terms and set:

```sql
update visa_sources set redistribution = 'permitted'  -- or 'prohibited'
where id = '<uuid>';
```

Start with the four largest, which are also the likeliest to publish a PDF next
and the likeliest to have a citable open licence: IRCC, USCIS, UKVI, Home
Affairs.

---

## 4. Configure an OCR provider (optional)

`KNOWLEDGE_OCR_PROVIDER` is an optional injection token with no default. Without
it, an image or a text-layer-less PDF is **quarantined**, not silently dropped —
`kb_quarantine.reason = 'low_confidence'` with the extractor's message.

No currently-registered source needs it: all 80 blobs are HTML. Configure it
before onboarding an authority that publishes scanned bulletins.

Note the deliberate separation: `documents/ocr/` already has a region-aware,
no-retention provider for **applicant** documents. Do not share that instance.
Government PDFs are public and have different residency constraints, and wiring
one provider into both paths would make a future change to either silently
change the posture of the other.

---

## 5. Enable the queue workers on the VPS

`KnowledgeScheduler` registers two repeatable BullMQ jobs at boot:

| Job | Offset | What |
|---|---|---|
| `knowledge-ingest` | +90 min | extract, chunk, embed |
| `knowledge-sweep` | +330 min | stale sources, coverage gaps |

Offsets are relative to `TEMPLATE_REFRESH_HOUR` (default 09:00 local per
country) and are **load-bearing**, not cosmetic. Four jobs now reach the same
government hosts:

```
+0    form-refresh
+30   doc-template-refresh
+60   visa-source-sync
+90   knowledge-ingest      ← new
+330  knowledge-sweep       ← new
```

Two of these landing on `canada.ca` in the same minute is what got VisaAI
rate-limited by the European Commission on 2026-08-13, and it fails silently:
sources start returning 403 and the corpus quietly goes stale.

**Verify after deploy:**

```bash
ssh -i ~/.ssh/visaai_vps root@2.24.196.5 'pm2 logs visaai-api --lines 200 | grep -i knowledge'
```

Expect: `knowledge ingestion scheduled daily at ~09:xx (+90m, after the source sync); sweep +330m`.

---

## 6. Grant admin access to the new screen

`/knowledge` is behind `requireRole(['admin'])` in the `(admin)` route group and
`@RequireRole('admin')` on `KnowledgeAdminController`. No new grant is needed for
an existing admin.

**On translation — this was mis-scoped when first written, and is now closed.**
The nav entry (`adminKnowledgeOps`) ships the English string in all 15 locales.
So does every other admin nav label: `adminDashboard`, `adminBilling`,
`adminCoupons` and `adminRegistryOps` are the identical English string in all 15
message files. Translating this one key would leave a single localised label
sitting among four English siblings in the same menu, which reads as a bug.

The real choice is whether the admin nav is localised at all — it is an
internal, admin-only surface, and today it is not. If it should be, that is one
task covering all five keys across 14 locales, not a loose end from this
project.

---

## 7. Backfill the remaining corpus

The dev corpus is 3 countries of 17. 189 active routes have registered sources
and nothing indexed. This is run length, not capability — but it is real
production work:

```bash
# per country, so a rate-limit affects one authority
for CC in CA GB US SG TR AT LB NO FI SE NL IE CN AE HK MY EG; do
  npx ts-node -P apps/api/tsconfig.json apps/api/scripts/visa-sync-run.ts --limit 60
  npx ts-node -P apps/api/tsconfig.json apps/api/scripts/knowledge-ingest.ts \
    --country "$CC" --limit 200 --concurrency 4
done
```

Expect blocks: the 90-source sync run in development returned **34 blocked** of
90 — robots.txt or an authority 403/429. That is correct behaviour and not a
retry target; those sources serve a link rather than a passage.

Run it **from the VPS**, not locally: the VPS egress IP is WAF-challenged by
some authorities (migri.fi returns 403 even for robots.txt), and a local fetch
laundered into production data would misrepresent what production can reach.

---

## 8. Optional: store HTTP validators

`visa_source_versions` records two content hashes but no `ETag` /
`Last-Modified`, so change detection is fetch-and-hash rather than a conditional
GET. Correct, but not minimal — a `304` would avoid the body transfer entirely
across ~385 sources daily.

Additive migration plus an `If-None-Match` header in `source-fetcher.ts`.
Recorded rather than done because it changes the fetch path that the sync's 71
existing tests cover, and that is a change worth its own review.
