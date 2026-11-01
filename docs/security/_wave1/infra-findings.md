# VisaAI — Infrastructure, Edge, CI/CD & Dependency (SCA) Security Audit

Wave 1 — read-only static analysis. Scope: nginx/edge, Docker/docker-compose, GitHub
Actions CI/CD, dependency (SCA) audit, runtime/process, backups/DR, network
isolation. No files were edited, no SSH session was opened, no production system
was touched. Finding IDs SEC-7001–SEC-7012 (block 7000–7999).

Repo root: `/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI` (no `.git` remote probed —
all evidence is local working-tree content plus `git log`/`git ls-files` history
checks).

---

## Required deliverable (a): dependency-audit severity summary per workspace

`pnpm audit` in this pnpm version does **not** scope to `--filter` — verified
empirically: `pnpm --filter api audit --json`, `pnpm --filter web audit --json`
and `pnpm --filter mobile audit --json` all produced **byte-identical** output to
`pnpm audit --json` run at the repo root (`diff -q` confirmed). Per-workspace
attribution below was therefore derived from the `paths` array of each advisory
in the root audit, whose first path segment is the pnpm workspace importer name
(`apps__api`, `apps__web`, `apps__mobile`, `apps__extension`).

Root `pnpm audit --json` → `metadata.vulnerabilities`: `{"info":0,"low":2,"moderate":4,"high":5,"critical":0}` — **11 advisories total, 0 critical.**

| Workspace | Critical | High | Moderate | Low | Advisories | Network state |
|---|---|---|---|---|---|---|
| apps/api | 0 | 0 | 1 | 1 | 2 | live registry, HTTP 200 |
| apps/web | 0 | 2 | 3 | 1 | 6 | live registry, HTTP 200 |
| apps/mobile | 0 | 3 | 1 | 0 | 4 | live registry, HTTP 200 |
| apps/extension | 0 | 0 | 1 | 0 | 1 | live registry, HTTP 200 |
| packages/types | 0 | 0 | 0 | 0 | 0 | live registry, HTTP 200 |
| packages/partner-sdk | 0 | 0 | 0 | 0 | 0 | live registry, HTTP 200 |
| **root (deduplicated)** | **0** | **5** | **4** | **2** | **11** | live registry, HTTP 200 |

Per-app rows sum to more than 11 because `uuid` and `body-parser` each appear
under two-plus workspaces. Full breakdown:

| Package | Vulnerable range | Severity | Advisory | Workspaces | Dev-only? |
|---|---|---|---|---|---|
| `ip-address` | ≤10.3.0 | High | GHSA-mwp4-54f8-5fhr | apps/web | yes (Lighthouse CI chain) |
| `image-size` | ≤2.0.2 | High | GHSA-w3rx-r6r6-pgpr | apps/mobile | no (Metro/Expo build toolchain) |
| `image-size` | ≤2.0.2 | High | GHSA-5p2g-fcmc-qvqq | apps/mobile | no |
| `extract-zip` | ≤2.0.1 | High | GHSA-jmr9-qjv8-65gv | apps/web | yes (Lighthouse CI chain) |
| `nanoid` | <3.3.18 | High | GHSA-2v37-7h3g-55p8 | apps/mobile | no (Expo/Metro toolchain) |
| `uuid` | <11.1.1 | Moderate | GHSA-w5hq-g745-h8pq | apps/api, apps/web, apps/mobile | api: **no**, see SEC-7010 |
| `esbuild` | ≤0.24.2 | Moderate | GHSA-67mh-4wv8-2f99 | apps/extension | yes (ts-jest chain) |
| `ip-address` | 10.1.1–10.2.1 | Moderate | GHSA-4xrf-jv44-h6hh | apps/web | yes |
| `ip-address` | 10.1.1–10.2.0 | Moderate | GHSA-22jq-vg5j-6vgg | apps/web | yes |
| `body-parser` | ≥2.0.0 <2.3.0 | Low | GHSA-v422-hmwv-36x6 | apps/api | no |
| `body-parser` | <1.20.6 | Low | GHSA-v422-hmwv-36x6 | apps/web | no |

**`scripts/check-vulnerable-deps.mjs` — re-run live, not trusted from its docstring:**
this script is the repo's only *blocking* dependency gate. It checks a hand-maintained
`FLAGGED` list of 5 packages (`image-size`, `ip-address`, `body-parser`, `esbuild`,
`uuid`) for `require.resolve(pkg, {paths:[app]})` reachability from `apps/api` and
`apps/web` only. Executed fresh (`node scripts/check-vulnerable-deps.mjs`):

```
dependency gate: 5 flagged package(s) checked against apps/api, apps/web — none reachable
```

Exit 0 — the gate currently passes. See **SEC-7010** for a methodological blind
spot found while verifying this: `uuid@10.0.0` (GHSA-w5hq-g745-h8pq) *is* present
in `apps/api`'s resolved dependency graph (via `@langchain/langgraph-checkpoint`,
a **runtime**, not dev, dependency) but the gate reports it as unreachable because
of how pnpm's strict `node_modules` isolation interacts with `require.resolve`.

No CRITICAL findings exist in the dependency graph. No package name in the graph
resembles a known typosquat of a popular package (spot-checked the 5 `FLAGGED`
names, `axios`, `sharp`, `ws`, `uuid`, `js-yaml`, `postcss`, `form-data`, `multer`,
`tmp`, `shell-quote`, `fast-uri`, `brace-expansion` — all legitimate, and all are
pinned to patched minimums in `pnpm-workspace.yaml`'s `overrides:` block, evidence
below). No `package.json` in any workspace declares `preinstall`/`install`/
`postinstall` scripts (checked all 7 manifests). No dependency in any workspace
`package.json` or in `pnpm-lock.yaml` resolves from a `git+`, `http(s)://`,
`github:` or `file:` source — `grep -rnE '"(git\+|https?://|file:|github:)'`
against every tracked `package.json` and a `resolution:.*(git|tarball):` grep
against `pnpm-lock.yaml` both returned zero hits.

`pnpm-workspace.yaml:14-30` — pre-existing supply-chain hardening from a prior
audit (Task 14), confirmed still in force:
```
overrides:
  'axios@>=1.0.0 <1.18.0': '^1.19.0'
  'brace-expansion@1': '^1.1.18'
  ...
  'uuid@11': '^11.1.1'
  'ws@8': '^8.21.2'
```
Note this override only constrains `uuid@11.x` resolutions to `>=11.1.1`; it does
**not** touch the `uuid@10.0.0` resolution pulled in transitively by
`@langchain/langgraph-checkpoint`, which is a different major version and outside
the override's semver selector. That resolution is exactly the one SEC-7010
describes as invisible to the reachability gate.

---

## Required deliverable (b): exposed ports / services table

| Port | Bind address | Service | Where defined | Reachability |
|---|---|---|---|---|
| 80 | `0.0.0.0` (implicit) | nginx — `visaai.co`, `www.visaai.co`, `api.visaai.co` | `deploy/nginx/visaai.co.conf:16,33` | Public — intended |
| 443 | not present in the file the repo documents as the one to install | nginx TLS | Only in `docs/production/vps-hardening/nginx/visaai.co.hardened.conf` (marked EXAMPLE, not wired to any deploy hook) | **NOT VERIFIED** — see SEC-7004/SEC-7006 |
| 3000 | `127.0.0.1` per pm2 config | Next.js web app | `docs/production/vps-hardening/ecosystem.config.js:127-133` | Committed nginx configs proxy to `:3000`; operator's own script comments (`cutover.sh:14-16`, dated 2026-08-10) say the **live** nginx proxies web to `:3002` instead — see SEC-7006 |
| 4000 | `127.0.0.1` per pm2 intent | NestJS API | `deploy/nginx/visaai.co.conf:40` | Repo's parent `CLAUDE.md` records this port as independently reachable over plain HTTP, bypassing nginx and TLS entirely (tracked there as `DEPLOY-002`) — **NOT VERIFIED** current status, this audit did not touch the VPS |
| 54421 | `127.0.0.1` (explicit) | Kong — self-hosted Supabase gateway | `infra/self-hosted/docker-compose.yml:220` | Loopback-only, **CONFIRMED** correct — the file's own comment (lines 213-219) documents that this used to be bound to `0.0.0.0` and was fixed after being "verified reachable from the internet" |
| 54422 | **none specified** (Docker default `0.0.0.0`) | Postgres — self-hosted, holds passports/bank statements | `infra/self-hosted/docker-compose.yml:40-41` | **Published on all interfaces unless a host firewall blocks it** — see SEC-7002 |
| — (no `ports:` block) | container-network only | `auth` (GoTrue, 9999), `rest` (PostgREST, 3000-in-container), `storage` (storage-api, 5000-in-container), `meta` (postgres-meta, 8080-in-container) | `infra/self-hosted/docker-compose.yml` (absence of a `ports:` key under each service) | Not published to the host at all — reachable only via the shared docker-compose bridge network (kong, `db`, or each other); no `networks:` segmentation is defined so every container can reach `db:5432` directly |

---

## Required deliverable (c): what security gating CI does today

The repository has exactly one workflow, `.github/workflows/agent-tests.yml`. Its
security-relevant controls are: a `secret-scan` job that runs `gitleaks/gitleaks-action@v2`
over full git history plus a hand-rolled `grep` for JWT/Supabase-PAT-shaped strings
in tracked source (both **blocking**); a **non-blocking** (`continue-on-error: true`)
`pnpm ... audit --audit-level=high` in the `api` and `mobile` jobs; a **non-blocking**
`google/osv-scanner-action` run against `pnpm-lock.yaml` in the `api` job; the
**one blocking** dependency control, `node scripts/check-vulnerable-deps.mjs`,
which fails the build only if one of 5 hand-curated package names is
`require.resolve`-reachable from `apps/api` or `apps/web` — a narrow allow-list
gate, not a general vulnerability scanner (see SEC-7010 for its blind spot);
`shellcheck` over `infra/scripts/*.sh` and `docs/production/vps-hardening/*.sh`;
a CycloneDX SBOM generation step plus a GPL-license-in-distributed-artifact guard;
a PII-in-analytics-event-props regex guard; and a mobile-app-bundle grep guard
against server-side secret names leaking into the Expo bundle. **There is no SAST
tool anywhere in CI** — no CodeQL, Semgrep, Snyk Code, or equivalent static
security analysis — and **no Dependabot or Renovate configuration exists**
(confirmed: `find . -iname "dependabot*" -o -iname "renovate*"` returned nothing),
so dependency currency depends entirely on a human periodically re-running
`osv-scanner`/`pnpm audit` and hand-updating the `FLAGGED` list and the
`pnpm-workspace.yaml` `overrides:` block.

---

## SEC-7001

**Title:** nginx forwards a client-controlled `X-Forwarded-For` value to the app, defeating `trust proxy 1` and every IP-keyed control behind it

**Severity:** HIGH

**Affected component:** Edge (nginx) ↔ apps/api trust boundary

**Affected profile(s):** All (unauthenticated and authenticated)

**Affected page/API:** Every route behind `api.visaai.co` — specifically the
per-IP `ThrottlerModule` rate limiter and any IP-keyed account-lockout logic

**Description:** `apps/api/src/main.ts:31` sets `app.set('trust proxy', 1)`, with
an explicit comment (lines 28-30) explaining why: *"Behind nginx: trust the proxy
so `req.ip` / X-Forwarded-For resolve to the real client. Without this the per-IP
throttler and login-lockout collapse every caller into one bucket."* Express's
`trust proxy = 1` strips exactly **one** hop from the right of `X-Forwarded-For`
(the immediate TCP peer, i.e. nginx) and trusts whatever remains as the client IP.
That design only works if nginx **overwrites** `X-Forwarded-For` with the true
connecting IP before forwarding. Both nginx configs in the repo instead do:

```
# deploy/nginx/visaai.co.conf:26 (web) and :46 (api)
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```
```
# docs/production/vps-hardening/nginx/visaai.co.hardened.conf:108,152,168 — same pattern in the "hardened" example
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

`$proxy_add_x_forwarded_for` **appends** `$remote_addr` to whatever
`X-Forwarded-For` the client already sent — it does not replace it. A client that
sends `X-Forwarded-For: 203.0.113.7` (any IP it likes) reaches nginx, which
forwards `X-Forwarded-For: 203.0.113.7, <real-peer-ip>`. `trust proxy 1` strips
the rightmost entry (the real peer, i.e. nginx's own view of the connection) and
accepts the *attacker-supplied* `203.0.113.7` as `req.ip`.

**Attack scenario:** An attacker brute-forcing login or OTP endpoints sends a
fresh, random `X-Forwarded-For` value on every request. Each request is bucketed
under a different (fabricated) `req.ip` by `ThrottlerModule` (`apps/api/src/app.module.ts:91-94`,
default `THROTTLE_LIMIT` 60/min) and by any IP-keyed lockout table, so the
per-IP limit never accumulates against the real attacker. The same primitive lets
an attacker's real IP disappear from access/audit logs that record `req.ip`. If
`apps/api:4000` is also reachable directly (bypassing nginx entirely — see the
exposed-ports table, `DEPLOY-002` in the parent `CLAUDE.md`, **NOT VERIFIED** on
this pass), the attacker does not even need nginx in the loop: they can set
`X-Forwarded-For` directly on a raw connection to `:4000` and have it fully
trusted, since `trust proxy 1` strips one hop regardless of whether a real
reverse proxy is actually present.

**Business impact:** Rate limiting and brute-force lockout — controls this
codebase explicitly built to protect login/OTP flows — are bypassable by anyone
willing to rotate a request header. For a platform storing passports and financial
documents, this converts a "slow, rate-limited" credential-stuffing risk into a
functionally unthrottled one.

**Evidence:**
- `apps/api/src/main.ts:28-31` — `app.set('trust proxy', 1);` and the comment explaining the IP-throttling dependency.
- `deploy/nginx/visaai.co.conf:26` — `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (web block)
- `deploy/nginx/visaai.co.conf:46` — same directive, api block.
- `docs/production/vps-hardening/nginx/visaai.co.hardened.conf:108,152,168` — same pattern, present in **all three** locations of the "hardened" reference config, i.e. this was not fixed in the hardening pass either.
- `apps/api/src/app.module.ts:91-94` — `ThrottlerModule.forRoot([{ ..., limit: Number(process.env.THROTTLE_LIMIT ?? 60) }])`, confirming the throttle is the control this header feeds.

**Root cause:** nginx's `X-Forwarded-For` handling was written assuming
`$proxy_add_x_forwarded_for` is "the correct default" without accounting for the
specific value Express's numeric `trust proxy` mode trusts. The two need to agree:
either nginx must overwrite (not append) the header, or the app must trust proxy
by *count of known reverse proxies* combined with nginx stripping any
client-supplied `X-Forwarded-For` first.

**Remediation:** In every `location` block proxying to the app, change:
```
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```
to:
```
proxy_set_header X-Forwarded-For $remote_addr;
```
This makes nginx the sole author of the header nginx's own peer address produces,
which is exactly what `trust proxy 1` expects to consume. (If a CDN/another proxy
is ever placed in front of nginx, `trust proxy` must become a matching hop count
and nginx must use `real_ip` module + `set_real_ip_from` for the CDN's ranges,
not this single-line fix alone.) Apply the same change to the `/sbkong/`
location block `cutover.sh` inserts at runtime (`infra/self-hosted/cutover.sh:127`),
which has the identical pattern.

**Suggested regression test:** An integration test that starts the API with
`trust proxy=1`, sends two requests with different spoofed `X-Forwarded-For`
values but the same real socket peer, and asserts `ThrottlerGuard` buckets them
identically (i.e., the header is ignored for throttling purposes once nginx is
fixed). At the infra layer, a smoke test in `infra/scripts/smoke-test.sh` that
curls the API with a forged `X-Forwarded-For` and confirms the header nginx
actually forwards (visible via a debug endpoint or access log) always equals the
real peer address.

**Confidence:** CONFIRMED

---

## SEC-7002

**Title:** Self-hosted Postgres container publishes port 54422 without a loopback bind — default Docker behavior exposes the database to every interface

**Severity:** CRITICAL

**Affected component:** `infra/self-hosted` Docker Compose stack — `db` service

**Affected profile(s):** All (unauthenticated network attacker, if the port is
in fact internet-reachable)

**Affected page/API:** N/A — direct database protocol access, not an application
endpoint

**Description:** In Docker Compose's short port syntax, `"HOST:CONTAINER"`
without a leading IP binds the host side to **all interfaces** (`0.0.0.0`) by
default. The `db` service does exactly that:

```yaml
# infra/self-hosted/docker-compose.yml:40-41
    ports:
      - '${POSTGRES_PORT:-54422}:5432'
```

Contrast this with the `kong` service four services later in the **same file**,
which explicitly scopes to loopback and documents *why* in an inline comment:

```yaml
# infra/self-hosted/docker-compose.yml:213-220
    # Loopback ONLY. `'54421:8000'` binds 0.0.0.0, which published the whole
    # Supabase API — including /auth/v1/token and /auth/v1/signup — on plain
    # HTTP at the box's public IP, bypassing nginx and TLS. Verified reachable
    # from the internet before this change. nginx (`location /sbkong/`) is the
    # only intended entry point; apps/api talks to 127.0.0.1:54421 directly,
    # and both still work with a loopback bind.
    ports:
      - '127.0.0.1:${KONG_HTTP_PORT:-54421}:8000'
```

The authors of this file already found and fixed exactly this class of bug for
`kong`, with the comment itself proving they knew "verified reachable from the
internet" was the actual, tested consequence of an unscoped bind — but the
identical pattern remains on `db`, which is a strictly higher-value target than
Kong (raw superuser-adjacent SQL access vs. an API gateway sitting behind
key-auth). There is no top-level `networks:` block in the compose file to
otherwise restrict this, and no other file in the repository provisions a host
firewall (no `ufw`/`iptables` script exists anywhere under `infra/` or `deploy/`).

**Attack scenario:** If the VPS's host firewall does not separately block
54422/tcp (a fact this audit cannot verify without SSH access, which was
explicitly out of scope), any internet host can open a raw Postgres connection
to `<vps-ip>:54422`. Given the `postgres` superuser password (see SEC-7003 for
why every other role shares that same password), an attacker with the password —
from a leak, a misconfigured `docker inspect`-readable environment, or brute
force against a weak generated secret — gets direct, unmediated superuser access
to a database holding real users' passports and bank statements, with **zero**
of the RLS policies, PostgREST/GoTrue auth layers, or nginx rate limiting that
protect every other path into this data.

**Business impact:** This is the single most severe possible outcome for an
immigration-document platform: unauthenticated network-path proximity to the
entire dataset, contingent only on host-firewall configuration that lives
outside version control and therefore outside this audit's or any future code
review's visibility.

**Evidence:** `infra/self-hosted/docker-compose.yml:40-41` (vulnerable), compared
directly against `infra/self-hosted/docker-compose.yml:213-220` (the fixed
pattern, in the same file, for a different service).

**Root cause:** Inconsistent application of a fix the team already knew about and
had already applied to a sibling service in the same file.

**Remediation:** Bind explicitly to loopback, exactly as `kong` does:
```yaml
    ports:
      - '127.0.0.1:${POSTGRES_PORT:-54422}:5432'
```
`migrate.sh` and `parity-check.sh` already connect via `127.0.0.1:${POSTGRES_PORT}`
(`infra/self-hosted/migrate.sh:65`, `infra/self-hosted/parity-check.sh:31`), so
this change requires no changes to either operator script. Independently, **the
operator should verify the host firewall** — this is a defense-in-depth fix, not
a substitute for one.

**Suggested regression test:** Add a check to `infra/self-hosted/verify.sh` that
runs `ss -ltn '( sport = :'"${POSTGRES_PORT:-54422}"' )'` (already used in the
same style in `vps-bootstrap.sh:49`) and asserts the listening address shown is
`127.0.0.1:*`, not `*:*` or `0.0.0.0:*`, failing loudly otherwise.

**Confidence:** CONFIRMED (the compose misconfiguration itself). Actual internet
reachability is **NOT VERIFIED — requires operator check on host**. Run, from
outside the VPS's network: `nmap -p 54422 <vps-public-ip>` (expect `filtered` or
`closed`), and on the host itself: `sudo ss -ltnp | grep 54422` and
`sudo ufw status verbose` (or `iptables -L -n` if ufw is not in use) to confirm a
firewall rule independently blocks the port.

---

## SEC-7003

**Title:** Every Supabase service role (`authenticator`, `supabase_auth_admin`, `supabase_storage_admin`, …) is provisioned with the *same* password as the `postgres` superuser — no credential separation between privilege tiers

**Severity:** HIGH

**Affected component:** `infra/self-hosted/bootstrap/set-service-role-passwords.sh`

**Affected profile(s):** All (amplifies the impact of SEC-7002 and of any leak of
any single container's `DATABASE_URL`)

**Affected page/API:** N/A — database credential architecture

**Description:** The self-hosted stack's role-bootstrap sidecar sets a password
for 10 distinct Postgres roles — including the low-privilege `authenticator`
role that PostgREST uses for every anonymous/authenticated REST request — and
uses the **same** `POSTGRES_PASSWORD` value (the superuser's own password) for
every one of them:

```bash
# infra/self-hosted/bootstrap/set-service-role-passwords.sh:41,44,79-86
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
...
export PGPASSWORD="$POSTGRES_PASSWORD"
...
ROLES=(
  authenticator
  supabase_auth_admin
  supabase_storage_admin
  supabase_admin
  supabase_functions_admin
  supabase_read_only_user
  supabase_replication_admin
  supabase_etl_admin
  supabase_privileged_role
  pgbouncer
)
...
  psql -h "$HOST" -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 -tA \
       -v pw="$POSTGRES_PASSWORD" -v role="$role" <<'SQL' |
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role', :'pw');
SQL
```

Every one of the 10 roles — spanning read-only, replication, ETL, and the
`authenticator` role PostgREST authenticates as for every REST call — is set to
`POSTGRES_PASSWORD`. This value is also embedded in plaintext as a container
environment variable on multiple services (`rest`'s `PGRST_DB_URI`, `storage`'s
`DATABASE_URL`, `auth`'s `GOTRUE_DB_DATABASE_URL` — `infra/self-hosted/docker-compose.yml:91,133,155`),
each interpolating `${POSTGRES_PASSWORD}` directly into a connection string that
`docker inspect <container>` (available to anyone with docker-group or root
access on the host) will reveal in plaintext.

**Attack scenario:** Any credential leak that exposes ONE role's connection
string — e.g. the `rest` container's `PGRST_DB_URI` via a misconfigured log
line, a `docker inspect` run by an operator debugging something unrelated, or a
container-escape in any one of the 6 services — hands the attacker the
superuser password, not just that one role's scoped privileges. This defeats the
entire point of running separate least-privilege service roles: the privilege
boundary Supabase's own architecture is built on (an anonymous PostgREST caller
should only ever be as powerful as `authenticator`'s grants) collapses the
moment any one role's credential is captured, because they all unlock the same
superuser account too.

**Business impact:** Removes defense-in-depth between the lowest-privilege,
most internet-adjacent role (`authenticator`, hit by every anonymous REST
request) and full database ownership. Combined with SEC-7002 (the port this
credential would be used against), this converts "leak one container's env" into
"own the whole database."

**Evidence:** `infra/self-hosted/bootstrap/set-service-role-passwords.sh:41,44,79-86`
(full logic quoted above); `infra/self-hosted/docker-compose.yml:91` (`GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/...`), `:133` (`PGRST_DB_URI: postgres://authenticator:${POSTGRES_PASSWORD}@db:5432/...`), `:155` (`DATABASE_URL: postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@db:5432/...`).

**Root cause:** The bootstrap script's own docstring (lines 31-38) explains the
*mechanical* problem it's solving (every non-`postgres` role is created
passwordless by the image, so something must set one) but the chosen solution —
reusing the single `POSTGRES_PASSWORD` value for all of them — optimizes for
bootstrap simplicity over credential isolation.

**Remediation:** Generate a distinct random password per role (the script
already has a loop over `ROLES`; a per-role `secrets.token_urlsafe()` value
generated once in `vps-bootstrap.sh`'s `.env`-generation block, alongside
`POSTGRES_PASSWORD`, and passed to the bootstrap sidecar as a small role→password
map, is a contained change). At minimum, `authenticator` — the role every
anonymous REST request authenticates as — should never share a credential with
`postgres`.

**Suggested regression test:** Extend `infra/self-hosted/verify.sh` to assert
`authenticator`'s password differs from `POSTGRES_PASSWORD` — e.g. attempt a
`psql` connection as `authenticator` using `$POSTGRES_PASSWORD` and assert it
**fails** once role passwords are separated (currently it would succeed, which
is the bug).

**Confidence:** CONFIRMED

---

## SEC-7004

**Title:** The nginx config the repo instructs the operator to install has no TLS block, no HSTS, no security headers, no rate limiting, and no `server_tokens off` — all of it deferred to a manual certbot run and an unwired "example" file

**Severity:** HIGH (as committed content); live status **NOT VERIFIED**

**Affected component:** Edge — `deploy/nginx/visaai.co.conf`

**Affected profile(s):** All

**Affected page/API:** All of `visaai.co`, `www.visaai.co`, `api.visaai.co`

**Description:** `deploy/nginx/visaai.co.conf` is the file whose own header
comment gives the exact install command (`sudo cp deploy/nginx/visaai.co.conf
/etc/nginx/sites-available/visaai.co`, lines 4-8) — i.e., this is the config the
repository presents as canonical. As committed, it defines only `listen 80`
server blocks (lines 16, 33) with no TLS, no `Strict-Transport-Security`, no
`X-Content-Type-Options`, no `X-Frame-Options`, no `Content-Security-Policy`, no
`limit_req` rate limiting, and no `server_tokens off;` (confirmed by `grep -n
"server_tokens|autoindex"` against both nginx files in the repo — zero matches
in either). The file's own comment (lines 9-13) states TLS is added only by a
manual, one-time `certbot --nginx` invocation that "rewrites these blocks", and
explicitly warns: *"NOTE: this file is version-controlled for reference. Your
git auto-deploy hook pulls app code only — it does NOT copy this into
/etc/nginx. Apply it once manually (above), or extend your deploy hook to sync +
reload it."*

A second file, `docs/production/vps-hardening/nginx/visaai.co.hardened.conf`,
does add HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, and `limit_req` rate limiting — but its own header marks
it `# EXAMPLE — REVIEW BEFORE USE` and it lives under `docs/production/`, not
`deploy/`, with no CI or deploy-hook reference to it anywhere in the repository
(`grep -rn "visaai.co.hardened.conf"` outside `docs/` returns nothing).

**Attack scenario:** Whichever of these two files is actually live on the VPS
today, the repository's own account of its edge posture is either (a) the
committed "canonical" file, which ships with zero of the standard baseline
protections (no forced HTTPS redirect defined in-file, no HSTS, no clickjacking/
MIME-sniffing protection, no DoS-mitigating rate limiting), or (b) an
undocumented manual divergence from every file in version control, which is
itself SEC-7006. Either way, a downgrade/strip attack, clickjacking attempt, or
a burst of unthrottled requests hits an edge with no committed protection
against it.

**Business impact:** These are exactly the headers OWASP and most compliance
frameworks treat as baseline hygiene for a service handling PII; their absence
is a straightforward, low-effort-to-fix finding that any external auditor or
penetration test would flag immediately.

**Evidence:** `deploy/nginx/visaai.co.conf:1-51` (full file quoted in the initial
recon — no `listen 443`, no `add_header`, no `limit_req` anywhere); comment at
lines 9-13 explicitly stating the deploy hook does not sync this file to
`/etc/nginx`; `docs/production/vps-hardening/nginx/visaai.co.hardened.conf:1-2`
(`# EXAMPLE — REVIEW BEFORE USE`).

**Root cause:** Security hardening was written as a separate, opt-in reference
document (`docs/production/vps-hardening/`) rather than being merged into the
one file the repo's own comments point the operator at as canonical.

**Remediation:** Replace `deploy/nginx/visaai.co.conf` with the content of
`visaai.co.hardened.conf` (after review — see SEC-7001 for one bug still present
in the hardened file itself, and add `server_tokens off;` at the `http{}` level,
which neither file sets). Then either wire the deploy hook to sync+reload nginx
on every deploy (the file's own comment suggests this as an option), or document
a periodic manual verification step so the live config cannot silently drift from
git again.

**Suggested regression test:** `infra/scripts/smoke-test.sh` already checks for
`strict-transport-security` and `x-content-type-options` response headers on the
web origin (lines 38-47) — extend it to also assert on `x-frame-options`,
`referrer-policy`, and (via `openssl s_client`) that port 443 is actually
listening and redirects from 80, then run it from CI against a staging host on
every deploy, not just locally post-deploy.

**Confidence:** CONFIRMED for repository content. Live-server state is
**NOT VERIFIED — requires operator check on host**: run
`sudo nginx -T | less` on the VPS and diff it against both files in this repo, or
run `curl -sI https://visaai.co/ | grep -i 'strict-transport\|x-frame\|x-content'`
from outside the VPS.

---

## SEC-7005

**Title:** apps/web (Next.js, `visaai.co`) sets no security headers at the application layer — full reliance on an edge configuration that SEC-7004 shows is not reliably present

**Severity:** MEDIUM

**Affected component:** `apps/web`

**Affected profile(s):** All web visitors

**Affected page/API:** Every page served by `apps/web`

**Description:** `apps/api` has an explicit, dependency-free middleware that sets
a baseline header set on every response (`apps/api/src/common/security-headers.middleware.ts`,
full file quoted below), and its own comment states the intended design: *"the
edge (nginx) should also set these ... so they survive even if a request bypasses
the app."* No equivalent exists for `apps/web`. `apps/web/next.config.ts` is a
14-line file containing only an `i18n` plugin wrapper and `typedRoutes: true` —
no `headers()` export, no CSP, no `helmet`-equivalent:

```ts
// apps/web/next.config.ts (full content)
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')
const nextConfig: NextConfig = {
  typedRoutes: true,
}
export default withNextIntl(nextConfig)
```

`grep -rln "Content-Security-Policy|helmet|Strict-Transport-Security"
apps/web/next.config.* apps/web/middleware.ts` returns nothing.

```ts
// apps/api/src/common/security-headers.middleware.ts (full file)
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
}
```

**Attack scenario:** Given SEC-7004 (the committed "canonical" nginx config sets
no headers either), the practical result today is that `visaai.co` — the origin
a user's browser actually loads and where session cookies/tokens are used — may
be serving zero clickjacking, MIME-sniffing, or transport-security protection at
either layer. `api.visaai.co` is protected in-app regardless of the edge; `visaai.co`
is not.

**Business impact:** Absence of `X-Frame-Options`/frame-ancestors CSP makes
clickjacking against the web UI (e.g. an invisible iframe over a "confirm
submission" button) unmitigated at the framework layer; absence of HSTS leaves
the browser without an enforced upgrade-to-HTTPS memory, relevant to any user who
ever types `http://visaai.co`.

**Evidence:** `apps/web/next.config.ts:1-14` (full file, no `headers()`);
`apps/api/src/common/security-headers.middleware.ts:1-29` (full file, contrast).

**Root cause:** Header hardening was implemented once, for the API, and not
mirrored to the web app — the API's own comment anticipated edge-layer coverage
for the rest, which SEC-7004 shows is unreliable.

**Remediation:** Add a `headers()` function to `apps/web/next.config.ts`
returning the same baseline set the API middleware already uses (HSTS,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` or a `frame-ancestors`
CSP directive, `Referrer-Policy`, `Permissions-Policy`). This is a same-shaped,
low-risk change mirroring code that already exists and is already tested in
`apps/api`.

**Suggested regression test:** A Playwright or `curl`-based assertion (the repo
already has Playwright E2E infra — `apps/web/e2e/`) that fetches `/` and asserts
the same header set SEC-7004's regression test checks, run against the `web`
CI job's built app.

**Confidence:** CONFIRMED

---

## SEC-7006

**Title:** The nginx configuration files committed to this repository do not match the operator's own documented account of what is live in production — the repo cannot be treated as ground truth for the edge

**Severity:** MEDIUM (process/verifiability finding; it undermines confidence in SEC-7001, SEC-7004 and SEC-7005 as descriptions of the *live* system, though not as descriptions of repo content)

**Affected component:** Edge configuration management / deploy process

**Affected profile(s):** N/A (process finding)

**Affected page/API:** N/A

**Description:** Both nginx files in this repository proxy the web app to
`127.0.0.1:3000`:
```
# deploy/nginx/visaai.co.conf:20
proxy_pass http://127.0.0.1:3000;
```
```
# docs/production/vps-hardening/nginx/visaai.co.hardened.conf:54
upstream visaai_web { server 127.0.0.1:3000 max_fails=3 fail_timeout=15s; }
```
and `docs/production/vps-hardening/ecosystem.config.js:127` starts the app with
`args: 'start -p 3000'`. But `infra/self-hosted/cutover.sh:8-16` — a script whose
header explicitly states its assumptions were *"verified 2026-08-10 on
srv1584195"* — records:
```
#   * nginx: visaai.co -> localhost:3002 (TLS, cert visaai.co); api.visaai.co ->
#     localhost:4000 (:80, TLS at Cloudflare).
```
and the same script's regex-based nginx patcher at `cutover.sh:137` explicitly
matches on port `3002`, not `3000`:
```python
m=re.search(r"    location / \{\n        proxy_pass http://(?:localhost|127\.0\.0\.1):3002;", s)
```
i.e., the operator's own tooling, written and tested against the real host on
2026-08-10, hard-codes the assumption that production nginx proxies to `:3002` —
a port that appears nowhere in either committed nginx config or in
`ecosystem.config.js`. This is also consistent with this user's own standing
notes (VisaAI VPS memory: *"web is port 3002 not 3000 (3000 = GoQA)"* — the VPS
host is shared with another product on `:3000`).

**Attack scenario:** N/A directly — this is a documentation/config-integrity gap,
not itself an exploit. Its consequence is that SEC-7001, SEC-7004, and SEC-7005
above, all sourced from the committed nginx files, may not describe what is
actually running. A reviewer (or this audit) reading only the repository cannot
know the live edge's true header/TLS/rate-limit posture, and worse — an operator
following `deploy/nginx/visaai.co.conf`'s own install instructions verbatim
today would install a config pointing at the *wrong port* for the currently-live
web process.

**Business impact:** Any security control this audit or a future one recommends
at the nginx layer risks being applied to the wrong file, or assumed-fixed when
the live config was never touched, purely because there is no single verified
source of truth.

**Evidence:** `deploy/nginx/visaai.co.conf:20` vs. `infra/self-hosted/cutover.sh:14-16,137`
(quoted above); `docs/production/vps-hardening/ecosystem.config.js:127`.

**Root cause:** No mechanism syncs `/etc/nginx/sites-enabled/visaai.co` on the
VPS back into version control, and the port the live app actually listens on
(`3002`, per the shared-host constraint) was never reconciled into the
`deploy/nginx/visaai.co.conf` / `ecosystem.config.js` files that document `3000`.

**Remediation:** Pull the live config (`sudo nginx -T` on the VPS) and commit it
verbatim as the new canonical `deploy/nginx/visaai.co.conf`, correcting the port
to whatever is actually in use, then apply the SEC-7001/SEC-7004 fixes on top of
*that* file. Going forward, either wire nginx reload into the deploy hook (so git
and `/etc/nginx` cannot diverge) or add a scheduled job that diffs `nginx -T`
against the committed file and alerts on drift.

**Suggested regression test:** A `infra/scripts/preflight.sh`-style check (that
script already asserts env-file properties before deploy — see its lines 27-34)
extended to fetch the live nginx config and fail the deploy if the `proxy_pass`
port for the web upstream doesn't match `ecosystem.config.js`'s configured port.

**Confidence:** CONFIRMED as an internal inconsistency in the repository's own
files. Which port/config is actually live is **NOT VERIFIED — requires operator
check on host**: run `sudo nginx -T | grep -A3 'server_name visaai.co'` and
`pm2 describe visaai-web | grep -i port` on the VPS.

---

## SEC-7007

**Title:** GitHub Actions workflow sets no `permissions:` block — every job's `GITHUB_TOKEN` runs with the repository/org default rather than an explicit least-privilege grant

**Severity:** MEDIUM

**Affected component:** `.github/workflows/agent-tests.yml`

**Affected profile(s):** N/A (CI/CD supply chain)

**Affected page/API:** N/A

**Description:** `grep -n "^permissions:\|  permissions:" .github/workflows/agent-tests.yml`
returns zero matches — no `permissions:` key exists at the workflow level or
inside any of the 8 jobs (`api`, `tenant-isolation`, `web`, `web-e2e-live`,
`extension`, `mobile`, `secret-scan`, `infra`). Without an explicit grant, every
job's automatic `GITHUB_TOKEN` receives whatever the **repository or
organization default** permission policy is set to (a setting that lives outside
this repo, in GitHub's UI, and is therefore invisible to code review). If that
org-level default is the pre-2023 GitHub default (`read/write` on nearly
everything), every job — including ones that install and execute third-party
`postinstall` scripts via `pnpm install`, run arbitrary npm-published test
frameworks, and (in `web-e2e-live`) boot the full compiled API — has a token
capable of pushing commits, opening/modifying PRs, and writing packages, for the
full duration of the job.

**Attack scenario:** A compromised or malicious transitive dependency executing
during `pnpm install --frozen-lockfile` (any of the 8 jobs) could, if the
effective token has write scope, use `GITHUB_TOKEN` from within the job to push
a branch, open a PR, or otherwise pivot from "ran code in CI" to "wrote to the
repository" without needing any additional credential.

**Business impact:** Standard CI hardening (and GitHub's own recommended
practice since 2023) is to set `permissions: contents: read` as a workflow-level
default and grant only the specific elevated scope each job needs (e.g.
`pull-requests: write` only for a job that comments on PRs). This repo has none
of that, which is a low-cost, high-value gap to close.

**Evidence:** Absence confirmed via `grep -n "^permissions:\|  permissions:"
.github/workflows/agent-tests.yml` (zero output) against the full 519-line file.

**Root cause:** The workflow was built up job-by-job over time (visible from the
job-specific inline comments referencing "Phase 8", "Task 14", "DEBT-001", etc.)
without a permissions review pass.

**Remediation:** Add, at the top of the workflow:
```yaml
permissions:
  contents: read
```
and only add narrower elevated `permissions:` blocks to the specific jobs (if
any) that genuinely need to write — none of the current 8 jobs appear to need
anything beyond `contents: read` and `actions: read` (for `upload-artifact`,
which only needs `contents: read`, not write).

**Suggested regression test:** None needed beyond the config change itself; CI
will fail loudly if a job that actually required a broader scope stops working,
which is the intended fail-safe behavior.

**Confidence:** CONFIRMED

---

## SEC-7008

**Title:** All third-party GitHub Actions are pinned to mutable version tags, not immutable commit SHAs — including a secret scanner whose own comment overstates the protection this provides

**Severity:** LOW

**Affected component:** `.github/workflows/agent-tests.yml`

**Affected profile(s):** N/A (CI/CD supply chain)

**Affected page/API:** N/A

**Description:** Every `uses:` reference in the workflow is a tag, not a commit
SHA: `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`,
`actions/upload-artifact@v4`, `supabase/setup-cli@v1`,
`google/osv-scanner-action/osv-scanner-action@v2.2.4`, and
`gitleaks/gitleaks-action@v2` (full list confirmed via `grep -n "uses:"`, 30
occurrences, all following this pattern). Tags — including full-version tags
like `@v2.2.4` — are **mutable references**; unlike a commit SHA, the maintainer
of the referenced action (or anyone who compromises their account/repo) can
repoint a tag to different code without the version string in this workflow ever
changing. The `secret-scan` job's own comment claims otherwise:
```yaml
# .github/workflows/agent-tests.yml:412-414
      # Pinned to a release tag rather than a moving ref: a secret scanner is
      # a build-blocking dependency, and letting it float means an upstream
      # change can gate every merge.
      uses: gitleaks/gitleaks-action@v2
```
`@v2` is a **major-version tag**, which by convention moves forward to track new
`v2.x.y` releases automatically — it is a "moving ref" in exactly the sense the
comment says it is trying to avoid, just a slower-moving one than `@main`.

**Attack scenario:** A supply-chain compromise of any of these action
repositories (maintainer account takeover, e.g. the pattern seen in real-world
incidents like the `tj-actions/changed-files` compromise) that repoints the tag
this workflow references would execute inside every future CI run — including
the `secret-scan` job, which has access to the full checked-out repository
history — without any change needed to this repository's own files.

**Business impact:** Low likelihood (these are widely-used, reputable actions),
but non-zero and inexpensive to close given GitHub's own documented guidance to
pin third-party actions to a commit SHA.

**Evidence:** `.github/workflows/agent-tests.yml` — all `uses:` lines listed
above (line numbers: 14,15,18,58,66,94,95,98,103,150,151,154,171,198,199,202,207,307,317,318,321,341,342,345,405,415,433,434,437,514); comment at 412-414 specifically.

**Root cause:** Tag-pinning was treated as equivalent to SHA-pinning.

**Remediation:** Replace each `@vN` reference with `@<full-commit-sha>  #
vN.n.n`, per GitHub's own supply-chain hardening guidance. Dependabot (once
configured — see SEC-7012) can keep SHA-pinned actions current via automated PRs
that bump both the SHA and the trailing version comment.

**Suggested regression test:** None applicable — this is a config-only change;
the existing jobs will simply continue to pass against the pinned commit.

**Confidence:** CONFIRMED

---

## SEC-7009

**Title:** Self-hosted database backups are stored on the same Docker host as the primary database — no off-host copy exists — and the repository's own operator notes leave the current production database target ambiguous

**Severity:** HIGH

**Affected component:** `infra/self-hosted` — `backup` service and volume

**Affected profile(s):** All (data-loss/DR risk, not confidentiality)

**Affected page/API:** N/A

**Description:** The self-hosted stack does run scheduled logical backups —
this is a real, working control (`infra/self-hosted/backup.sh`, invoked as a
persistent `backup` service in `docker-compose.yml:228-245`), and it is a
meaningful improvement over the documented prior state (`BLK-1`: the hosted
Supabase project was on the free plan with `pitr_enabled: false, backups: []`,
per `docker-compose.yml:1-9` and `runbook.md:196-210`). But both the script and
the runbook are explicit that this only solves *mechanism*, not *disaster
recovery*:
```yaml
# infra/self-hosted/docker-compose.yml:250-253
volumes:
  db_data:
  storage_data:
  # Keep backups on a NAMED volume, never a bind mount into the repo: a dump
  # of this database contains passports and bank statements and must not be one
  # `git add -A` away from a commit.
  backups:
```
The `backups` named volume lives on the **same Docker host, same disk** as
`db_data` (the live database). `infra/self-hosted/runbook.md:278-281` states this
plainly: *"A dump sitting on the same Docker host as the database is **not
disaster recovery**: one lost machine loses both copies. Before this holds real
data, ship `/backups` off-host."* `infra/self-hosted/backup.sh:17-21` repeats the
same warning in its own header comment. Neither the compose file, the backup
script, nor any other file in `infra/` implements the off-host shipping step
(no `restic`, `rclone`, S3-sync, or equivalent appears anywhere in the
repository).

Separately, `infra/self-hosted/cutover.sh:8-11` (dated 2026-08-10) states the
**live production API** was, as of that date, pointed at a *dead* Supabase
project reference (`xaemx…`, `NXDOMAIN`) rather than either the original hosted
project or this self-hosted stack — meaning which database is actually serving
production traffic today, and therefore whether this backup mechanism even
applies to the live dataset, cannot be determined from the repository alone.

**Attack scenario / failure scenario:** N/A (this is an availability/DR gap, not
an attack). The realized failure mode is: the VPS's disk fails, the VPS is
compromised and wiped (e.g., as the downstream consequence of SEC-7002), or the
hosting provider has an incident — and both the primary data and every backup of
it are lost simultaneously, because they were never more than a few gigabytes
apart on the same physical/virtual disk.

**Business impact:** For a platform whose own runbook explicitly states it holds
*"13 real users' passports and bank statements"* (`vps-bootstrap.sh:13`,
`runbook.md:27`), a single-host data-loss event is total and unrecoverable data
loss for real users' government identity documents — the highest-consequence
category of failure this system can have, and one the team's own documentation
has flagged and not yet closed.

**Evidence:** `infra/self-hosted/runbook.md:196-210,231-286` (§9 and §11, quoted
above); `infra/self-hosted/backup.sh:11-21`; `infra/self-hosted/docker-compose.yml:222-253`;
`infra/self-hosted/cutover.sh:8-11` (production-target ambiguity).

**Root cause:** Off-host backup shipping was identified and documented as
required but not yet implemented, per the repository's own words.

**Remediation:** Implement the off-host step the runbook already specifies:
`restic`/`rclone` sync of the `backups` volume to object storage (S3-compatible)
in a different provider/region than the VPS, on a schedule at least as frequent
as `BACKUP_INTERVAL_SECONDS` (default daily). Separately — and higher priority —
**determine which database is actually serving production today** (this needs
an operator check, not a code change) and confirm the backup mechanism covers
whichever one it is.

**Suggested regression test:** `infra/scripts/backup-restore-drill.sh` already
exercises the dump→destroy→restore cycle end-to-end locally — extend it (or add
a sibling script) to also verify a copy of the most recent backup file exists at
the configured off-host destination and is retrievable, failing the drill if it
is not.

**Confidence:** CONFIRMED for the same-host-backup gap (explicitly documented by
the repo itself). Current production database target is **NOT VERIFIED —
requires operator check on host**: run `grep SUPABASE_URL
/var/www/visaai/apps/api/.env` on the VPS and compare against both the original
hosted project ref and `http://127.0.0.1:54421` (the self-hosted stack).

---

## SEC-7010

**Title:** The blocking dependency-reachability gate (`scripts/check-vulnerable-deps.mjs`) has a demonstrated false-negative blind spot for vulnerable packages that are transitive-only under pnpm's strict `node_modules` layout

**Severity:** MEDIUM (tooling/methodology gap; low practical exploitability for the one instance found today)

**Affected component:** `scripts/check-vulnerable-deps.mjs`, CI gate `Gate — no flagged package reachable from a deployed app`

**Affected profile(s):** N/A (build-time control)

**Affected page/API:** N/A

**Description:** The gate determines "reachability" with:
```js
// scripts/check-vulnerable-deps.mjs:44-53
for (const { name, advisories } of FLAGGED) {
  for (const app of DEPLOYED) {
    try {
      const entry = require.resolve(`${name}/package.json`, { paths: [resolve(ROOT, app)] });
      ...
```
This asks: *"if `apps/api`'s own code (not any of its dependencies) tried to
`require('uuid')` right now, would Node find it?"* Under pnpm's default strict,
non-hoisted `node_modules` layout, that question is only answered "yes" for
packages that are **direct** dependencies of `apps/api` (or hoisted to the
workspace root). It is answered "no" for a package that is only present because
a direct dependency's own dependency requires it — even though that nested
package's code executes inside the exact same running Node process.

This was verified empirically against the live lockfile, not assumed from
reading the script: `apps/api/package.json` does **not** list `uuid` as a
dependency (checked directly: `require('./apps/api/package.json').dependencies.uuid`
→ `undefined`). `require.resolve('uuid/package.json', {paths:[<apps/api dir>]})`
from a fresh Node process throws `MODULE_NOT_FOUND` — reproducing exactly what
the gate script does. Yet `uuid@10.0.0` genuinely exists in the resolved
dependency graph and genuinely executes inside `apps/api`'s process:
`find node_modules/.pnpm -maxdepth 1 -iname "uuid@10*"` finds it installed, and
the root `pnpm audit --json` shows its path as
`apps__api>@langchain/langgraph>@langchain/langgraph-checkpoint>uuid` — `@langchain/langgraph`
is a **runtime** dependency of `apps/api` (LangGraph state machines,
`apps/api/CLAUDE.md`'s own description: *"AI agents: LangGraph JS state machines
compiled in `modules/<feature>/graphs/`"*), and `@langchain/langgraph-checkpoint`
is the package this codebase's own `CheckpointService`
(`apps/api/src/shared/langgraph/checkpoint.service.ts`) depends on for every
intake session's checkpoint persistence to Upstash Redis. The current run of the
gate:
```
node scripts/check-vulnerable-deps.mjs
→ dependency gate: 5 flagged package(s) checked against apps/api, apps/web — none reachable
```
reports this as clean, but pnpm's own dependency-resolution mechanics (nested
per-package `node_modules` via the `.pnpm` store) mean `@langchain/langgraph-checkpoint`
resolves `uuid@10.0.0` through its own private view of `node_modules`, invisible
to `require.resolve(..., {paths:[apps/api]})`.

**Attack scenario:** Today's specific instance is low-risk in practice: the
GHSA-w5hq-g745-h8pq advisory requires the **caller** to pass a custom `buf`/
`offset` argument to `uuid.v3()/v5()/v6()` to trigger the missing bounds check;
internal LangGraph checkpoint-ID generation almost certainly calls the default
no-argument form, so this specific advisory is very unlikely to be exploitable
here even though the package is present and executing. The finding is about the
**gate's methodology**, not this one CVE: a genuinely exploitable transitive
runtime dependency vulnerability (e.g., one requiring no caller-controlled input)
introduced in the future via any nested `apps/api` or `apps/web` dependency
would pass this gate silently, exactly as `uuid@10.0.0` does today, because the
gate cannot see past one hop of pnpm's strict resolution.

**Business impact:** This is the one **blocking** dependency-security control in
the entire CI pipeline (everything else — `pnpm audit`, `osv-scanner` — is
`continue-on-error: true`). Its blind spot means "the gate is green" cannot be
read as "no reachable vulnerable code ships to production" for any dependency
that is transitive-only.

**Evidence:** `scripts/check-vulnerable-deps.mjs:44-53` (the resolution logic);
reproduction commands and their output (quoted in the description) confirming
`uuid` is absent from `apps/api/package.json`, unresolvable via the gate's exact
`require.resolve` call, yet present and used at `node_modules/.pnpm/uuid@10.0.0`
via `node_modules/.pnpm/@langchain+langgraph-checkpoint@1.0.3_.../`.

**Root cause:** `require.resolve(pkg, {paths:[app]})` tests direct-dependency
resolution, not "does this package's code run inside this app's process" —
these are the same question only when every runtime dependency the app uses is
either a direct dependency or hoisted, which pnpm's strict mode does not
guarantee.

**Remediation:** Walk the actual resolved dependency graph instead of testing
one hop from the app root — e.g., parse `pnpm-lock.yaml`'s per-importer
dependency tree (which `pnpm audit --json`'s own `paths` arrays already
demonstrate is derivable) and check whether each `FLAGGED` package appears
anywhere in the transitive closure of `apps/api`'s or `apps/web`'s **runtime**
(non-dev) dependencies, not just as a direct one. `pnpm why <pkg> --filter api`
is closer to this (though the script's own comment at lines 14-16 notes `pnpm
why` run inside `apps/api` resolves against the workspace root and produced
false positives during a past audit — the fix there is to filter `pnpm why`'s
output by the importer, not to fall back to single-hop `require.resolve`).

**Suggested regression test:** A unit test for `check-vulnerable-deps.mjs`
itself that adds a synthetic entry to `FLAGGED` for a package known to be
transitive-only in `apps/api` (e.g. `uuid` at its current pinned advisory) and
asserts the gate reports it as reachable — this test would fail against the
script's current logic today, which is exactly the point.

**Confidence:** PLAUSIBLE for the general methodology gap (mechanically
demonstrated with a real, current example). The practical exploitability of the
specific `uuid`/GHSA-w5hq-g745-h8pq instance found today is assessed as low,
pending confirmation of how `@langchain/langgraph-checkpoint` calls `uuid`
internally — UNVERIFIED without reading that package's source, which is outside
this repository.

---

## SEC-7011

**Title:** Self-hosted Docker Compose stack — 6 of 7 services have no healthcheck, and no service has a resource limit

**Severity:** LOW

**Affected component:** `infra/self-hosted/docker-compose.yml`

**Affected profile(s):** N/A (availability)

**Affected page/API:** N/A

**Description:** Only the `db` service defines a `healthcheck:` block
(`docker-compose.yml:54-58`, `pg_isready`). `auth`, `rest`, `storage`, `meta`,
`kong`, `db-bootstrap`, and `backup` have none — confirmed via `grep -n
"healthcheck" infra/self-hosted/docker-compose.yml`, one match. `restart:
unless-stopped` (set on most services) only restarts a container whose process
has **exited**; it does nothing for a process that is running but hung or
deadlocked, which a healthcheck-driven restart policy would catch. Separately,
no service in the file sets `mem_limit`, `cpus`, or a `deploy.resources` block
(`grep -niE "mem_limit|cpus:|deploy:|resources:"` — zero matches) — a single
runaway or compromised container can consume all memory/CPU on the host,
affecting every other container (including `db`) and the co-located `pm2`-run
`apps/api`/`apps/web` processes on the same VPS.

**Attack scenario:** N/A directly (availability/resilience gap, not an exploit
primitive on its own) — though a resource-exhaustion condition in any one
container (e.g. triggered by the DoS-class advisories in SEC's dependency table,
like the `image-size` infinite-loop advisories, *if* any Supabase-stack image
were to process attacker-supplied input through an affected library — not
confirmed to be the case here) would have no compose-level ceiling.

**Business impact:** Lower severity than the other findings here; primarily an
operational-resilience gap that would surface as an unplanned outage rather than
a confidentiality/integrity breach.

**Evidence:** `infra/self-hosted/docker-compose.yml` — `healthcheck:` present
only at lines 54-58; absence of `mem_limit`/`cpus`/`deploy:`/`resources:`
anywhere in the file (full-file grep, zero matches).

**Root cause:** Not yet implemented; the stack is young (built during the same
audit cycle documented in its own header comments) and prioritized functional
correctness (the runbook's "Rehearsal results" section documents 6 bugs fixed to
get the stack running at all) over resilience hardening.

**Remediation:** Add HTTP-based healthchecks to `auth` (`GET /health` per
`verify.sh:35-36`'s own probe), `rest` (`GET /` per `verify.sh:37-40`), `storage`,
and `kong`; add `mem_limit`/`cpus` (or the Compose v3 `deploy.resources.limits`
equivalent) sized to the VPS's known headroom (the repo's own
`vps-bootstrap.sh:33-37` already establishes a 1.5 GB minimum-available-memory
gate, implying the operators know the box's constraints).

**Suggested regression test:** `infra/self-hosted/verify.sh` already checks
container `State`; extend it to also read `docker compose ps --format
'{{.Health}}'` per service and fail if any defined healthcheck reports
`unhealthy`.

**Confidence:** CONFIRMED

---

## SEC-7012

**Title:** No SAST tool and no automated dependency-update mechanism (Dependabot/Renovate) exist anywhere in the repository

**Severity:** MEDIUM

**Affected component:** CI/CD — repository-wide

**Affected profile(s):** N/A

**Affected page/API:** N/A

**Description:** `.github/workflows/agent-tests.yml` (the only workflow file)
contains no CodeQL, Semgrep, Snyk Code, or any other static-application-security-testing
step — every `security`-adjacent step in the file is either a secret scanner
(`gitleaks`, a custom regex grep) or a dependency-advisory scanner
(`pnpm audit`, `osv-scanner`), never a source-code analysis tool looking for
injection, SSRF, auth-logic, or other code-level vulnerability classes. Separately,
`find . -iname "dependabot*" -o -iname "renovate*"` (excluding `node_modules`)
returns nothing — there is no `.github/dependabot.yml` and no `renovate.json`.
Dependency currency depends entirely on the two non-blocking scanners in CI
(both `continue-on-error: true`) being read by a human and the `FLAGGED` list in
`scripts/check-vulnerable-deps.mjs` and the `overrides:` block in
`pnpm-workspace.yaml` being updated by hand — both are demonstrably maintained
this way already (their own comments reference specific past audit dates, e.g.
"osv-scanner, 2026-08-09" in `check-vulnerable-deps.mjs:34`).

**Attack scenario:** N/A directly — this is a control-coverage gap. Its
consequence is that source-code-level vulnerability classes (e.g. a newly
introduced SSRF, path traversal, or authorization-logic bug) have no automated
CI-time detection, and new dependency advisories are surfaced only when someone
manually re-runs the scanners and updates the hand-maintained lists — which, per
the dates already embedded in those same files, has historically happened in
audit-cycle bursts rather than continuously.

**Business impact:** Widens the window between a new CVE/advisory being
published and this codebase's CI surfacing it, and leaves an entire class of
vulnerability (code-level, not dependency-level) with zero automated CI coverage.

**Evidence:** Full-file review of `.github/workflows/agent-tests.yml` (no
`codeql`, `semgrep`, or `snyk` string appears anywhere in the 519-line file);
`find . -iname "dependabot*" -o -iname "renovate*"` (excluding `node_modules`) —
zero results; `scripts/check-vulnerable-deps.mjs:34` ("Packages currently
carrying an advisory (osv-scanner, 2026-08-09)") as evidence of the manual,
point-in-time maintenance model.

**Root cause:** Security tooling was added incrementally, audit-cycle by
audit-cycle (visible from inline comments referencing "Phase 8", "Task 14",
"DEP-001"), without a standing automated-currency mechanism ever being put in
place.

**Remediation:** Add `.github/dependabot.yml` with an `npm`/`pnpm` ecosystem
entry (weekly cadence is reasonable given this repo's demonstrated update
rhythm) and a `github-actions` ecosystem entry (which also closes part of
SEC-7008, since Dependabot can bump SHA-pinned actions). Add a CodeQL workflow
(`github/codeql-action`) for JS/TS — GitHub provides this as a near-zero-config
starter workflow for public and private repos on paid plans.

**Suggested regression test:** N/A (tooling addition, not a code-behavior
change) — verify via the new workflow's own first scheduled run producing a
report/alert.

**Confidence:** CONFIRMED

---

## Summary

| ID | Title | Severity | Confidence |
|---|---|---|---|
| SEC-7001 | nginx `X-Forwarded-For` append (not overwrite) defeats `trust proxy 1` | HIGH | CONFIRMED |
| SEC-7002 | Self-hosted Postgres port published without loopback bind | CRITICAL | CONFIRMED (config); reachability NOT VERIFIED |
| SEC-7003 | All Supabase service-role passwords equal the superuser password | HIGH | CONFIRMED |
| SEC-7004 | Canonical nginx config has no TLS/HSTS/headers/rate-limit | HIGH | CONFIRMED (repo); live state NOT VERIFIED |
| SEC-7005 | apps/web sets no security headers at the app layer | MEDIUM | CONFIRMED |
| SEC-7006 | Repo nginx configs don't match operator's own documented live state | MEDIUM | CONFIRMED (inconsistency); live truth NOT VERIFIED |
| SEC-7007 | No `permissions:` block in the GitHub Actions workflow | MEDIUM | CONFIRMED |
| SEC-7008 | Third-party Actions pinned to tags, not SHAs | LOW | CONFIRMED |
| SEC-7009 | Backups stored on the same host as primary DB; no off-host copy | HIGH | CONFIRMED; prod DB target NOT VERIFIED |
| SEC-7010 | Dependency-reachability gate blind spot for transitive runtime deps | MEDIUM | PLAUSIBLE |
| SEC-7011 | Missing healthchecks/resource limits on 6 of 7 compose services | LOW | CONFIRMED |
| SEC-7012 | No SAST tool, no Dependabot/Renovate | MEDIUM | CONFIRMED |

**By severity:** 1 CRITICAL, 4 HIGH, 5 MEDIUM, 2 LOW, 0 INFO.

**Items requiring an operator with VPS access (none of which this audit performed):**
1. Confirm host firewall state for port 54422 (SEC-7002): `sudo ss -ltnp | grep 54422`, `sudo ufw status verbose`, external `nmap -p 54422 <vps-ip>`.
2. Pull the live nginx config and reconcile it with git (SEC-7004, SEC-7006): `sudo nginx -T`.
3. Confirm whether port 4000 (API) is reachable directly, bypassing nginx (referenced as pre-existing `DEPLOY-002` in the parent repo's `CLAUDE.md`, not independently re-verified here).
4. Confirm which Supabase project is actually serving production traffic today, and whether the self-hosted stack's `backup` service is running against it (SEC-7009): `grep SUPABASE_URL /var/www/visaai/apps/api/.env`.
