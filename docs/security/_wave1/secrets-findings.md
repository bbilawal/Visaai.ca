# Secret Exposure & Credential Hygiene Audit — Wave 1

**Repo:** `/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI` (pnpm monorepo)
**Remote:** `https://github.com/bbilawal/VisaAI.git` (unauthenticated `GET /repos/bbilawal/VisaAI` → 404, consistent with a private repo; not independently confirmable without credentials — UNVERIFIED)
**Scope:** working tree (tracked + untracked), full git history (1,041 commits, all refs), CI/CD, frontend bundles, env-var inventory
**Method:** read-only. No file edited, no credential rotated or revoked. All secret values below are redacted to a short prefix + length.
**Date:** 2026-08-16

---

## (a) Environment variable inventory

Built from `apps/api/src/config/configuration.ts` (the API's single Zod schema — near-complete source of truth), plus grep across `apps/web`, `apps/mobile`, `apps/extension`, `infra/self-hosted`, `.github/workflows`.

### apps/api (server-only, NestJS)

| Variable | Class | Documented in `.env.example`? |
|---|---|---|
| NODE_ENV | config | yes |
| SUPABASE_URL | config (endpoint) | yes |
| SUPABASE_PUBLIC_URL | config (endpoint) | no (newer var, not in root `.env.example`) |
| SUPABASE_SERVICE_ROLE_KEY | **secret** | yes |
| SUPABASE_ANON_KEY | secret-shaped, RLS-protected | yes |
| SUPABASE_JWT_SECRET | **secret** (can mint sessions) | yes |
| PORT | config | yes |
| STRIPE_SECRET_KEY | **secret** | yes |
| STRIPE_WEBHOOK_SECRET | **secret** | yes |
| STRIPE_CONNECT_WEBHOOK_SECRET | **secret** | no |
| STRIPE_TAX_ENABLED | config | no |
| MIN_PAYOUT_CENTS | config | no |
| DUNNING_MAX_ATTEMPTS | config | no |
| PAYMENT_PROVIDER_NAME | config | no |
| SUBSCRIPTIONS_ENABLED | config | no |
| SUBSCRIPTION_PRICES | config (Stripe price IDs, not secret) | yes |
| SUBSCRIPTION_TRIAL_DAYS | config | yes |
| STRIPE_CONNECT_REFRESH_URL / _RETURN_URL | config | no |
| WEB_URL / API_URL | config | yes |
| OPENAI_API_KEY | **secret** | yes |
| AI_PROVIDERS | config | no |
| ANTHROPIC_API_KEY / GEMINI_API_KEY | **secret** (unused today) | no |
| DATA_RESIDENCY_MODE / OCR_PROVIDER / OCR_REGION / OCR_DERIVE_FIELDS | config | yes |
| AZURE_DOC_INTEL_ENDPOINT | config | yes |
| AZURE_DOC_INTEL_KEY | **secret** | yes |
| AZURE_DOC_INTEL_MODEL | config | no |
| AWS_OCR_ACCESS_KEY_ID | **secret** | yes |
| AWS_OCR_SECRET_ACCESS_KEY | **secret** | yes |
| GOOGLE_DOCAI_PROCESSOR_ID | config | yes |
| GOOGLE_DOCAI_CREDENTIALS | **secret** (service-account JSON) | yes |
| SCAN_PROVIDER / MAX_UPLOAD_BYTES | config | yes |
| UPSTASH_REDIS_REST_URL | config (endpoint) | yes |
| UPSTASH_REDIS_REST_TOKEN | **secret** | yes |
| REDIS_URL | config/secret (may embed password) | no |
| UNSUBSCRIBE_SIGNING_SECRET | **secret** | no |
| SENTRY_DSN | config (write-only DSN, low sensitivity) | no |
| LOG_LEVEL | config | yes |
| INBOUND_WEBHOOK_SECRET | **secret** (unused — no consumer, see ARCH-002) | yes |
| EMAIL_ENCRYPTION_KEY | **secret** (AES-256 key) | yes |
| SMTP_HOST/PORT/USER/FROM | config | partial |
| SMTP_PASS | **secret** | no |
| VAPID_PUBLIC_KEY | public by design | yes |
| VAPID_PRIVATE_KEY | **secret** | yes |
| VAPID_SUBJECT | config | yes |
| EXPO_ACCESS_TOKEN | **secret** | no |
| MOBILE_PUSH_ENABLED / MOBILE_APP_SCHEME | config | no |
| VOICE_* (providers, models, limits) | config | no |
| TWILIO_ACCOUNT_SID | secret-shaped (ID, not the auth token) | no |
| TWILIO_AUTH_TOKEN | **secret** | no |
| TWILIO_FROM_NUMBER | config | no |
| NOTIFICATION_EMAIL_DELAY_MS / LEGACY_AUTOMATION_WRITE_ENABLED | config | no |
| ADMIN_EMAILS | config (PII-adjacent, not secret) | no |
| ANALYTICS_* / KPI_* (12 vars) | config (tuning) | no |
| TOKEN_CACHE_TTL_MS / THROTTLE_TTL_MS / THROTTLE_LIMIT | config | no |
| DEPLOY_ENV / FEATURE_FLAGS_FORCE_OFF / FEATURE_FLAGS_FORCE_ON / FEATURE_FLAGS_CACHE_TTL_MS | config | no |

The schema itself enforces good practice: `assertEnvironmentIsolation()` refuses boot if a non-production process points at the production Supabase ref / Redis host / uses a `sk_live_` Stripe key (`apps/api/src/config/environment-isolation.ts`), and production boot refuses `DATA_RESIDENCY_MODE=global`, mock voice/analytics providers, etc.

### apps/web (Next.js — `NEXT_PUBLIC_*` ship to the browser)

| Variable | Safe to be public? | Notes |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Yes | project endpoint |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Yes | anon key is RLS-gated by design |
| NEXT_PUBLIC_API_URL | Yes | endpoint only |
| NEXT_PUBLIC_APP_VERSION | Yes | |
| NEXT_PUBLIC_CHROME_WEB_STORE_URL | Yes | |
| NEXT_PUBLIC_EXTENSION_ID | Yes | Chrome extension IDs are not secret (used for `externally_connectable`) |
| NEXT_PUBLIC_SITE_URL | Yes | |
| NEXT_PUBLIC_SUPABASE ...ANALYTICS_ENABLED / _MAX / _URL | Yes | client analytics config |
| NEXT_PUBLIC_VAPID_PUBLIC_KEY | Yes | VAPID public key is designed to be public |

**No server secret (`STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, webhook secrets) is ever assigned to a `NEXT_PUBLIC_*` variable anywhere in the tracked source.** Confirmed by exhaustive grep of `apps/web` for `NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*SERVICE_ROLE|NEXT_PUBLIC_.*STRIPE_SECRET` — zero hits.

### apps/mobile (Expo — `EXPO_PUBLIC_*` ship inside the binary)

| Variable | Safe to be public? |
|---|---|
| EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WEB_URL | Yes |
| EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY | Yes (anon key, RLS-gated) |
| EXPO_PUBLIC_ANALYTICS_ENABLED / EXPO_PUBLIC_APP_ENV / EXPO_PUBLIC_REQUEST_TIMEOUT_MS | Yes |
| EXPO_PUBLIC_SENTRY_DSN | Yes (write-only DSN; unset by default) |

`apps/mobile/.env.example` explicitly documents (and correctly excludes) `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `SUPABASE_JWT_SECRET` as things that must never appear with an `EXPO_PUBLIC_` prefix. No violation found in source.

**Verdict on frontend leakage: no CRITICAL finding.** No secret is bound to a `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` variable anywhere in tracked source today.

---

## (b) Git-tracked sensitive files

```
$ git ls-files | grep -Ei '\.env|\.pem$|\.key$|credential|secret'
.env.example
apps/api/.env.example
apps/api/src/modules/partner/partner-credentials.spec.ts
apps/api/src/modules/partner/partner-credentials.ts
apps/api/test/security/secret-scan.spec.ts
apps/mobile/.env.example
apps/web/.env.local.example
docs/production/kubernetes-migration/k8s/secret.example.yaml
infra/self-hosted/.env.example
```

**No `.env` file (real, non-`.example`) is tracked by git today.** Every real `.env` on disk (`./.env`, `apps/api/.env`, `infra/self-hosted/.env`) is present in the working tree only, and all are covered by `.gitignore` (`**/.env`, `**/.env.local`, `**/.env.*.local`). Verified with `git status --porcelain` showing none of them as tracked/staged.

`infra/self-hosted/.gitignore` additionally ignores `.env`, `*.dump`, `*.sql.gz`, `dumps/` for that subtree.

**Historical exception (remediated):** `apps/api/.env` **was** tracked for a single commit — see SEC-5002.

---

## CREDENTIALS REQUIRING ROTATION

Ordered by confidence/severity. Named by variable + provider only — no values.

| # | Credential | Provider | Why | Confidence |
|---|---|---|---|---|
| 1 | `OPENAI_API_KEY` (the key currently live in `apps/api/.env`, prefix `sk-proj-fQR…`) | OpenAI | Confirmed present in git history (`b25f6e8`, tracked file `apps/api/.env.example`, exposed 2026-06-01→06-07) and is the **same key still active today**. No rotation evidence found anywhere in-repo. | CONFIRMED |
| 2 | An earlier `OPENAI_API_KEY` (prefix `sk-proj-OEeP…`) | OpenAI | Confirmed committed to `apps/api/.env.example` (2026-06-01) and separately to `apps/web/.env.local.example` until 2026-06-10. The scrub commit (`fa50837`) itself states: *"these values are already in git history — rotate them at the providers (OpenAI, Upstash) regardless."* No confirmation this happened. | CONFIRMED |
| 3 | `UPSTASH_REDIS_REST_TOKEN` (currently active value, prefix `gQAA…`) | Upstash | Confirmed present in git history (same `apps/web/.env.local.example` exposure as #2, commits `0f6d37a`→`fa50837`) and is the **same token currently active** in `apps/api/.env` today. | CONFIRMED |
| 4 | A Supabase **Management API personal access token** (`sbp_…`) for project ref `ujxzxefvtaoxiydbdrhb` | Supabase | Self-documented in-repo (`graphify-out/VISAAI-HANDOFF.md`, present 2026-06-12→2026-07-04): *"Rotate the Supabase access token — a live token was pasted in plaintext in an earlier session transcript... User must rotate."* The actual token value was never committed (only the `sbp_…` reference), but no in-repo evidence the rotation happened. This project ref matches the Supabase project `apps/api/.env` points at today. | PLAUSIBLE (self-reported, token value itself not observed by this audit; transcript location not in this repo) |
| 5 | `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` / `SUPABASE_JWT_SECRET` for project ref `ujxzxefvtaoxiydbdrhb` (`apps/api/.env`) | Supabase | Not found in git history or any tracked file — this is a working-tree-only, correctly-gitignored credential. Listed here only because it shares a project with the `sbp_` PAT above (#4): if that PAT was used to read project settings, these keys may already be visible to whoever had it. Rotate only if #4's exposure is confirmed unremediated. | UNVERIFIED (no direct exposure evidence for these three specifically) |
| 6 | `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` / `SUPABASE_JWT_SECRET` for project ref `xaemxugqnxoxlqnboxyb` (root `.env`) | Supabase | This project ref **was briefly committed** in cleartext to `apps/api/.env.example` at `0f6d37a` (2026-06-01, ~15 hours before being replaced by placeholders in `473d2f6`). Same rationale as #5 — confirm whether this project is still live/in-use; if so, rotate. | CONFIRMED exposure in history; rotation status UNVERIFIED |
| 7 | `POSTMARK_SERVER_TOKEN` (working-tree value in `apps/api/.env`) | Postmark | Not found in git history. Per `CLAUDE.md`, this token is currently unused in code (`postmark` dependency removed, ARCH-002) but the token remains valid at the provider. No exposure evidence — listed for completeness, not required to rotate on this audit's evidence. | LOW / not required by evidence found |

**Not requiring rotation (working-tree-only, gitignored, never observed in git history or elsewhere in the tree):** `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `SMTP_PASS` (Resend key), `EMAIL_ENCRYPTION_KEY`, `VAPID_PRIVATE_KEY`, `infra/self-hosted/.env` contents (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, OAuth secrets). These sit in cleartext on the local machine as normal local-dev practice; flagging them is a hygiene note, not a rotation requirement, absent evidence of exposure.

---

## Findings

### SEC-5001
Title: Real OpenAI API key (currently active) committed to a tracked `.env.example` file, still in use today
Severity: 🔴 CRITICAL
Affected component: `apps/api/.env.example` (git history), `apps/api/.env` (current, working tree)
Affected profile(s): platform-wide (any principal who can read the API's OpenAI billing/usage)
Affected page/API: N/A — infrastructure credential, not a web endpoint
Description: Commit `b25f6e8` ("ifix", 2026-06-01 14:19:12 -0400) added a real OpenAI project API key (prefix `sk-p…`, len 164) to the tracked file `apps/api/.env.example`, replacing an earlier real key that had been committed there a few hours before (see SEC-5003). It stayed in that tracked file until commit `854bd2f` ("update", 2026-06-07 23:10:50 -0400) replaced it with the placeholder `sk-<your-openai-key>` — roughly 6 days of exposure in a file that ships with every clone of the repository. Independently, `git log --all -S<key-fragment>` confirms the exact same key (byte-for-byte) is the value currently assigned to `OPENAI_API_KEY` in the working-tree file `apps/api/.env` today. The key was never rotated after the git-history exposure.
Attack scenario: Anyone with clone/read access to the repository (a collaborator, a CI service account, a leaked GitHub PAT with `repo` scope, or a fork made before the scrub) can run `git log -p -- apps/api/.env.example` or `git show b25f6e8` and recover the full, currently-valid OpenAI key in plaintext. They can then make OpenAI API calls billed to VisaAI's account, exfiltrate whatever the key's scope allows, or exhaust rate limits/budget.
Business impact: Unauthorized OpenAI usage charged to the project; potential prompt/data exposure for any request the attacker crafts; every LangGraph agent in the API depends on this single key (intake, documents, prefill, voice fallback), so its compromise is platform-wide, not feature-scoped.
Evidence: commit `b25f6e8d41e1818d82b9533f9c1b61da7735e81` (2026-06-01) — `apps/api/.env.example` line, value prefix `sk-p…` (len 164), redacted; removed at commit `854bd2f892…` (2026-06-07); identical value confirmed present in `apps/api/.env:23` (working tree, redacted `sk-p…`) via exact-string `git log -S` match against the same fragment.
Root cause: A developer copy-pasted a real, working `.env` into the tracked `.env.example` template (twice, in successive commits) instead of hand-writing placeholders; no pre-commit secret scanner existed at the time (the repo added one later — see the CI `secret-scan` job and `.gitleaks.toml`, which now would catch a `sk-proj-`/`sk-live-` pattern, though its dedicated regex list targets JWTs and `sbp_` specifically, not OpenAI key shapes).
Remediation: **REQUIRES ROTATION by the operator.** Revoke/regenerate this OpenAI project API key from the OpenAI dashboard immediately, update `apps/api/.env` (and the VPS's `apps/api/.env`, per `CLAUDE.md`'s deployment doc) with the new key, and restart the API (`pm2` restart per the deploy runbook — no rebuild needed, env is runtime for the API). Consider adding an OpenAI-key-shape pattern (`sk-(proj-)?[A-Za-z0-9_-]{20,}`) to `.gitleaks.toml` / the CI `secret-scan` job, which currently only targets JWTs and Supabase PATs.
Suggested regression test: Extend `apps/api/test/security/secret-scan.spec.ts`'s `SECRET` regex to also match `sk-(proj-)?[A-Za-z0-9_-]{20,}` (OpenAI) and `sk_(live|test)_[A-Za-z0-9]{10,}` outside its current allowlisted test/doc files, so a future accidental commit of a real key to a tracked non-test file fails CI.
Confidence: CONFIRMED

### SEC-5002
Title: `apps/api/.env` was briefly tracked in git (placeholder values only — no real secret exposed)
Severity: 💭 nit (near-miss; good recovery)
Affected component: `apps/api/.env`
Affected profile(s): N/A
Affected page/API: N/A
Description: Commit `b15c770` (2026-05-31 01:23:47 -0400, "feat: scaffold NestJS API with Supabase service and config validation") added `apps/api/.env` to git tracking. Its content was entirely placeholder values (`SUPABASE_URL=https://placeholder.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY=placeholder`, `STRIPE_SECRET_KEY=sk_test_placeholder`, etc. — verified by `git show b15c770:apps/api/.env`). 23 minutes later, commit `a2938e7` ("fix: untrack .env, add .gitignore...") removed it from tracking and added the `.gitignore` rule.
Attack scenario: None realized — no real credential was ever in this tracked file.
Business impact: None.
Evidence: `b15c770106f4a8617b6b533a27d484de63dfa082` (added, all-placeholder content confirmed); `a2938e7232a8d371c58c9802ddc5a325bbb11bf9` (removed, same session).
Root cause: `.gitignore` was added to the repo after the first `.env` file, not before — ordering gap in initial scaffolding.
Remediation: No rotation needed. No action required beyond what already happened.
Suggested regression test: N/A (already covered by the CI `secret-scan` job that now runs on every push/PR).
Confidence: CONFIRMED

### SEC-5003
Title: A second real OpenAI API key + a real Upstash Redis REST token committed to `apps/web/.env.local.example`, one of which remains in production use
Severity: 🔴 CRITICAL
Affected component: `apps/web/.env.local.example` (git history)
Affected profile(s): platform-wide
Affected page/API: N/A — infrastructure credential
Description: Commit `0f6d37a` ("envfix", 2026-06-01 00:44:51 -0400) committed a real OpenAI key (prefix `sk-p…`, len ~166, different from SEC-5001's key) to `apps/api/.env.example`. That key was superseded in `apps/api/.env.example` by `b25f6e8` a few hours later (the SEC-5001 key), but the **same original key** was — independently — also committed to `apps/web/.env.local.example`, alongside a real Upstash Redis REST URL/token (`UPSTASH_REDIS_REST_URL="https://eternal-moccasin-140863.upstash.io"`, `UPSTASH_REDIS_REST_TOKEN="gQAA…"`, len 60) and a real Chrome extension ID. All of these stayed committed until 2026-06-10, when commit `fa50837` ("security: scrub real secrets from apps/web/.env.local.example") replaced them with placeholders. That commit's own message states: *"The committed template held live values (OpenAI sk-proj key, Upstash REST URL + token). ... NOTE: these values are already in git history — rotate them at the providers (OpenAI, Upstash) regardless; sanitizing only prevents further spread."* Independently confirmed: the Upstash token and URL from this exposure are byte-for-byte identical to `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` currently active in `apps/api/.env` today.
Attack scenario: Same as SEC-5001 for the OpenAI key. For the Upstash token: anyone recovering it from history gets REST access to the BullMQ/LangGraph-checkpoint Redis instance — they could read in-flight intake session state (`intake:checkpoint:<threadId>`, 7-day TTL, per `CLAUDE.md`), or flush/corrupt queued document-OCR jobs.
Business impact: Same OpenAI-billing risk as SEC-5001, plus potential read/write access to live application/session state via Upstash.
Evidence: commit `0f6d37a97e59c9c6e9926675fd1d609153815926` (2026-06-01, `apps/api/.env.example`, OpenAI key prefix `sk-p…`); commit `fa50837fca62e2c64f3dcdb388b4cf5822fc7dc5` (2026-06-10, `apps/web/.env.local.example`, diff shows the same OpenAI key plus `UPSTASH_REDIS_REST_URL`/`_TOKEN` being scrubbed — commit message self-confirms these were "live values"); current `apps/api/.env` line for `UPSTASH_REDIS_REST_TOKEN` (redacted, prefix `gQAA…`, len 60) matches exactly.
Root cause: Same as SEC-5001 — real `.env` content copy-pasted into a tracked example template, in two separate files, by the same workflow.
Remediation: **REQUIRES ROTATION by the operator.** (1) Confirm whether the OpenAI key from this commit is the same key still active (it is superseded in `apps/api/.env` by the SEC-5001 key today, so this specific one may already be dead — but that has not been confirmed, and it should be explicitly revoked at the OpenAI dashboard regardless of current-use status, since "superseded" is not the same as "revoked"). (2) Rotate the Upstash Redis REST token from the Upstash console — this one **is** still live — and update `apps/api/.env` (and the VPS copy) with the new token.
Suggested regression test: Same as SEC-5001, plus add an Upstash-token-shape pattern; also add a CI assertion that `*.env.example` / `*.env.local.example` files contain no value matching `[A-Za-z0-9_-]{40,}` immediately after a token-shaped key name outside an explicit placeholder allowlist.
Confidence: CONFIRMED

### SEC-5004
Title: Self-documented, likely-unremediated exposure of a Supabase Management API personal access token (`sbp_…`) for the production-adjacent project
Severity: 🔴 CRITICAL
Affected component: Supabase Management API access for project ref `ujxzxefvtaoxiydbdrhb`
Affected profile(s): platform-wide (Management API tokens can read/modify project settings, database, and — depending on scope — billing)
Affected page/API: N/A — infrastructure credential; not present in this repo's git history as a value (only as a redacted reference)
Description: `graphify-out/VISAAI-HANDOFF.md`, tracked in git from commit `b21f6fb` (2026-06-12 11:27:06 -0400) until it was untracked at `4f23095` (2026-07-04, when `graphify-out/` was gitignored as build output), contained the note: *"Rotate the Supabase access token — a live token was pasted in plaintext in an earlier session transcript (`sbp_…`, project `ujxzxefvtaoxiydbdrhb`). User must rotate. Never echo it."* This is the same project ref currently configured in `apps/api/.env`'s `SUPABASE_URL`. The actual token value was never present in this repository (only the `sbp_…` shorthand reference was committed) — the real exposure happened in an external "session transcript" not contained in this repo. No later commit, doc, or `.ai-audit/*.json` state file found by this audit confirms the rotation was completed.
Attack scenario: If unrotated, whoever has that session transcript (or anyone it was subsequently shared with/leaked to) holds a Supabase Management API token scoped to this project — capable of reading connection strings, service-role keys, and other project secrets directly from the Supabase dashboard/API, effectively a master key to the project even without ever touching this git repo.
Business impact: Full administrative compromise of the Supabase project (data read/export, schema changes, key rotation by the attacker to lock out the legitimate owner) if the token remains live and unrotated.
Evidence: commit `b21f6fbf8f88351b27b9fe11953e845497776ebb` (2026-06-12, file `graphify-out/VISAAI-HANDOFF.md` added with this note) through `4f230958b0588b11386c3d70522d6acd312b1128` (2026-07-04, file untracked). No rotation confirmation found via `git log --all -i --grep='rotat.*supabase\|supabase.*rotat'` (zero hits) or grep of `.ai-audit/*.json` / `docs/**` for a completion note.
Root cause: An AI coding-assistant session transcript containing a real Supabase PAT was apparently generated/stored outside strict secret hygiene at some point before 2026-06-12; the in-repo note is a downstream reminder, not the leak itself, so this repo cannot confirm the transcript's current location or whether it has since been deleted.
Remediation: **REQUIRES ROTATION by the operator, urgently, if not already done.** Rotate the Supabase Management API personal access token for the account/org that owns project `ujxzxefvtaoxiydbdrhb` at https://supabase.com/dashboard/account/tokens, and locate and delete the session transcript referenced in the note (location unknown to this audit — check local AI-assistant session logs / `.claude` history / any shared chat exports from around 2026-06-12).
Suggested regression test: N/A (this is an operational/credential-hygiene gap, not something a repo-local test can catch — the transcript lives outside this repo). Consider a policy check that AI session transcripts are never committed or shared with embedded provider tokens.
Confidence: PLAUSIBLE (self-reported by the repo's own history; the token value itself was not observed by this audit, and rotation status cannot be confirmed from repo contents alone)

### SEC-5005
Title: Real Supabase project credentials (service-role JWT, anon JWT) for project ref `xaemxugqnxoxlqnboxyb` briefly committed to a tracked `.env.example`
Severity: 🟡 high (downgraded from critical: exposure window ~15 hours, and it is unclear whether this project is still in active use — the current `apps/api/.env` points at a *different* project ref, `ujxzxefvtaoxiydbdrhb`)
Affected component: `apps/api/.env.example` (git history)
Affected profile(s): platform-wide, for project `xaemxugqnxoxlqnboxyb` specifically
Affected page/API: N/A
Description: Commit `0f6d37a` (2026-06-01 00:44:51 -0400) committed real values for `SUPABASE_URL=https://xaemxugqnxoxlqnboxyb.supabase.co`, a real `SUPABASE_SERVICE_ROLE_KEY` (JWT, `role=service_role`, decoded and verified — value itself redacted), and a real `SUPABASE_ANON_KEY` (JWT, `role=anon`) to the tracked file `apps/api/.env.example`. Commit `473d2f6` (2026-05-31 19:17:53 -0400 — note this timestamp is *before* `0f6d37a`'s per author-date ordering artifacts in this repo's history, both same-day) titled "fix: scrub real Supabase credentials from .env.example (use placeholders)" replaced them. **Note: today's root `.env` (working tree, untracked, gitignored) still uses this exact project ref (`xaemxugqnxoxlqnboxyb`) for its own `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET` — meaning this project is still configured somewhere in local dev, even though the currently-deployed `apps/api/.env` targets a different, newer project ref.**
Attack scenario: Same as SEC-5004's genre — anyone who can read git history recovers a service-role key (bypasses Row-Level Security entirely) for this Supabase project.
Business impact: If project `xaemxugqnxoxlqnboxyb` still holds real data or is reachable, full RLS-bypassing database read/write access. If it has been fully decommissioned/deleted at Supabase, impact is nil.
Evidence: commit `0f6d37a97e59c9c6e9926675fd1d609153815926` (`apps/api/.env.example`, lines for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — decoded JWT payload confirmed `iss=supabase, ref=xaem…, role=service_role` / `role=anon`, values redacted); superseded by `473d2f6c20aae6a263b1b77e660134f4bd7138ec` (2026-05-31).
Root cause: Same copy-paste-real-env-into-example pattern as SEC-5001/5003, happening repeatedly during initial scaffolding (2026-05-31–06-10) before the CI secret-scan gate existed.
Remediation: Determine whether project `xaemxugqnxoxlqnboxyb` is still an active Supabase project. If yes: **rotate its service-role key, anon key, and JWT secret** from the Supabase dashboard. If it has already been superseded/decommissioned in favor of `ujxzxefvtaoxiydbdrhb`, confirm decommission (project paused/deleted) so the exposed credentials are moot, and clean the stale reference out of the local root `.env` to avoid confusion.
Suggested regression test: Same CI hardening as SEC-5001.
Confidence: CONFIRMED (git-history exposure); rotation/decommission status UNVERIFIED

### SEC-5006
Title: `apps/web/.env.local.example` mixes server-only secret variable names into a client-app template (documentation hygiene, not a live leak)
Severity: 🟡 suggestion
Affected component: `apps/web/.env.local.example`
Affected profile(s): developer-facing only
Affected page/API: N/A
Description: The current (post-scrub, placeholder-only) `apps/web/.env.local.example` contains a first block of correctly-commented `NEXT_PUBLIC_*` examples, followed by an uncommented second block that includes `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — all server-only variables that belong in `apps/api/.env.example`, not the web app's template. All values are placeholders today (`sk_test_<your-stripe-secret-key>` etc.), so this is not a live secret exposure, but it is the exact template that produced SEC-5003: a developer who runs `cp .env.local.example .env.local` and later "helpfully" fills in real values for local testing could recreate the same class of incident, and a reviewer skimming `apps/web/` diffs would not expect to find Stripe/OpenAI keys there.
Attack scenario: N/A directly; this is a contributing-cause finding for future incidents of the SEC-5001/5003 shape.
Business impact: Elevated risk of repeat exposure; also confusing for onboarding (unclear which app actually reads these vars — it does not, `apps/web` has no server-side use of `STRIPE_SECRET_KEY`/`OPENAI_API_KEY`).
Evidence: `apps/web/.env.local.example:12-20` (current working tree / HEAD).
Root cause: Template drift — the file was likely originally a straight copy of `apps/api/.env.example` fragments during initial scaffolding and was never fully split apart when the two apps' concerns diverged.
Remediation: Remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` from `apps/web/.env.local.example` entirely (they belong only in `apps/api/.env.example`); keep only `NEXT_PUBLIC_*` + any genuine web-server config (`PORT`, `WEB_URL`).
Suggested regression test: A lint/CI check that `apps/web/.env.local.example` contains no key matching `^(STRIPE_SECRET|OPENAI_API_KEY|.*SERVICE_ROLE.*|UPSTASH_.*)=` (i.e., a denylist of server-only variable name shapes in the web app's template).
Confidence: CONFIRMED

### SEC-5007
Title: Local-development demo JWTs (Supabase `iss=supabase-demo`) present throughout source, CI, and docs — correctly not secrets, but worth confirming the allowlist stays scoped
Severity: 💭 nit
Affected component: `.gitleaks.toml`, `.github/workflows/agent-tests.yml`, `apps/api/test/security/secret-scan.spec.ts`, `apps/api/src/modules/partner/partner-credentials.spec.ts`
Affected profile(s): N/A
Affected page/API: N/A
Description: Multiple tracked files contain the fixed, publicly-documented Supabase local-development demo JWTs (`iss: "supabase-demo"`, `role: anon` / `role: service_role`, `exp: 1983812996` — i.e. year 2032). These are the same keys shipped by every `supabase start` invocation worldwide and are explicitly called out as non-secret in `.gitleaks.toml`'s own allowlist comment: *"Not secrets: published in Supabase's own docs, identical in every `supabase start` stack... A real project key has `iss=<project-ref>` and does NOT match these literals."* Decoded and confirmed: `iss=supabase-demo` in every instance found (`.gitleaks.toml:23-24`, `agent-tests.yml:112-113,234,248-249,271`, `secret-scan.spec.ts`, `partner-credentials.spec.ts`). No real project-ref JWT was found outside the git-history incidents already covered in SEC-5001/5003/5005.
Attack scenario: None — these keys only authenticate against a local, ephemeral `supabase start` Docker stack that does not exist outside a developer's or CI runner's machine.
Business impact: None.
Evidence: `.gitleaks.toml:21-25`; `.github/workflows/agent-tests.yml:112-113,234,248-249,271`; `apps/api/test/security/secret-scan.spec.ts` (defines the allowlist logic itself).
Root cause: N/A — this is intentional, documented, and correct.
Remediation: No action required. Worth periodically re-confirming (e.g., in a future audit) that the `stripLocalDemoJwts` allowlist logic in `secret-scan.spec.ts` matches by exact token value (it does — confirmed at `secret-scan.spec.ts:82-101`, which tests that a malformed/different payload is NOT allowlisted) rather than by a loose `iss` substring check that a real key could accidentally satisfy.
Confidence: CONFIRMED

### SEC-5008
Title: CI/CD workflow uses no GitHub Actions repository secrets and does not echo sensitive values — clean
Severity: 💭 nit (positive finding)
Affected component: `.github/workflows/agent-tests.yml` (the only workflow file in the repo)
Affected profile(s): N/A
Affected page/API: N/A
Description: The single CI workflow (518 lines, jobs: `api`, `tenant-isolation`, `web`, `web-live` variant, `extension`, plus supply-chain checks) never references `secrets.*` (grep confirms zero matches other than a code comment). Every credential-shaped environment variable it sets is either a fixed, published Supabase local-demo JWT (see SEC-5007), or an explicit placeholder string (`STRIPE_SECRET_KEY: sk_test_ci_placeholder`, `OPENAI_API_KEY: sk-ci-placeholder`, `STRIPE_WEBHOOK_SECRET: whsec_ci_placeholder`). No `pull_request_target` trigger is used anywhere (only `push`/`pull_request` on `main`). `actions/upload-artifact` is used four times, uploading only test reports (`reports/`), Playwright HTML reports, and a generated SBOM (`sbom.json`) — none of these paths can contain the placeholder credentials above even if a test captured request/response bodies, since no real secret ever entered the CI environment.
Attack scenario: None identified.
Business impact: None — positive control.
Evidence: `.github/workflows/agent-tests.yml:1-8` (triggers), full-file grep for `secrets\.` (one match, a comment at line 111), full-file grep for `pull_request_target` (zero matches), lines 66/171/307/514 (`upload-artifact` steps and their `path:` targets).
Root cause: N/A.
Remediation: No action required. If a real deploy credential is ever added to CI (e.g., an SSH key to push to the Hostinger VPS), route it through GitHub Actions encrypted secrets (`secrets.*`) rather than inline — and re-audit at that point, since today's "no secrets used" posture is what keeps this workflow low-risk.
Suggested regression test: N/A.
Confidence: CONFIRMED

### SEC-5009
Title: `infra/self-hosted/docker-compose.yml` and `kong.yml` correctly externalize all credentials via environment substitution
Severity: 💭 nit (positive finding)
Affected component: `infra/self-hosted/docker-compose.yml`, `infra/self-hosted/kong.yml`
Affected profile(s): N/A
Affected page/API: N/A
Description: Every credential-shaped value in the self-hosted Supabase Docker Compose stack (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`/`SERVICE_KEY`, `GOOGLE_SECRET`, `AZURE_SECRET`) is referenced via `${VAR}` / `${VAR:?set X in .env}` substitution from the gitignored `infra/self-hosted/.env`, never hardcoded. `kong.yml` similarly references `$SUPABASE_ANON_KEY` / `$SUPABASE_SERVICE_KEY` as substitution placeholders, not literal values.
Attack scenario: None identified.
Business impact: None — positive control.
Evidence: `infra/self-hosted/docker-compose.yml:36,38,72,91,98,108,117,121,133,136,151-152,154-155,178,199-200,236`; `infra/self-hosted/kong.yml:16,19`.
Root cause: N/A.
Remediation: No action required.
Confidence: CONFIRMED

### SEC-5010
Title: No AWS, Google Cloud, GitHub PAT, Slack token, or private-key material found anywhere in working tree or git history
Severity: 💭 nit (negative/clean finding, included for completeness)
Affected component: whole repository
Affected profile(s): N/A
Affected page/API: N/A
Description: Exhaustive pattern search (working tree, all 1,041 commits via `git log --all -S<pattern>`) for `AKIA`/`ASIA` (AWS), `AIza` (Google API key), `ghp_`/`gho_`/`github_pat_` (GitHub), `xoxb-`/`xoxp-` (Slack), and `-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----` returned zero matches in application code, docs, CI, or history. The only `BEGIN ... PRIVATE KEY` hits anywhere on disk are inside `node_modules/` (Next.js and `dotenv` package documentation files explaining *how* to use private keys — not actual key material), which is untracked, unpublished dependency content and out of scope.
Attack scenario: N/A.
Business impact: None.
Evidence: `git log --all -S'AKIA' | wc -l` → 0; same for `ASIA`, `AIza`, `ghp_`, `gho_`, `github_pat_`, `xoxb-`, `xoxp-`, `BEGIN RSA PRIVATE KEY`, `BEGIN OPENSSH PRIVATE KEY` (all → 0 commits).
Root cause: N/A.
Remediation: No action required.
Confidence: CONFIRMED

---

## Summary of scope actually covered vs. explicitly out of scope

- **Covered:** all tracked + untracked files under the repo root at scan time; full `git log --all` (1,041 commits, all local branches — `git branch -a` shows ~20+ feature branches, all included since `--all` was used); `.github/workflows/`; `infra/`; `deploy/`; `docs/**`; `qa/**`; `scripts/**`; `.ai-audit/*.json` (tracked); `apps/*` source trees; `node_modules` doc files spot-checked only for the private-key pattern (not a full dependency audit — out of scope for a secrets audit of first-party code).
- **Not covered (explicitly out of scope for this repo-local audit):** the separate `VISAAIDocs` repository referenced throughout `CLAUDE.md` (documentation now lives there, not here — any secret that may have been committed to *that* repo's history is unverified and unauditable from this checkout); the actual GitHub repo's collaborator/visibility settings (only an unauthenticated existence probe was possible, returning 404); the external "session transcript" referenced in SEC-5004 (location unknown); the live VPS filesystem's `apps/api/.env` / `apps/web/.env` (only the local checkout's copies were read).

---

## Answers to the assignment's explicit questions

**Counts by severity:**
- 🔴 Critical: 4 (SEC-5001, SEC-5003, SEC-5004, SEC-5005 — note SEC-5005 is labeled 🟡 high above per its own downgrade rationale, but is grouped with the critical-tier rotation items; if counting strictly by the emoji marker: **3 critical (5001, 5003, 5004) + 1 high (5005)**)
- 🟡 Suggestion/high: 2 (SEC-5005, SEC-5006)
- 💭 Nit: 5 (SEC-5002, SEC-5007, SEC-5008, SEC-5009, SEC-5010 — three of these, 5008/5009/5010, are positive/clean findings, not defects)

**Real (non-placeholder) secrets found in the working tree:** 0 tracked. Working tree contains real, currently-valid secrets only in gitignored, untracked local files (`./.env`, `apps/api/.env`, `infra/self-hosted/.env`) — expected local-dev state, not a git-exposure finding by itself, but two of the values inside `apps/api/.env` (`OPENAI_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`) are the exact same values confirmed exposed in git history (see rotation list).

**Real (non-placeholder) secrets found in git history:** 4 distinct real credentials confirmed with byte-for-byte value evidence:
1. OpenAI API key (SEC-5001) — still active today
2. A second, earlier OpenAI API key (SEC-5003) — supersession status unconfirmed, not seen revoked
3. Upstash Redis REST token (SEC-5003) — still active today
4. Supabase project credentials for ref `xaemxugqnxoxlqnboxyb` — service-role JWT + anon JWT (SEC-5005) — live/decommission status unconfirmed

Plus one credential (Supabase Management API `sbp_` PAT, SEC-5004) that is documented as exposed by the repo's own history but whose actual value was never committed to *this* repo (self-reported exposure elsewhere).

**Rotation list (by name):** see the "CREDENTIALS REQUIRING ROTATION" table above — in short: **OpenAI API key** (current + one historical), **Upstash Redis REST token**, **Supabase Management API personal access token** for project `ujxzxefvtaoxiydbdrhb` (pending confirmation), and **Supabase service-role/anon/JWT-secret** for project `xaemxugqnxoxlqnboxyb` (pending confirmation the project is still live).
