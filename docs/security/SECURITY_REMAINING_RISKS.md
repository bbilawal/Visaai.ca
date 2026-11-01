# VisaAI — Remaining & Accepted Security Risks

Master Security Audit, 2026-08-16. Items here are NOT resolved in code by this
engagement. Each has a disposition. Nothing here is a known unresolved CRITICAL
or HIGH *exploitable* vulnerability within the tested scope; the two HIGH items
that remain (SEC-1001, SEC-12001) are architectural mitigations-in-place, and
the operator items are configuration/credential actions that cannot be performed
safely from this environment.

## Requires operator action (cannot be done safely from here)

| ID | Risk | Required action | Where |
|---|---|---|---|
| SEC-5001 | OpenAI API key currently live in `apps/api/.env` was committed to git history (`apps/api/.env.example`, 2026-06-01→06-07) | Rotate at OpenAI; the current key must be treated as exposed | provider console |
| SEC-5003 | Upstash Redis REST token, live in `apps/api/.env`, committed 2026-06-10 | Rotate at Upstash | provider console |
| SEC-5004 | Supabase service-role/anon/JWT-secret for project `xaemxugqnxoxlqnboxyb` committed ~15h on 2026-06-01 | Confirm the project is decommissioned, else rotate | Supabase dashboard |
| — | Supabase Management PAT (`sbp_…`) self-documented as pasted into an AI transcript | Confirm rotated | Supabase dashboard |
| SEC-7003 | All Supabase service DB roles share the `postgres` superuser password | Set distinct strong passwords per role in `infra/self-hosted/.env`, rotate the superuser | VPS |
| SEC-7009 | Backups on the same host as the primary DB | Ship encrypted backups off-host; test restore | VPS |
| SEC-7004 | Hardened nginx conf is version-controlled but the deploy hook does not install it | `cp deploy/nginx/visaai.co.conf` into `/etc/nginx`, `nginx -t && reload`, run certbot | VPS |
| SEC-7002 (deploy) | The loopback bind fix must be redeployed | `docker compose up -d` the self-hosted stack after pulling; verify `ss -ltnp` shows 127.0.0.1 for 54422 | VPS |
| Verify | Which Supabase project is live in prod; whether port 4000 bypasses nginx; host firewall | operator checks listed in `docs/security/_wave1/infra-findings.md` | VPS |

## Accepted architectural residuals (mitigations in place)

- **SEC-1001 — app-level brute-force lockout is advisory.** Real login runs
  client-side against Supabase, so the in-app lockout never sees it. Mitigations
  now in place: Supabase's own auth rate limiting, the new edge `limit_req` on
  `/auth/`, and SEC-1002 hardening so the endpoint can't be abused to forge
  history or self-reset. A fully server-side login proxy is the real fix and is
  a larger architectural change — deferred with this note.
- **SEC-12001 — Supabase Storage is served same-origin as the web app.** A
  content-type-confusion bug anywhere would then be full-origin. No working
  bypass exists today (upload type allowlists block script-capable types).
  Mitigations: web CSP, `X-Content-Type-Options: nosniff`. A separate storage
  domain is the structural fix — deferred.
- **SEC-8003 — Supabase session cookies are not `httpOnly`.** This is the
  `@supabase/ssr` design (the client SDK must read the token). Amplifies XSS
  impact; contained by the new CSP. Accepted as a framework constraint.
- **SEC-6006 — approval-prediction output guardrail not wired to VRI/analyze.**
  The prompts already forbid expressing certainty (`NEVER 100`), and inputs are
  now fenced, so the exploitable injection path is closed. Wiring the existing
  `GuardrailsService` output filter into these two features is a quality/defence
  improvement, not an open exploit. Deferred.

## Dependency (SCA) posture

The blocking CI gate (`scripts/check-vulnerable-deps.mjs`) is REACHABILITY-based
and currently green: zero flagged packages are reachable from `apps/api` or
`apps/web`. The HIGH advisories reported by `pnpm audit` live in dev/build
tooling (Expo/Metro/vitest) and in `apps/mobile`, which is not shipped. Non-
blocking `pnpm audit` + osv-scanner run in CI for visibility. Disposition:
accepted, tracked, not reachable in production.

## MEDIUM/LOW not individually code-fixed this pass (triaged)

Per the "CRITICAL→HIGH first" rule, the following lower-severity wave-1 findings
are recorded for batch remediation and did not block the gate:

- SEC-3041 (AI endpoints beyond `/visa/analyze` share the generic throttle; add
  per-route caps + input-length bounds to narrative/vri/messaging-ai/voice).
- SEC-1003 (password policy enforced client-side only; set Supabase min length +
  complexity in `supabase/config.toml`).
- SEC-1004 (MFA step-up guard built but applied to no route; apply `@RequireMfa`
  to role-grant and other sensitive admin endpoints).
- SEC-1005/1006/1007 (dead TokenCache.invalidate, incomplete audit events, inert
  "remember me").
- SEC-1008 (signup user-enumeration).
- SEC-2001 (consultant review accepts unbound `application_id` — data-integrity).
- billing `successUrl`/`cancelUrl` `.startsWith()` prefix check (open-redirect on
  a Stripe-hosted domain) — tighten to an origin check.
- Frontend SEC-8005 (two checklist components render backend URLs without the
  existing scheme guard), SEC-8006 (signout CSRF), and the LOW upload/PII items
  in `upload-pii-findings.md` (deep-path log redaction consistency, temp-file
  cleanup on failed mobile uploads, `android:allowBackup`).

None of the above is a known unresolved CRITICAL/HIGH exploitable issue.
