# Runbook — visa registry and AI routing

Covers what this branch added. The existing security runbook is at
`docs/security/SECURITY_OPERATIONS_RUNBOOK.md`.

## Deploy

Migrations first, then the API, then the web app. Order matters: the web app's
visa routes read tables the migrations create, and they degrade to "no
destinations published" rather than erroring if the tables are absent — so a
wrong order is survivable but produces empty pages.

```bash
# 1. Migrations, in filename order
for f in 20260820120000_visa_registry_core \
         20260820130000_ai_usage_cache_tokens \
         20260820140000_visa_registry_seed \
         20260820150000_visa_registry_rls_fix \
         20260820160000_visa_sources_per_visa_type; do
  docker exec -i selfhosted_db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    < supabase/migrations/$f.sql
done

# 2. Verify before touching the apps
docker exec -i selfhosted_db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/security/visa_registry_rls_test.sql

# 3. API, then web (see CLAUDE.md — git push does NOT deploy)
```

`NEXT_PUBLIC_*` are baked at build time; the web app must be rebuilt, not just
restarted. API env is runtime — edit `apps/api/.env` and restart.

## New environment variables

All optional. Unset = the policy default.

| Variable | Purpose |
|---|---|
| `AI_MODEL_NANO` | pin the nano tier's model |
| `AI_MODEL_SMALL` | pin the small tier |
| `AI_MODEL_BALANCED` | pin the balanced tier |
| `AI_MODEL_FRONTIER` | pin the frontier tier |

## Health checks

```bash
# public pages serve real content
curl -s -o /dev/null -w "%{http_code}\n" https://visaai.co/visas
curl -s https://visaai.co/visas/canada | grep -c "canada.ca"     # expect > 0

# sitemap
curl -s https://visaai.co/sitemap.xml | grep -c '<loc>'

# registry
docker exec -i selfhosted_db psql -U postgres -d postgres -c "
  select (select count(*) from visa_countries)  as countries,
         (select count(*) from visa_types)      as visa_types,
         (select count(*) from visa_sources)    as sources,
         (select count(*) from visa_requirements where status='active') as active_reqs,
         (select count(*) from visa_publishable_pages) as publishable;"
```

`publishable = 0` is expected until requirement extraction runs. It is not an
incident.

## Common situations

### "The visa pages show no destinations"

The registry read degraded. Check the API/web logs for
`[visa-registry] visa_countries: ...` — that line names the cause. Usually the
migrations have not been applied, or the anon role lost SELECT.

```bash
docker exec -i selfhosted_db psql -U postgres -d postgres -c \
  "select code, support_state from visa_countries;"
```

### "A visa page returns 500"

A single-record lookup threw, which is deliberate — a 500 says "try later" where
a 404 would say "gone". The cause is a real database problem. Check
connectivity and RLS before anything else.

### "The sync reports everything blocked"

Check `robots_state` and `failure_streak`. An authority may have changed its
robots.txt, in which case `blocked` is the correct outcome and the fix is to
serve the official link rather than to work around it.

```sql
select source_url, robots_state, failure_streak, last_success_at
from visa_sources where active order by failure_streak desc limit 20;
```

### "AI costs jumped"

```sql
select operation, model, count(*) calls,
       sum(input_tokens) input, sum(cached_input_tokens) cached,
       sum(cache_write_tokens) writes, sum(output_tokens) output,
       round(sum(request_cost_usd), 4) usd
from ai_usage_events
where created_at > now() - interval '24 hours'
group by operation, model order by usd desc limit 20;
```

Check for input token counts above 272,000 — that crosses the long-context
cliff and bills the whole request at 2× input / 1.5× output. A single oversized
applicant document does it.

If a tier regressed, pin it via `AI_MODEL_*` and restart. No deploy required.

### "A material change is sitting unreviewed"

```sql
select s.canonical_url, c.classification, c.escalation_reasons, c.summary, c.created_at
from visa_source_changes c join visa_sources s on s.id = c.source_id
where c.requires_review and c.state in ('detected','parsed','validated','tested')
order by c.created_at;
```

The previous reviewed version is still serving, so this is not an outage — but a
material change pending more than 48h means applicants may be reading a rule the
government has changed. Escalate.

## Do not

- load-test a government website
- retry through a 403 or 429 from an authority
- edit `visa_*` tables directly in production; writes belong to migrations and
  the sync job, and the RLS test asserts even an admin JWT cannot write
- roll back `20260820150000` — it closes a data-exposure defect
