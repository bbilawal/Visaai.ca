# Migrating to self-hosted Supabase — runbook

**Written 2026-08-06 during the full-project audit.**

The stack in this directory is complete and its images are already on your
machine. What is **not** done is every step that requires a production
credential or bulk data export — this environment blocks those, so they are
yours to run. Each is a single command below.

---

## 0. What you are migrating

Four projects across two organisations:

| Project | Ref | Region | Status | Org |
|---|---|---|---|---|
| **VisaAI** | `ujxzxefvtaoxiydbdrhb` | us-east-1 | ACTIVE | sajawal's |
| BusinessOperationAI | `xdlwezgygteoqdoiwtrs` | ca-central-1 | ACTIVE | sajawal's |
| qalabs | `hupkwliknmemlmxkbnua` | us-east-1 | ACTIVE | second org |
| aihired | `aaelsbpksgmeizdiiref` | us-east-2 | **INACTIVE** | second org |

`aihired` is paused. **Restore it before dumping** — a paused project cannot be
read. Do that from the dashboard, take the dump, then pause it again.

Run this whole procedure on **one non-critical project first** (qalabs or
BusinessOperationAI). VisaAI carries 13 real users' passports and bank
statements and has **no backup** (BLK-1); it goes last, once the procedure is
proven.

## 1. Why this stack and not bare Postgres

Bare Postgres in Docker would not be a database move. Measured against this
repository:

- **214 files** import `@supabase/*`
- **222** uses of `auth.uid()` / `auth.jwt()` across **42** migrations
- **100+** GoTrue API calls: OAuth (Google + Azure, both enabled in
  production), anonymous sign-in for the guest funnel, TOTP MFA, admin user
  management

`auth.uid()` does not exist in bare Postgres. It is what all 140 RLS policies
use to keep one applicant's documents away from another's. This stack runs the
same GoTrue / PostgREST / storage-api components as hosted Supabase, so **no
application code changes at all.**

Postgres is pinned to `17.6.1.127` — the exact version the hosted project runs,
verified against the Management API. Same major *and* patch means a dump
restores without version-skew surprises.

## 2. Generate the secrets

The three values are linked: `ANON_KEY` and `SERVICE_ROLE_KEY` are JWTs **signed
with** `JWT_SECRET`. A mismatched set fails confusingly — GoTrue looks healthy
while PostgREST returns 401 on everything. Generate all three together:

```bash
cd infra/self-hosted
cp .env.example .env

python3 - <<'PY'
import base64, hmac, hashlib, json, secrets, time
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(role, secret):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    iat = int(time.time()); exp = iat + 10*365*24*3600
    p = b64(json.dumps({"iss":"supabase","role":role,"iat":iat,"exp":exp},separators=(',',':')).encode())
    s = b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{s}"
secret = secrets.token_urlsafe(48)
print("POSTGRES_PASSWORD=" + secrets.token_urlsafe(24))
print("JWT_SECRET=" + secret)
print("ANON_KEY=" + jwt("anon", secret))
print("SERVICE_ROLE_KEY=" + jwt("service_role", secret))
PY
```

Paste the four lines into `.env`. `.env` is gitignored — keep it that way.

## 3. Bring the stack up

```bash
docker compose up -d
docker compose ps            # all services healthy
./verify.sh                  # asserts auth, REST, storage and RLS all answer
```

Ports are offset +100 from the CLI dev stack (`54421` gateway, `54422`
Postgres), so this runs alongside it without collisions.

> **Memory:** Docker on this machine reports ~4 GB. This stack plus the CLI dev
> stack together will be tight. Stop the dev stack (`npx supabase stop`) before
> running both, or raise Docker's memory limit.

## 4. Dump each hosted project

**This is the step this environment blocked.** You need the database password
from *Dashboard → Project Settings → Database → Connection string* — the
**Session** URI, not the transaction pooler: `pg_dump` needs a session
connection.

> **Use what you already have.** `docs/production/vps-hardening/supabase-snapshot.sh`
> already implements this snapshot + restore, and documents the same session-vs-pooler
> requirement. It was written as a pre-migration rollback helper, and a migration
> snapshot is the same operation. Prefer it over the raw commands below; they are
> here so the sequence is legible.

```bash
export SUPABASE_ACCESS_TOKEN='<your PAT>'
REF=hupkwliknmemlmxkbnua          # start with qalabs, NOT VisaAI

npx supabase@latest link --project-ref "$REF"

# Three dumps — the roles/schema/data split matters. A single --data-only dump
# omits the auth schema, and losing auth.users means all logins die.
npx supabase@latest db dump --linked -f "$REF.roles.sql"  --role-only
npx supabase@latest db dump --linked -f "$REF.schema.sql"
npx supabase@latest db dump --linked -f "$REF.data.sql"   --data-only --use-copy
```

**Verify before restoring** — an empty dump restores "successfully":

```bash
grep -c "CREATE TABLE" "$REF.schema.sql"     # expect ~129 for VisaAI
grep -c "COPY " "$REF.data.sql"              # expect one per non-empty table
```

## 5. Restore into the self-hosted stack

```bash
PGPW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
PORT=$(grep '^POSTGRES_PORT=' .env | cut -d= -f2-)
CONN="postgresql://postgres:$PGPW@127.0.0.1:$PORT/postgres"

psql "$CONN" -v ON_ERROR_STOP=1 -f "$REF.roles.sql"
psql "$CONN" -v ON_ERROR_STOP=1 -f "$REF.schema.sql"
psql "$CONN" -v ON_ERROR_STOP=1 -f "$REF.data.sql"
```

`ON_ERROR_STOP=1` is not optional. Without it psql continues past failures and
you get a half-restored database that looks fine.

## 6. Verify the restore — object counts, not vibes

Run against **both** the hosted project and the self-hosted one, and diff:

```sql
select
  (select count(*) from pg_tables where schemaname='public')                as tables,
  (select count(*) from pg_policies where schemaname='public')              as policies,
  (select count(*) from pg_tables where schemaname='public' and rowsecurity) as rls_on,
  (select count(*) from auth.users)                                          as users,
  (select count(*) from storage.objects)                                     as objects;
```

For VisaAI the hosted side reads **129 tables / 140 policies / 129 RLS-enabled**
(audited 2026-08-06). Anything lower after restore means the dump was
incomplete — **do not cut over.**

Then prove RLS actually still bites, exactly as the audit did against hosted:

```bash
curl -s -o /dev/null -w '%{http_code} ' \
  "http://localhost:54421/rest/v1/auth_audit_log?select=*&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# expect 200 with a body of []  — 200 with rows means RLS did not survive
```

## 7. Storage objects are NOT in the dump

`pg_dump` captures `storage.objects` **metadata only**. The files themselves
live in Supabase's object store. Download them separately (VisaAI has one
private `documents` bucket) and place them under the `storage_data` volume, or
re-upload through the storage API. Skipping this leaves every document row
pointing at a file that does not exist.

## 8. Cut over

Only after §6 passes. Per app, change **three** variables:

```
SUPABASE_URL       -> http://<host>:54421
SUPABASE_ANON_KEY  -> ANON_KEY from .env
SUPABASE_SERVICE_ROLE_KEY -> SERVICE_ROLE_KEY from .env
```

Nothing else changes — that is the point of this stack.

Remember from `CLAUDE.md`: **`git push` does not deploy.** The VPS needs
`git pull` → rebuild → `pm2 restart`. And `NEXT_PUBLIC_*` are **build-time** for
`apps/web`, so the web app must be rebuilt, not just restarted.

**Keep the hosted projects running** until the self-hosted stack has served real
traffic. They are your rollback, and right now they are your only one.

## 9. What self-hosting does NOT give you

Worth being blunt, because the motivation for this move was "no limitations":

- **You now own backups.** Removing the free-plan limit removes the *limit*, not
  the *need*. Nothing in this stack backs anything up. Add `pg_dump` on a
  schedule to off-machine storage before this holds real data, or you have
  recreated BLK-1 with extra steps.
- **You own uptime, upgrades and security patches** for six services.
- **A single Docker host is a single point of failure.** The hosted project at
  least ran on managed infrastructure.

If the goal was purely to clear BLK-1, Supabase Pro (~$25/month) does that in
minutes with none of the above. Self-hosting is the right answer if you want
ownership and no per-project quotas — it is not the cheaper answer.

## 10. Once migrated, the audit's blocked work unblocks

These were all gated on BLK-1 and become runnable the moment you have a database
you control **and a backup of it**:

| ID | Work |
|---|---|
| SEC-001 | Re-key `account_lockouts` on `(email, ip)` so a remote attacker cannot lock a victim out |
| FAKE-003 | Apply `20260806160000_vri_unassessed_factors`, then render "Not assessed" instead of a fabricated percentage |
| DB-003 | `REVOKE` anon/authenticated DML on the 32 service-role-only tables |
| DB-004 | Bucket-level size/MIME limits — already set in this compose via `STORAGE_FILE_SIZE_LIMIT` |
| AUTH-001 | Password policy — already set in this compose via `GOTRUE_PASSWORD_MIN_LENGTH=12` |
| — | The 4 pending migrations, applied in version order |

Two of those (DB-004, AUTH-001) are **already configured in this stack**, so
migrating applies them for free.

---

## 11. Backups — the stack now takes them (BLK-1)

§9 warned that self-hosting removes the plan limit, not the *need*, and that
nothing in this stack backed anything up. That is no longer true: a `backup`
service runs `pg_dump` on a schedule.

```bash
docker compose up -d backup
docker compose logs -f backup      # "ok /backups/visaai-<stamp>.dump (N bytes)"
```

| Setting | Default | Notes |
|---|---|---|
| `BACKUP_INTERVAL_SECONDS` | `86400` | Also runs once immediately on start, so a fresh stack is never left unprotected waiting out the first interval |
| `BACKUP_RETENTION_DAYS` | `14` | Pruned **after** a successful dump, never before |
| `BACKUP_INITIAL_RETRY_SECONDS` | `60` | If the first dump after a (re)start fails, retry this soon instead of waiting a full interval |
| `BACKUP_INITIAL_RETRIES` | `30` | Attempts at start-up before falling back to the interval. After a host reboot the restart policy starts this container without waiting for `db` (`depends_on` only orders `docker compose up`), so the first attempt can hit "Connection refused" |

The container's health is its own check (`backup-health.sh`), not the image's
`pg_isready`: **healthy means a completed `visaai-*.dump` younger than two
intervals**. `docker ps` showing `unhealthy` therefore means backups have
stopped, and is worth acting on.

Design choices worth knowing:

- **Custom format (`-Fc`)** — compressed and selectively restorable with
  `pg_restore`, rather than an all-or-nothing SQL file.
- **`--no-owner --no-privileges`** — a restore that depends on identical role
  names existing first is a restore that fails at 3am.
- **Write to `.partial`, rename on success** — a truncated file must never look
  like a backup.
- **Size floor** — a dump under 10 KB is renamed `.suspect` and treated as a
  failure. `pg_dump` can exit 0 having written almost nothing.
- **Same image as `db`** — a pg_dump client older than the server refuses to
  dump at all.
- **Named volume, not a bind mount** — a dump of this database contains
  passports and bank statements and must not be one `git add -A` from a commit.

### What has actually been tested (corrected 2026-08-09)

A backup nobody has restored is a hypothesis. Verified against the local stack:

```
source:   133 tables / 143 policies / 1 application
restored: 133 tables / 143 policies / 1 application
```

`pg_restore` reports 2 ignored errors on `vault.secrets` — that table is owned
by `supabase_admin` and is not readable by `postgres`. Expected for a logical
dump; it does not affect application data. **Do not treat a clean-looking
restore as proof — diff the object counts, as above.**

### What this still is not

A dump sitting on the same Docker host as the database is **not disaster
recovery**: one lost machine loses both copies. Before this holds real data,
ship `/backups` off-host — restic or rclone to object storage, or a volume
mounted from another machine — and restore-test *that* copy too.

A scheduled CI job was deliberately **not** used: it would move a file
containing real users' passports into a third-party artifact store, trading an
availability risk for a confidentiality one.

---

## 12. Rehearsal results — 2026-08-09

The stack in this directory **had never started**. A full rehearsal (local
Supabase CLI stack as source → this stack as target) found four bugs that made
`docker compose up` impossible, and two that silently corrupted the migration.
All six are fixed; the procedure below is what was actually executed.

### Four bugs that stopped the stack starting

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | auth/rest/storage restart-loop, `28P01 password authentication failed for user "supabase_auth_admin"`, while `docker compose ps` shows db **healthy** | `POSTGRES_PASSWORD` sets only the `postgres` superuser. Every service role is created **passwordless** | `bootstrap/set-service-role-passwords.sh` one-shot |
| 2 | Cluster comes up with **no roles at all**, not even `postgres` | Bind-mounting a **directory** at `/docker-entrypoint-initdb.d` replaces the image's own role-creation scripts | Mount the single **file** |
| 3 | `ERROR: "authenticator" is a reserved role, only superusers can modify it` | The image's `demote-postgres` migration strips `postgres` of superuser; reserved roles need one | Two stages: initdb sets `supabase_admin`'s password, the sidecar then uses that superuser |
| 4 | `401 Invalid authentication credentials` on every `rest/v1` call, with `PGRST_JWT_SECRET` provably identical to `.env` | Kong's declarative config does **no** variable substitution — it registered the literal string `$SUPABASE_ANON_KEY` as the key | Render the template in the entrypoint, as upstream does |

Bug 4 is the nastiest: it reads exactly like a JWT-secret mismatch and is not one.

### Two bugs that corrupted the migration silently

**Extensions were not migrated.** `consultations_no_overlap` is a GiST index over
`tstzrange`, and without `btree_gist` the restore emitted

```
ERROR: data type uuid has no default operator class for access method "gist"
```

and carried on. The table arrived; the index did not. Nothing noticed except
`parity-check.sh`, which counted 347 indexes against the source's 348. There is
now an explicit extensions stage.

**The restore error counter counted nothing.** It grepped `^ERROR:`, but psql
writes `psql:/path/file.sql:123: ERROR:  …`. It reported a clean restore over a
broken one. Now matches anywhere in the line.

Restoring as `postgres` also produced **572** `must be owner of table` errors on
`auth.*` — `--disable-triggers` needs ownership. Restore as `supabase_admin`.

### The tested procedure

```bash
cd infra/self-hosted
cp .env.example .env          # then generate secrets per §2
docker compose up -d          # db-bootstrap must exit 0
./verify.sh                   # must print ALL CHECKS PASSED

./migrate.sh --source "postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres" --dry-run
./migrate.sh --source "postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres"
```

`migrate.sh` refuses to restore over a non-empty target, aborts on a suspiciously
small data dump, and ends by running `parity-check.sh` — which exits non-zero on
any difference and tells you not to cut over.

**Measured result of the rehearsal:**

| Check | Source | Target |
|---|---|---|
| public tables | 132 | 132 |
| views | 6 | 6 |
| RLS policies | 150 | 150 |
| tables with RLS on | 132 | 132 |
| functions | 27 | 27 |
| indexes | 348 | 348 |
| per-table row counts | 133 tables | **all match** |
| auth + storage tables | 33 tables | **all match** |

`verify.sh` still passes after the restore.

**~209 restore errors remain and are expected.** They are all
`already exists` / `multiple primary keys` / `duplicate key` against the `auth`
and `storage` schemas, because GoTrue and Storage create their own schemas at
init and the dump then re-applies them. The `public` schema restores cleanly.
Parity is what decides, not the error count.

### GoTrue version must not be behind production (found in the 2026-08-09 prod rehearsal)

The first real run against production failed parity on a SINGLE row:
`auth.schema_migrations` 77 (source) vs 76 (target), and the restore logged
`column "custom_claims_allowlist" of relation "custom_oauth_providers" does not
exist`.

Cause: the compose pinned `gotrue:v2.189.0`, which stops at auth migration
`20260302000000`. Production had already applied `20260625000000` (the one that
adds `custom_claims_allowlist`). A GoTrue that is BEHIND production cannot build
the auth schema production expects.

No application data was lost — `custom_oauth_providers` had 0 rows and
`auth.users` was 13/13 — but the auth SCHEMA was a version behind. Fix: bump the
`auth` image to at least the version production runs (bumped to `v2.195.0`),
recreate only the `auth` container, and let GoTrue apply the missing migration
against the existing data. `auth.users` is untouched by that.

Lesson for a real cutover: **pin every Supabase image at or above the versions
the hosted project runs**, and let `parity-check.sh` be the thing that tells you
when one is behind — it caught this off-by-one where an object-count check would
not have.

### Session continuity — decide before cutting over

§2 generates a **new** `JWT_SECRET`. Every access token issued by the hosted
project was signed with the **old** one, so at cutover:

- **Accounts survive.** `auth.users` carries the bcrypt hashes; passwords work.
- **Sessions do not.** Every signed-in user is silently logged out.

If that is unacceptable, reuse the hosted project's JWT secret (Supabase
dashboard → Settings → API → JWT Secret) as `JWT_SECRET` and regenerate
`ANON_KEY`/`SERVICE_ROLE_KEY` from it. Otherwise accept the mass logout and say
so in release notes. Either is defensible; discovering it at cutover is not.

`SUPABASE_JWT_SECRET` in `apps/api/.env` must be non-empty (the config schema
requires it) but is **read nowhere** — the API never verifies tokens locally, it
calls GoTrue. Set it for hygiene; it does not affect behaviour.

### Never regenerate `.env` against a live volume

The bootstrap runs only on an empty data directory. Changing `POSTGRES_PASSWORD`
after the stack has run leaves the roles on the old password while the services
pick up the new one — bug 1, with no obvious cause. Either
`docker compose down -v` (destroys data) or `ALTER ROLE` by hand.

### Still not covered

- **Storage objects.** `pg_dump` captures `storage.objects` metadata only; the
  files live in S3 behind the hosted Storage API (§7).
- **Production execution.** Needs the production database password, which the
  Management API does not expose by design.
