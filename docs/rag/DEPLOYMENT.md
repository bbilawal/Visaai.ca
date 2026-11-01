# Deployment and rollback

VisaAI is **self-hosted on a Hostinger VPS** behind nginx, with per-app `.env`
files. `git push` does not deploy. Production Postgres is the **self-hosted
Supabase on the VPS** (`selfhosted_db`), not the cloud project.

---

## Preconditions

Verify all three before starting. Any one failing makes the deploy a rollback.

```bash
# 1. pgvector must be installable, or the migration fails on its first statement
ssh -i ~/.ssh/visaai_vps root@2.24.196.5 \
  "docker exec -i selfhosted_db psql -U postgres -d postgres -tAc \
   \"select name, default_version, installed_version
     from pg_available_extensions where name in ('vector','pg_trgm');\""

# 2. the registry tables the migration extends must exist
ssh -i ~/.ssh/visaai_vps root@2.24.196.5 \
  "docker exec -i selfhosted_db psql -U postgres -d postgres -tAc \
   \"select count(*) from information_schema.tables
     where table_schema='public' and table_name in
     ('visa_sources','visa_source_versions','visa_countries','visa_types');\""
# expect 4

# 3. a backup exists, taken today
ssh -i ~/.ssh/visaai_vps root@2.24.196.5 'ls -lh /var/backups/visaai/ | tail -5'
```

If `vector` shows no `default_version`, **stop**. Installing pgvector into the
self-hosted image is an infrastructure change, not part of this deploy.

---

## 1. Database — ALREADY DONE, 2026-09-04

All three migrations are applied to production. The commands below are kept for
a rebuild or a second environment; running them again is a no-op, since every
one of them is idempotent.

Applied in timestamp order — `20260820170000`, `20260903120000`,
`20260903130000` — after a schema-only `pg_dump` to
`/root/backups/public-schema-20260904-195435.sql`. Nothing was restarted and
`api.visaai.co` answered 200 throughout.


```bash
scp -i ~/.ssh/visaai_vps \
  supabase/migrations/20260903120000_visa_knowledge_rag.sql \
  root@2.24.196.5:/tmp/kb.sql

ssh -i ~/.ssh/visaai_vps root@2.24.196.5 \
  'docker exec -i selfhosted_db psql -U supabase_admin -d postgres \
     -v ON_ERROR_STOP=1 -1 < /tmp/kb.sql'
```

- **`-U supabase_admin`, not `-U postgres`.** The app tables are owned by
  `supabase_admin`; `postgres` gets `must be owner of table` on the
  `alter table visa_source_versions add column blob_sha256` step.
- **`-1`** wraps it in one transaction. The migration asserts its own end state
  (13 tables present, the function created, 12 policies seeded,
  `kb_chunks.source_version_id` NOT NULL), so a partial apply rolls back rather
  than leaving half a schema.
- The migration is **idempotent** — re-running it is a no-op, verified.

### The two replay migrations, if you apply them

`20260820170000_visa_source_versions_bootstrap.sql` and
`20260903130000_drop_source_version_fixtures.sql` exist so an empty database can
replay the chain (see `MIGRATION_REPLAY.md`). Against production they are inert:
the bootstrap plants nothing, because every source that has a fixture already has
a version, and the drop removes what the bootstrap installed. Their only residue
is one empty table, `visa_requirement_bootstrap_skips`.

Apply them **as a pair, in one session, in timestamp order** — never the
bootstrap alone:

```bash
scp -i ~/.ssh/visaai_vps \
  supabase/migrations/20260820170000_visa_source_versions_bootstrap.sql \
  supabase/migrations/20260903130000_drop_source_version_fixtures.sql \
  root@2.24.196.5:/tmp/

ssh -i ~/.ssh/visaai_vps root@2.24.196.5 \
  'set -e
   for f in /tmp/20260820170000_*.sql /tmp/20260903130000_*.sql; do
     docker exec -i selfhosted_db psql -U supabase_admin -d postgres \
       -v ON_ERROR_STOP=1 -1 < "$f"
   done'
```

Between the two files a trigger is live on `visa_sources` that plants a fixture
version on any newly registered source. If the sync happens to register a
genuinely new source in that window, and its URL matches a fixture, it would be
given a version dated 2026-08-25 that this deployment never fetched. Seconds of
exposure, but the sync runs on a schedule — apply them outside the sync window,
or `pm2 stop visaai-api` first.

Verify:

```sql
select count(*) from information_schema.tables
 where table_schema='public' and table_name like 'kb\_%';   -- 13
select count(*) from pg_proc where proname='kb_search_hybrid'; -- 1
select count(*) from kb_freshness_policies;                    -- 12
```

## 2. API

```bash
ssh -i ~/.ssh/visaai_vps root@2.24.196.5
cd /var/www/visaai/VisaAI
git pull
corepack prepare pnpm@9.15.9 --activate   # pnpm 11.x breaks on Node 20
pnpm install
pnpm --filter api build
pm2 restart visaai-api
```

Set in `apps/api/.env` (runtime — restart is enough, no rebuild):

| Variable | Value | Effect if unset |
|---|---|---|
| `OPENAI_API_KEY` | a valid key | falls back to `deterministic-hash-v1`; retrieval degrades badly |
| `KNOWLEDGE_EMBEDDING_MODEL` | `text-embedding-3-small` | defaults to the same |
| `KNOWLEDGE_EMBEDDING_PROVIDER` | *(unset)* | set to `deterministic` only to force the offline provider |

Confirm the scheduler registered:

```bash
pm2 logs visaai-api --lines 200 | grep -i knowledge
# knowledge ingestion scheduled daily at ~09:xx (+90m, after the source sync); sweep +330m
```

## 3. Web

```bash
pnpm --filter web build   # bakes NEXT_PUBLIC_*
pm2 restart visaai-web
```

`apps/web` has `typedRoutes: true`, so the new `/knowledge` route needs a real
`next build` to regenerate `.next/types`.

## 4. Backfill

**Run from the VPS, not locally.** The VPS egress IP is WAF-challenged by some
authorities; a local fetch laundered into production data misrepresents what
production can reach.

```bash
# dry run first — reports the worklist without touching anything
npx ts-node -P apps/api/tsconfig.json apps/api/scripts/knowledge-ingest.ts \
  --country CA --dry-run

# then, per country
npx ts-node -P apps/api/tsconfig.json apps/api/scripts/knowledge-ingest.ts \
  --country CA --limit 200 --concurrency 4
```

Resumable: every unit is keyed in `kb_ingestion_jobs` by
`ingest:<versionId>:<model>`, so a run killed at item 4,000 of 12,000 restarts
at 4,000. There is no checkpoint file to fall out of sync.

## 5. Verify

```bash
curl -s -H "Authorization: Bearer $ADMIN_JWT" \
  https://api.visaai.co/admin/knowledge/status | jq '.storage, .quarantine.open, .review.open'

curl -s -H "Authorization: Bearer $ADMIN_JWT" \
  https://api.visaai.co/admin/knowledge/coverage | jq '.totals'
```

Then the benchmark, which **exits non-zero on a jurisdiction leak**:

```bash
npx ts-node -P apps/api/tsconfig.json apps/api/scripts/knowledge-benchmark.ts \
  --k 10 --out /tmp/bench.json
```

---

## Gradual rollout

The knowledge system is **reachable only through its own routes** —
`/knowledge/*` and `/admin/knowledge/*`. Nothing in the existing application
calls it. That is the rollout control: no feature flag is needed to keep it
away from users, because no user-facing path reaches it until one is wired.

To roll out gradually, wire the first caller behind the existing
`feature-flags` module rather than adding a second mechanism here.

---

## Rollback

### Fastest — stop serving, keep the corpus

Remove `KnowledgeModule` from `app.module.ts`, rebuild, restart. The routes
disappear; the schema and corpus are untouched; reversible in one deploy.
**Prefer this.** Roll the schema back only when the schema is the problem.

### Full schema rollback

```bash
scp -i ~/.ssh/visaai_vps \
  supabase/migrations/rollback/20260903120000_visa_knowledge_rag.down.sql \
  root@2.24.196.5:/tmp/kb-down.sql

ssh -i ~/.ssh/visaai_vps root@2.24.196.5 \
  'docker exec -i selfhosted_db psql -U supabase_admin -d postgres \
     -v ON_ERROR_STOP=1 < /tmp/kb-down.sql'
```

**Destroys** the entire corpus: extractions, sections, chunks, embeddings,
retrieval logs. **Preserves** the whole official-source registry — the knowledge
layer is additive over it, so rollback returns the database to a working
pre-RAG state, not an empty one.

The script asserts its own post-conditions and refuses to commit if the registry
was damaged. Verified end to end on a scratch database: forward → rollback →
forward, registry intact throughout.

Deliberately **not** dropped, and why:

- the `visa-knowledge` storage bucket — it may hold the only record of what an
  authority published on a given date
- the `vector` and `pg_trgm` extensions — shared infrastructure; dropping one
  another object uses fails the whole transaction

### Recovery after rollback

Re-apply the migration and re-run the backfill. No government page is re-fetched
(`visa_source_versions` is untouched) — but every embedding is re-paid for, so
budget the API cost for the whole corpus.

---

## Disaster recovery

| Failure | Recovery | Data loss |
|---|---|---|
| Corpus corrupted | re-run `knowledge-ingest.ts --force` | none; versions are the source of truth |
| Embeddings wrong/incomplete | `delete from kb_embeddings where model = '<model>'`, re-ingest | none; costs one re-embed |
| Bad model upgrade | ingest under the new model id, verify, then switch `KNOWLEDGE_EMBEDDING_MODEL`. Both coexist — `kb_embeddings` is keyed by (text, model) | none; rollback is a config change |
| Storage bucket lost | re-fetch, or serve metadata-only | cached bytes only; hashes and citations survive |
| Postgres restored from backup | re-run backfill for anything after the snapshot | bounded by backup age |

**The model upgrade path is the one worth rehearsing.** Because embeddings are
keyed by `(text_sha256, model)` and `kb_search_hybrid` filters on the model, a
new model can be indexed alongside the old one, benchmarked against it, and
switched with an env change — and switched back the same way. A corpus embedded
under one model and queried under another returns *nothing* rather than
plausible-looking wrong results.
