# VisaAI — Security Operations Runbook

Master Security Audit, 2026-08-16. Actions the operator must take that could not
be performed safely from the audit environment (production credentials,
host/provider changes, destructive rotations). Do these in order.

> Never paste live secret values into chat, tickets, or reports. Rotate at the
> provider, then update the server `.env` out of band.

## 1. Rotate exposed credentials (HIGH — do first)

These were found in git history and/or are the same value still live in
`apps/api/.env`. Treat all as compromised.

| Credential | Where live | Action |
|---|---|---|
| OpenAI API key | `apps/api/.env` | Create a new key in the OpenAI dashboard, update `.env`, revoke the old one. |
| Upstash Redis REST token | `apps/api/.env` | Rotate in Upstash console, update `.env`. |
| Supabase project `xaemxugqnxoxlqnboxyb` service-role/anon/JWT secret | committed 2026-06-01 | Confirm the project is decommissioned; if live, rotate JWT secret + keys. |
| Supabase Management PAT (`sbp_…`) | prior AI transcript | Confirm rotated in Supabase dashboard. |

Verify no `.env` is tracked: `git ls-files | grep -Ei '\.env($|\.)'` → must be
empty (it is, today). Optional: scrub history with `git filter-repo` (rotation is
the real fix; scrubbing is cosmetic once rotated).

## 2. Apply DB migrations to production

Two new migrations (idempotent, verified from-scratch via `supabase db reset`):

```
supabase/migrations/20260816120000_sec_rls_column_hardening.sql
supabase/migrations/20260816120100_sec_rpc_lockdown.sql
```

Self-hosted prod (per project memory) applies SQL by piping into the DB
container:

```bash
cat supabase/migrations/20260816120000_sec_rls_column_hardening.sql | \
  docker exec -i selfhosted_db psql -U postgres -d postgres -v ON_ERROR_STOP=1
cat supabase/migrations/20260816120100_sec_rpc_lockdown.sql | \
  docker exec -i selfhosted_db psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Then verify the controls on prod:

```bash
cat supabase/tests/security/rls_column_hardening_test.sql | \
  docker exec -i selfhosted_db psql -U postgres -d postgres -v ON_ERROR_STOP=1
# expect: 8 × "PASS ..."
```

> NOTE: `seed.sql` is NEVER applied to prod, so the REVOKEs are the operative
> control there. Confirm no automation runs `grant … on all functions … to anon`
> against prod.

## 3. Redeploy the self-hosted stack (loopback Postgres bind — SEC-7002)

After pulling this branch on the VPS:

```bash
cd infra/self-hosted && docker compose up -d
ss -ltnp | grep 54422    # must show 127.0.0.1:54422, NOT 0.0.0.0
```

## 4. Install the hardened nginx config (SEC-7001/7004)

```bash
sudo cp deploy/nginx/visaai.co.conf /etc/nginx/sites-available/visaai.co
sudo ln -sf /etc/nginx/sites-available/visaai.co /etc/nginx/sites-enabled/visaai.co
sudo nginx -t && sudo systemctl reload nginx
# TLS (if not already): sudo certbot --nginx -d visaai.co -d www.visaai.co -d api.visaai.co
```

Verify: `curl -sI https://api.visaai.co/ | grep -i 'x-frame-options\|strict-transport'`
and that a spoofed `X-Forwarded-For` header does not change `req.ip` (login
lockout keys correctly).

## 5. Separate DB-role passwords (SEC-7003)

In `infra/self-hosted/.env`, set distinct strong values (do not reuse the
`postgres` superuser password) for each Supabase role's password, rotate the
superuser, and restart the stack. Update any `DATABASE_URL`s accordingly.

## 6. Off-host backups (SEC-7009)

Ship encrypted DB backups off the VPS (object storage in another region);
schedule + test a restore. Document RPO/RTO.

## 7. Web deploy (CSP + headers — SEC-8002)

`next.config.ts` now emits CSP/HSTS/nosniff/frame-ancestors in production. Deploy
web and verify: `curl -sI https://visaai.co/ | grep -i content-security-policy`.
The CSP keeps `script-src 'unsafe-inline'` (no nonce pipeline yet) — tightening
to nonces is a tracked follow-up.

## 8. Extension release (SEC-8510/8001)

Rebuild (`node apps/extension/build.mjs`) — the production `dist/manifest.json`
now excludes `localhost` from `externally_connectable`; the background worker
verifies sender origin + apiUrl. Re-publish to the Web Store.

## 9. Recommended, operator-gated

- **MFA on privileged actions (SEC-1004):** the `MfaGuard`/`@RequireMfa` are
  built but applied to no route to avoid locking out an admin without MFA. Once
  every platform/super admin has enrolled TOTP (via `/profile`), apply
  `@RequireMfa()` to the role-grant endpoint (`iam` `/users/:id/roles`) and other
  sensitive admin mutations. Do NOT enable before enrollment is confirmed.
- **Password policy (SEC-1003):** committed in `supabase/config.toml` (min 12 +
  complexity). On self-hosted GoTrue, set the equivalent env
  (`GOTRUE_PASSWORD_MIN_LENGTH=12`, password-required-characters) and restart auth.

## Security monitoring (ongoing)

Alert on: repeated `auth_audit_log` `login_failure`/`account_locked`, admin
role-grant events, payout/refund privileged actions, and rate-limit 429 spikes at
the edge. Audit tables are append-only (triggers) and RLS-protected; keep them so.
