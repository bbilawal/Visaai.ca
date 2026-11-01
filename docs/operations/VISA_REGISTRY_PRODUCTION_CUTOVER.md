# Visa registry — production cutover

**Status 2026-08-21: APPLIED. Production is live with 293 active requirements
across 16 publishable pages (CA 7 / GB 6 / US 3), matching local exactly, with
zero requirements lacking provenance.**

Verified live: `visaai.co/visas/canada/visitor-visa-temporary-resident-visa`
renders IMM 5257, canada.ca citations and a "Last verified" date;
`/visas/canada/business-visitors` — the page that had no source at all this
morning — renders its labour-market and letter-of-invitation conditions.

Five defects were found in total. **Two by the dry run, three only by the real
apply** — worth knowing, because it sets the expectation for the next cutover:
a schema-only dry run cannot see ownership, the production Node version, or the
consequences of a fully-seeded catalogue.

## Why this is not "apply 31 migrations"

The obvious procedure — replay every migration in timestamp order — **fails**,
twice. Both failures were found by restoring a schema-only dump of the
production database into a scratch database on the same server and replaying
the migrations there. Neither would have been visible locally, because the local
database was built incrementally in the order the work happened, not in
timestamp order.

### Defect 1 — the seed depended on a later migration (fixed)

`20260820140000_visa_registry_seed.sql` uses

```sql
on conflict (source_url, coalesce(visa_type_id, '<sentinel>'))
```

whose expression index is created by `20260820160000`. The seed file was
regenerated *after* that index existed, so it acquired the newer conflict target
while keeping its original filename. Replayed in order it aborts with

```
ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

**Fixed** by making the seed self-sufficient: it now drops the old global unique
index and creates the per-type index itself, both guarded, so it is a no-op
wherever `160000` already ran.

### Defect 2 — requirements cannot be seeded blind (by design, not fixed)

Every requirement migration resolves `source_version_id` from a subquery into
`visa_source_versions`, and that column is `NOT NULL`. On a database where the
source monitor has never run, that table is empty, so:

```
ERROR: null value in column "source_version_id" of relation "visa_requirements"
       violates not-null constraint
```

**This is the provenance-by-constraint design doing its job and must not be
"fixed".** A requirement may not exist unless it is bound to a specific fetched
version of a specific government page. The constraint is the reason no
requirement in this system can be back-filled from memory. The consequence is
simply that production needs a sync between phases.

## What only the real apply could find

### Defect 3 — table ownership

Phase 1 was first run as `postgres`, which on this self-hosted stack is **not a
superuser**; the core schema is owned by `supabase_admin`. Adding columns to
`ai_usage_events` failed with `must be owner of table`, after the registry
tables had already been created under `postgres`.

Invisible to the dry run because the schema dump used `--no-owner`, so
everything in the scratch database belonged to whoever restored it.

Resolved by reassigning the `visa_*` objects to `supabase_admin` and running
everything since as that role. Four template-cache tables from earlier work are
still `postgres`-owned and functioning, so this is consistency rather than a
functional requirement — but mixed ownership inside one feature is worse than
either choice.

**Note:** `20260820120000` is not re-runnable. `CREATE POLICY` has no
`IF NOT EXISTS` in PostgreSQL, so replaying it fails on the first policy. Check
whether its objects already exist before re-running it.

### Defect 4 — the monitor could not start on production's Node

`createClient()` builds a RealtimeClient in its constructor whether or not
anything subscribes, and that needs a WebSocket. Node exposes one globally only
from v22; production runs Node 20, development runs Node 24. The first
production sync died before a single query with *"Node.js 20 detected without
native WebSocket support"*.

Fixed by `apps/api/scripts/lib/node20-websocket.ts`, a guarded polyfill that is
a no-op on Node 22+.

### Defect 5 — provenance lookups were ambiguous on a fully-seeded catalogue

Seven early requirement migrations resolved `source_version_id` by
`source_url` alone. A single authority page covers several visa types — the
IRCC fee schedule is registered for the visitor visa, study permit and work
permit among others — so on a database where all 134 sources are seeded up
front, that subquery returns several rows and the insert dies with *"more than
one row returned by a subquery used as an expression"*.

It never failed locally because the local database grew incrementally: when
those migrations first ran, only one visa type had claimed each shared URL.

The generator had already been fixed to emit a visa-type-scoped lookup, so the
seven files were regenerated from their JSON sources rather than hand-patched.

### Consequence for the procedure: phase 3 splits in two

Two phase-3 migrations REGISTER new sources (`20260821200000`,
`20260821230000`), and later ones need versions of those sources. So:

* **3A** — everything through `20260821230000` except the four below.
* **second sync** — versions the 5 newly registered sources (`ok` goes 67 → 72).
* **3B** — `20260821210001`, `20260821220000`, `20260821240000`,
  `20260821250000`.

## Bonus finding: the supply-chain overrides were inert in production

Not part of this cutover, found while installing for it, and fixed in the same
sweep. The 16 Task 14 security pins lived only in `pnpm-workspace.yaml`, whose
`overrides` key is a **pnpm 10+** feature; production pins pnpm 9.15.9, which
ignores it silently. `pnpm install` there had regenerated the lockfile with the
overrides deleted. Both placements were tested — package.json alone loses them
under pnpm 11, workspace alone loses them under pnpm 9 — so the list now lives
in both files. `pnpm install --frozen-lockfile` works on the VPS again, which
had been recorded as permanently broken.

## The procedure

Three phases. Do not merge them.

### Phase 1 — schema and catalogue (safe, additive, inert)

```
20260820120000_visa_registry_core.sql
20260820130000_ai_usage_cache_tokens.sql
20260820140000_visa_registry_seed.sql
20260820150000_visa_registry_rls_fix.sql
20260820160000_visa_sources_per_visa_type.sql
20260821170000_applications_visa_type.sql
```

Creates 8 tables, the `visa_publishable_pages` view, RLS policies, and one
nullable column on `applications`. Adds 4 countries, 32 visa types, 134 sources.

Nothing existing is dropped or rewritten. Until new application code ships,
nothing reads any of it — so this phase is inert and can be applied ahead of a
deploy.

Verified on a copy of the production schema: exit 0, then
`countries=4 types=32 sources=134 versions=0 reqs=0`, `applications.visa_type_id
present`.

Apply by piping into the production database (production is the self-hosted
stack; the container is `selfhosted_db`, **not** `supabase_db_*`):

```sh
cat supabase/migrations/20260820120000_visa_registry_core.sql \
  | ssh -i ~/.ssh/visaai_vps root@<host> \
    'docker exec -i selfhosted_db psql -U postgres -d postgres -v ON_ERROR_STOP=1'
```

…once per file, in the order listed.

### Phase 2 — run the source monitor against production

Requirements cannot be applied until `visa_source_versions` has rows. Run the
monitor once, from a host with the production Supabase credentials:

```sh
SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod> \
  npx ts-node -P tsconfig.json scripts/visa-sync-run.ts
```

This is an outward-facing action: roughly 139 GET requests to government sites,
one host at a time, 2s apart, honouring robots.txt. It is the same thing the
scheduled job does daily. Expect roughly `ok 72, blocked 62, unavailable 4,
parseErrors 1` — the blocked ones are Australian and US hosts behind WAFs and
are recorded, not retried. Takes about 4 minutes.

**Do not treat `blocked` as a failure to work around.** See
`docs/operations/SOURCE_ACCESS.md`.

### Phase 3 — requirements and promotions

The remaining 25 migrations, in timestamp order, from
`20260821120000_ca_visitor_visa_requirements.sql` onward.

Each promotion migration ends with a guard that aborts the transaction if any
active requirement lacks provenance or an excerpt, so a partial or corrupted
phase 2 surfaces here rather than reaching users.

Expected end state: **293 active requirements, 16 publishable pages**
(CA 7 / GB 6 / US 3).

### Phase 4 — deploy the code

`git push` does not deploy. The VPS needs `git pull`, `pnpm --filter <app>
build`, and a pm2 restart. Web is port **3002**. See
`VISAAIDocs/deployment/DOMAIN_MIGRATION.md` §5.

Until this happens, phases 1–3 are invisible to users: the deployed code has no
`lib/visa-registry.ts` reader, no visa-type selector, and no
`/intake/applications/:id/visa-type` route.

## Two web-deploy hazards, both hit for real on 2026-08-21

Neither is about the registry, and both will recur on every deploy.

### 1. Building in place takes the site down, and a bad build leaves it down

pm2 runs `next start` from `apps/web/.next`, and `pnpm --filter web build`
rewrites that same directory underneath the running server. So every web deploy
has a window where requests hit a half-written `.next`.

That is normally seconds. On 2026-08-21 it was not: the site served **502 for
every route** with

```
Error: ENOENT: no such file or directory, open '.../.next/prerender-manifest.json'
```

pm2 reported `visaai-web` as `online` throughout — the process was up, its build
output was not. **A green pm2 row is not a healthy site.** Fixed by rebuilding
and restarting.

If a deploy needs to be safe, build to a fresh directory and swap, or accept and
announce the window. Do not assume "build succeeded" means "site is up" — curl
a real route afterwards. Every deploy in this runbook should end with a request,
not a pm2 listing.

### 2. `.next/cache` reuses prerendered output ACROSS builds

`/sitemap.xml` is prerendered at build time. After New Zealand went live, two
consecutive rebuilds still shipped a sitemap without it — the country page
rendered fine, `/visas` listed New Zealand, and the anon client could read it
from the database. Only the sitemap was stale, serving `x-nextjs-cache: HIT`.

The cause is Next's incremental cache in `apps/web/.next/cache` (193 MB on this
host), which lets a build REUSE a previous prerender. Clearing it does not fix
the already-built output — the sequence has to be:

```sh
rm -rf apps/web/.next/cache
pnpm --filter web build     # the build AFTER the clear is the one that matters
pm2 restart visaai-web
```

Clear-then-restart without rebuilding changes nothing, which is the trap: it
looks like a fix and the stale page persists.

**After adding a country or visa type, verify the sitemap explicitly**, not just
the page:

```sh
curl -sL https://visaai.co/sitemap.xml | grep -c '<loc>[^<]*visas/[^<]*</loc>'
```

330 URLs at 5 destinations / 17 publishable pages as of 2026-08-21. A page that
renders but is missing from the sitemap is invisible to search, which for these
pages is most of their value.

## Rollback

Phases 1–3 are additive. To reverse, drop the eight registry tables and the
view, and drop `applications.visa_type_id`. No pre-existing table is modified
in any other way, and no existing row is rewritten, so nothing else needs
restoring. `country_frameworks` is untouched throughout and the legacy checklist
path keeps working, which is why an incomplete cutover degrades rather than
breaks.

---

## Phase 4 hazard: never restart while `next build` is running (2026-08-24)

The third deploy of the night returned **502 on every page** — all 55 registry
pages and every hub. Found by the post-deploy sweep, fixed in four minutes, but
worth writing down because the cause is a race that will recur.

`next build` **deletes and rewrites `.next`**. The deploy script did:

```sh
rm -rf apps/web/.next/cache && pnpm --filter web build   # backgrounded
pm2 restart visaai-web                                    # ran too early
```

`next start` came up against a half-written `.next`, could not open
`prerender-manifest.json`, exited, and pm2 restarted it in a loop — the restart
counter reached **282**.

```
2|visaai-w |   syscall: 'open',
2|visaai-w |   path: '/var/www/visaai/VisaAI/apps/web/.next/prerender-manifest.json'
```

**The fix, and the rule:** wait for the build to finish, then check the artefact
exists before restarting.

```sh
pnpm --filter web build            # foreground, or wait on it
ls -la apps/web/.next/prerender-manifest.json   # must exist
pm2 restart visaai-web --update-env

# POLL. Do not check once. See below.
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/visas)
  [ "$code" = "200" ] && { echo "up after ${i} attempt(s)"; break; }
  echo "attempt $i: $code"; sleep 3
done
```

Check the local port before the public URL: it separates "the app is broken"
from "nginx or DNS is broken", and only one of those is yours to fix.

### Clear `.next/cache` when the build must see new database rows

Next's Data Cache persists in `apps/web/.next/cache` ACROSS builds. A build that
runs after a promotion migration can therefore generate its sitemap from cached
registry reads and omit the pages that were just published — while the pages
themselves render correctly, because those are requested fresh.

Measured on 2026-08-25: the UAE's Green and Blue Residence pages both answered
200 with all their quotations, and neither appeared in the sitemap. The Golden
Residency route, published in an earlier build, was there. Rebuilding with the
cache removed put all three in.

```sh
rm -rf apps/web/.next/cache            # only needed when the DB changed
pnpm --filter web build
```

This is the failure `verify-deploy.sh`'s sitemap-vs-registry check exists for.
Nothing else would have caught it: every page the sweep knew about answered 200,
and a sitemap missing three URLs looks exactly like a sitemap.

### Stop the API before building it

`nest build` removes `dist/` before writing it, and it cannot: the running
process holds open handles inside that tree, so the removal fails with

```
Error  ENOTEMPTY: directory not empty, rmdir '.../apps/api/dist/modules/iam'
```

and the build exits non-zero having written a PARTIAL `dist` — 199 of 677 files
on 2026-08-24. A plain `rm -rf apps/api/dist` fails the same way for the same
reason, and leaves the API alive only on deleted inodes: it keeps answering
because its open file descriptors survive the unlink, and the next restart is
the one that dies.

That is the mechanism behind every previous form of this hazard, including the
`dist/observability/` build that exited 0 with 1 of 3 files.

```sh
pm2 stop visaai-api
sleep 3                                  # let the handles close
rm -rf apps/api/dist apps/api/*.tsbuildinfo
pnpm --filter api build                  # must exit 0
find apps/api/dist -name '*.js' | wc -l  # expect ~677, not ~200
pm2 start visaai-api
```

The brief downtime is the point. Building underneath a running process is what
produces a half-written `dist` that looks like a successful deploy.

**Run `./scripts/verify-deploy.sh` on the VPS instead of doing this by hand.**
It polls until the app answers, sweeps every page read out of
`visa_publishable_pages`, checks the API and asserts the provenance count is
zero, and exits non-zero if any of that fails. The steps below are what it does;
they are kept here because knowing what a script checks is how you know what its
green means.

**The artefact check is necessary and not sufficient.** On 2026-08-24 the
manifest was verified present (77,851 bytes) BEFORE the restart, and the restart
still crash-looped on `ENOENT` for that exact path, served 502 publicly for
roughly half a minute, then recovered on its own. `pm2 jlist` reported
`status: online` throughout — pm2 means "I have a process", not "it answers".

So the restart itself has a window, and a single curl fired inside it reports a
dead site that is merely starting. Poll until 200 rather than checking once, and
never conclude from one failed request: the first read after that restart said
the page had zero internal links, which was true only of the 502 error body.

**And sweep every page, not a sample.** This failure was total, so any spot-check
would have caught it. A partial one — a single country's pages 500ing because a
migration half-applied — would not, and that is the failure this sweep exists
for. Read the list out of `visa_publishable_pages`; do not maintain it by hand.

---

## Phase 4 hazard, second kind: `nest build` exits 0 and leaves a broken `dist`

The API went down on the second rebuild of 2026-08-24. `pnpm --filter api build`
exited **0**, printed no error, and produced a `dist` that could not boot:

```
Error: Cannot find module './observability/logger.config'
Require stack:
- /var/www/visaai/VisaAI/apps/api/dist/app.module.js
```

`src/observability/` holds three files. `dist/observability/` held one.

**`nest build` is incremental.** With a `tsbuildinfo` that believes those files
are already emitted and a `dist` that no longer has them, it re-emits nothing
and reports success. pm2 then restart-looped a module-not-found.

The first rebuild that day had worked, which is what makes this dangerous: the
same command, same tree, different outcome, and the only signal is that the app
does not start.

**The rule:**

```sh
cd apps/api && rm -rf dist *.tsbuildinfo     # not optional
cd ../.. && pnpm --filter api build
ls apps/api/dist/observability/              # sanity: 3 files, not 1
pm2 restart visaai-api --update-env
sleep 15
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/health   # expect 200
pm2 logs visaai-api --lines 40 --nostream | grep 'Nest application successfully started'
```

**A build exit code is not evidence the app runs.** Both deploy hazards found
today share that shape: `next build` racing a restart, and `nest build`
emitting a partial tree — in each case the command succeeded and the service was
broken. Check the artefact, then check the process, then check the route.

**When the API needs rebuilding at all:** a registry-only change does not need
it — the public pages read the database. It IS needed when anything under
`apps/api/src/` changes, including `modules/visa-sync/`, because the API process
runs the scheduled sync.
