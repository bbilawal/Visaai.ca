# VisaAI — Threat Model

Master Security Audit, 2026-08-16. Method: STRIDE per trust boundary (see
`SECURITY_ARCHITECTURE.md`), grounded in the actual code and the wave-1 findings.

## Assets (what an attacker wants)

| Asset | Why it matters |
|---|---|
| Identity documents (passports, birth/police certificates, bank statements) | Irreplaceable PII; core product data in Supabase Storage |
| Applicant PII (name, DOB, nationality, immigration status, addresses) | GDPR-regulated; immigration status is sensitive-category |
| Auth tokens / sessions | Account takeover → all of the above |
| Money movement (subscriptions, one-time fees, consultant payouts) | Direct financial loss |
| Consultant trust attributes (KYC, license_verified, ratings, payout account) | Marketplace integrity + fraud |
| Audit / provenance chain | Compliance evidence; must be tamper-evident |
| Tenant boundary (user↔user, org↔org) | Cross-tenant disclosure is the highest-impact class |

## Actors

Anonymous internet user; registered applicant; consultant; org admin;
support/staff; platform/super admin; partner API client; AND the untrusted
*content* of uploaded documents and government-portal pages (treated as an actor
for prompt-injection purposes).

## Principal threats (STRIDE) and disposition

| STRIDE | Threat | Realised finding(s) | Disposition |
|---|---|---|---|
| **Elevation** | Applicant/consultant writes system-controlled columns via direct PostgREST (RLS bypass of app column allowlist) | SEC-4090, 4091, 4094, 9002 | FIXED (triggers + policy re-scope + read-only) |
| **Elevation** | Anon/authenticated calls SECURITY DEFINER RPCs PostgREST auto-exposes | SEC-4001–4005 | FIXED (REVOKE + seed parity) |
| **Elevation** | Regular user reaches admin function (BFLA) | authz audit: none found at API layer | No open finding (API layer clean) |
| **Info disclosure** | Cross-tenant document read via adopted storage path | SEC-3005/3050 | FIXED (path ownership check) |
| **Info disclosure** | Anon reads internal margin/COGS; over-broad PII in responses | SEC-4092; upload-pii MEDIUM/LOW | FIXED (4092); others triaged |
| **Tampering** | Forge audit/provenance/delivery records | SEC-4001, 4002, 4004 | FIXED (REVOKE) |
| **Spoofing** | Forge login history / self-reset lockout on unauthenticated endpoint | SEC-1002 | FIXED (token-verified) |
| **Spoofing** | Spoof client IP via X-Forwarded-For to defeat throttle/lockout | SEC-7001 | FIXED (nginx overwrite) |
| **Tampering** | Indirect prompt injection from uploaded-doc OCR / free text into LLM prompts | SEC-6001–6005 | FIXED (fence + coverage guard) |
| **Repudiation/DoS** | Unbounded/unauthenticated listing + AI cost amplification | SEC-3040, 3041 | FIXED (limits + throttles) |
| **Tampering** | Payment/entitlement self-grant from the browser | SEC-9001/9002 (DB), API layer verified webhook-only | FIXED |
| **Elevation** | Org plan self-upgrade | SEC-3004 | FIXED |
| **Spoofing** | Hostile local page drives the browser extension | SEC-8510, 8001 | FIXED (origin+apiUrl allowlist) |
| **Info disclosure** | Secrets in code / client bundles / git history | SEC-5001/3/4 (history, live) | OPERATOR (rotate); no secrets in client bundles |
| **DoS/Elevation** | DB/edge exposure, spoofable proxy, weak creds | SEC-7002/7001/7003/7004/7009 | FIXED (7001/2/4); OPERATOR (7003/9) |
| **Repudiation** | GDPR erasure incomplete → data retained after deletion | SEC-12003 | FIXED (recursive purge) |

## Attack trees (top two by impact)

### 1. Cross-tenant identity-document read
- (a) Guess/obtain another tenant's storage path → adopt via `confirmAttachment` → sign via service role → **CLOSED** (path bound to caller's folder).
- (b) Read another tenant's document rows directly → RLS on `documents`/`generated_documents` is owner-scoped (`FOR ALL USING auth.uid()=user_id`) → **not open**.
- (c) Service-role key leaked to a client → **not present** in any client bundle (verified).

### 2. Consultant marketplace fraud
- (a) Self-approve KYC/license/payouts + set own payout account → **CLOSED** (trigger).
- (b) Redirect payout via Connect account id from request → API takes it from DB bound to the authenticated consultant → **not open**.
- (c) Fabricate ratings → rating columns trigger-pinned → **CLOSED**.

## Residual (see SECURITY_REMAINING_RISKS.md)
Client-side login bypassing the app lockout (SEC-1001), same-origin storage
(SEC-12001), non-httpOnly Supabase cookies (SEC-8003), and operator credential
rotations. None is a known open CRITICAL/HIGH *exploitable* defect in code.
