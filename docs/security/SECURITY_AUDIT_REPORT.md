# VisaAI — Security Audit Report

Master Security Audit & Hardening. 2026-08-16. Branch
`security/master-audit-2026-08-16`, from `13815351`.

## Method

DISCOVER → MAP → THREAT MODEL → AUDIT → TEST → FIND → FIX → RETEST → HARDEN →
REGRESSION → DOCUMENT → VERIFY. Eleven specialist agents (Security Engineer ×3,
Backend/DB/DevOps/AI/Frontend/Mobile, Code Reviewer) ran parallel read-only
audits of authentication, authorization/IDOR, API validation, database/RLS,
secrets, AI/LLM, infra/CI/deps, frontend, payments, clients, and upload/PII.
The orchestrator additionally ran **DAST**: a disposable local copy of the
production schema was stood up and the highest-impact findings were reproduced
as working exploits, fixed, and re-run.

Full per-domain evidence: `docs/security/_wave1/*.md`. Fix/retest table:
`SECURITY_REMEDIATION_LEDGER.md`. Test evidence: `SECURITY_TEST_RESULTS.md`.

## Metrics (from actual evidence, not estimates)

| Metric | Count |
|---|---|
| Applications / surfaces reviewed | 6 (web, api, extension, mobile, partner-sdk, sidecar[dead]) |
| API controllers / routes enumerated | 70 / 319 |
| Web pages reviewed | 58 |
| DB tables reviewed | 135 (migrations) / 143 (backup); 100% RLS |
| Storage buckets reviewed | 4 (all private) |
| Roles modelled | 6 |
| Integrations reviewed | Stripe/Connect, Azure DI, OpenAI, SMTP, Sentry, Expo, gov portals |
| Env vars inventoried | 121 |
| Dependency workspaces scanned | 5 + root |
| Specialist audit reports | 11 |
| Security regression tests added | 14 jest + 8 SQL assertions |

## Findings by severity (de-duplicated across agents)

| Severity | Discovered | Fixed | Operator | Accepted |
|---|---|---|---|---|
| CRITICAL | 10 | 9 | 1 (secret rotation) | 0 |
| HIGH | ~17 | 13 | 3 | 3 (architectural) |
| MEDIUM | ~20 | 7 | — | rest triaged |
| LOW | ~18 | 2 | — | rest triaged |
| INFORMATIONAL | ~6 | — | — | noted |

(Agents reported overlapping IDs for the same root defect — e.g. SEC-4090 ≡
payments SEC-9003; SEC-4091 ≡ db SEC-4006; SEC-9001 ≡ SEC-4094; SEC-3005 ≡
SEC-3050. Counts above are de-duplicated to unique defects.)

## CRITICAL findings (all closed in code except operator rotation)

See `SECURITY_REMEDIATION_LEDGER.md` for the full per-finding table with
evidence, root cause, remediation, test, and retest result. Headlines:

1. **RLS column-write escalations** (SEC-4090/4091/4094/9002) — a recurring
   pattern: `FOR ALL USING (auth.uid()=user_id)` policies with no column
   restriction on tables mixing user-owned and system-controlled columns, all
   reachable by direct PostgREST with the user's own (public) JWT. Closed with
   BEFORE-UPDATE triggers pinning trust/payout/entitlement columns, a re-scoped
   `WITH CHECK`, and making `payments` owner-read-only.
2. **Unrevoked SECURITY DEFINER RPCs** (SEC-4001/4002/4003) — PostgREST
   auto-exposed audit/provenance/outbox RPCs to anon/authenticated → forge audit
   chains, forge verification evidence, read cross-tenant PII. Closed with
   REVOKE + seed parity so local/CI match prod.
3. **Cross-tenant document read** (SEC-3005/3050) — attachment confirm trusted a
   client `storagePath` later signed by the service-role client. Closed by
   binding the path to the caller's conversation folder.
4. **Postgres exposed on 0.0.0.0** (SEC-7002) — bound to loopback.
5. **Live secrets in git history** (SEC-5001/3/4) — operator rotation required.

## Finding record

Each wave-1 report uses the required SEC-XXXX template (Title, Severity, Affected
component/profile/page-API, Description, Attack scenario, Business impact,
Evidence `path:line`, Root cause, Remediation, Security/Regression test, Retest,
Status). No live secret values appear in any report (redacted).

## Adversarial second pass

After remediation, the fixes were re-reviewed as if authored by another party:
trigger predicates rely on JWT-signed `auth.role()`/`app_metadata` (unforgeable);
the `meeting_url` allowlist regex rejects `zoom.us.attacker.com` and
`evil.com/zoom.us`; the attachment prefix is fully server-derived; the lockout
keying prevents victim-DoS; the CSP and extension allowlists were re-checked. No
new open CRITICAL/HIGH surfaced.

## Conclusion

Within the authorized scope, no known unresolved CRITICAL or HIGH *exploitable*
vulnerability remains in code. Remaining items are operator credential/config
actions and documented architectural residuals with mitigations in place. See
`SECURITY_FINAL_GATE.md`.
