# infra/

Operational scripts for the production VPS. See
`VISAAIDocs/decisions/0002-production-infrastructure-platform.md` for why this is shell and
not Terraform.

These are **first-class artifacts**, not examples: ShellCheck runs on them in
CI, and `preflight.sh`'s isolation rules mirror
`apps/api/src/config/environment-isolation.ts`.

(The files under `docs/production/vps-hardening/` remain the reference
`deploy.sh`, `ecosystem.config.js` and `supabase-snapshot.sh`, and are still
marked "adapt before use".)

| Script | Run where | Purpose |
|---|---|---|
| `scripts/preflight.sh` | On the target box, **before** deploying | Refuses to proceed if the box has drifted: node version, `.env` presence and mode 600, required variables, environment isolation in both directions, disk headroom, Redis, TLS expiry |
| `scripts/smoke-test.sh` | Against the deployed origin, **after** | Liveness, readiness, web root, an authenticated route still returning 401, and security headers. Read-only and unauthenticated by design |
| `scripts/schema-rebuild-test.sh` | Anywhere with Docker | Rebuilds the whole schema from `supabase/migrations/` into a throwaway Postgres and diffs it against production's table inventory |

## Deploy

```bash
ssh visaai@srv1584195.hstgr.cloud
cd /var/www/visaai && git fetch --all

bash infra/scripts/preflight.sh
bash docs/production/vps-hardening/deploy.sh   # health-gated, auto-reverts
bash infra/scripts/smoke-test.sh
```

If the smoke test fails, roll back — `deploy.sh` does it automatically on a
failed health gate, and manually it is a checkout of the previous SHA plus
`pm2 reload`.

## DR rehearsal

```bash
# fetch production's table list first (needs a Supabase management token)
EXPECTED=/tmp/prod-tables.txt bash infra/scripts/schema-rebuild-test.sh
```

Last run 2026-08-06: 88/88 migrations applied, 128 tables, 8 seconds, PASS.

## What these do not do

They do not provision the box, manage DNS, or take data backups — **there are
no data backups** (`VISAAIDocs/infrastructure/backup-and-restore.md`).
