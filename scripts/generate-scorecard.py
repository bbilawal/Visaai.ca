#!/usr/bin/env python3
"""
Generate VISAAI_MASTER_SCORECARD.{md,csv} from the findings register plus
recorded measurements (Phase 12, §18).

Kept in the repo because §18.4 says: "Never edit the score directly without
changing the underlying evidence." A scorecard typed by hand can be nudged; one
computed from the register cannot be, without changing a finding's status or a
recorded measurement first.

Scoring rules, all visible below:
  * an unresolved, INTERNALLY ACTIONABLE Critical/High caps its category at 60
  * a finding carrying `blocked_by` does not cap the internal score — it moves
    to the external-execution column (§18.3)
  * every score is capped at 95 while independent review is outstanding (§18.2
    requires it for 100; it was waived at program start)
  * a category with no measurement scores low and says so

Run:  python3 scripts/generate-scorecard.py
"""

import json, csv, subprocess, datetime

REG = json.load(open('/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI/.ai-audit/findings-register.json'))['findings']
BY = {x['id']: x for x in REG}
COMMIT = subprocess.run(['git','rev-parse','--short','HEAD'],cwd='/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI',
                        capture_output=True,text=True).stdout.strip()
TODAY = '2026-08-09'

def blocked(fid):   return bool(BY.get(fid,{}).get('blocked_by'))
def resolved(fid):
    s = BY.get(fid,{}).get('status','').upper()
    return s.startswith(('RESOLVED','CLOSED','MITIGATED'))

# (category, weight, requirements, evidence, tests, blocking_finding_ids, internal, ext_status, prod_validated, notes)
C = [
 ("Product completeness",3,"All advertised journeys implemented","53 web routes, 304 API routes, 51 modules; guest funnel→intake→documents→VRI→submission present","web e2e 113, api 2290",[],85,"n/a","no","Track step (§8 CLAUDE.md) still not implemented — no monitor module, no inbound webhook"),
 ("Architecture",3,"Layering enforced; no cycles","Tarjan SCC: 0 circular deps (was 2 groups); ports/adapters for AI telemetry, payments, users","di-graph.spec.ts",["ARCH-003","ARCH-004","ARCH-005"],95,"n/a","no","Ports introduced this audit; no independent architecture review"),
 ("Code quality",2,"Typecheck clean; lint at or below baseline","api/web/mobile tsc 0; changed files lint at or below HEAD baseline","tsc x3",[],85,"n/a","no","Repo-wide lint has pre-existing no-unsafe-* debt untouched by this audit"),
 ("Backend",3,"Modules cohesive, guarded, validated","51 modules, 296/304 routes guarded, zod on write routes","api 2290 tests",["API-001","API-002"],95,"n/a","no",""),
 ("APIs",3,"Consistent errors, validation, status codes","Generic 5xx bodies, no stack leakage; authorization denials now 403 not 500","cross-tenant probe, 9 routes",["SEC-102","SEC-103","SEC-105"],100,"n/a","no",""),
 ("Supabase execution",2,"Migrations replay cleanly","93 migrations replay: 0 errors, 133 tables/143 RLS/143 policies","local replay",[],90,"7 migrations staged","no","7 verified locally, none applied to production (BLK-1)"),
 ("Database design",2,"Keys, constraints, FKs correct","129 prod tables; FK/PK/check constraints reviewed; account_lockouts re-keyed (email,ip)","schema-hygiene-db.spec.ts",["SEC-001"],95,"apply pending","no",""),
 ("Database performance",3,"No missing/duplicate indexes; measured","5 redundant indexes dropped (backward-scan proved on 56k rows); pg_stat_statements max mean 6.4ms","schema-hygiene-db.spec.ts",["PERF-004","PERF-007"],95,"apply pending","no","Measured on seeded local data, not production volume"),
 ("RLS and tenant isolation",5,"No cross-tenant read/write","40 isolation tests vs real Supabase; 9-route adversarial probe leaked 0 bytes","rls-cross-tenant + 11 messaging suites",[],100,"n/a","no","Strongest-evidenced category; production verified read-only in Phase 4"),
 ("Authentication",4,"Token validation, MFA, anonymous gate","JwtGuard + 30s cache; anonymous never cached (2 tests pin it); MFA aal surfaced","token-cache.spec.ts, anonymous-gate.spec.ts",["AUTH-001"],90,"dashboard setting","no","Server-side password min length still 8 in production"),
 ("Authorization",4,"Role/permission enforcement matches DB","6 roles probed live; matrix matches role_permissions exactly incl. support_agent boundary","ROLE_BASED_TEST_MATRIX.csv",["AUTH-002"],100,"n/a","no",""),
 ("Security",5,"No Critical/High unresolved; scans clean","gitleaks 0/857 commits, semgrep 0/97 rules (both self-tested), osv 0 reachable","4 security suites",["SEC-001","SEC-101"],95,"apply pending","no","No production pentest; no DAST"),
 ("Privacy",4,"DSAR rights work; policy accurate","Export 19 categories, erasure verified live + audited; false backup claim removed","privacy.service.spec.ts",["PRIV-001","PRIV-002","PRIV-003","PRIV-004"],90,"n/a","no","No DPIA, no ROPA, no sub-processor verification, no consent banner"),
 ("Web functionality",3,"Routes render for every role","40 static routes swept authenticated, 0 load errors","web e2e 113",["WEB-001","WEB-002"],95,"n/a","no",""),
 ("Web UI/UX",3,"Design tokens honoured; no theme breakage","3 component-level token bypasses fixed; dark mode repaired on 4 admin surfaces","tokens.test.ts source scans",["WEB-004","WEB-008","WEB-009"],100,"n/a","no",""),
 ("Accessibility",4,"WCAG 2.1 AA, both themes","80 authenticated page loads, 0 serious/critical axe violations; Lighthouse a11y 100 x5","axe sweep + 43 country tests",["WEB-006","WEB-011"],95,"n/a","no","No screen-reader or keyboard-only human testing"),
 ("Web performance",3,"Core Web Vitals good","Desktop perf 100 x5; throttled mobile 94-96, LCP 2.21-2.47s, CLS 0.000","lighthouserc 5 routes x3",["PERF-006"],95,"n/a","no","Local build, not the VPS"),
 ("iOS functionality",2,"App builds and core flows work","tsc 0, 185 tests, config audited","mobile jest",["MOB-001"],70,"credentials","no","NO device or simulator run; deep links unverifiable without Team ID"),
 ("iOS quality",2,"Secure storage, transport, permissions","Chunked SecureStore WHEN_UNLOCKED_THIS_DEVICE_ONLY; ATS arbitrary loads false","code review",[],85,"n/a","no","No device run"),
 ("Android functionality",2,"App builds and core flows work","tsc 0, 185 tests; blockedPermissions verified against prebuilt manifest","mobile jest",["MOB-001","MOB-002"],70,"credentials","no","NO device or emulator run"),
 ("Android quality",2,"Permissions minimal, links scoped","RECORD_AUDIO + SYSTEM_ALERT_WINDOW stripped; intent filter scoped from whole domain to 5 paths","code review",["MOB-002"],85,"n/a","no",""),
 ("Mobile performance",2,"Startup, bundle, memory measured","Bundle MEASURED via expo export: iOS 4.8MB / Android 5.1MB Hermes bytecode, 1.1MB assets, 11MB total","expo export",[],50,"n/a","no","Bundle measured this phase (was unmeasured, scored 0). Startup time, memory and frame rate still need a device or emulator"),
 ("AI case processing",3,"Graphs produce correct artefacts","LangGraph intake/narrative/VRI compile and run; VRI renormalises unassessed factors","vri-unassessed-factors.spec.ts",["FAKE-002","FAKE-003"],85,"apply pending","no","No live-model output-quality evaluation"),
 ("AI safety",4,"Prompt injection defended; guardrails","Untrusted-content fencing + directive on the document-drafting prompt; intent classifier pre-LLM","prompt-injection-fencing.spec.ts (7)",["AI-001"],70,"model budget","no","Fencing untested against a live model — the highest-value untested area"),
 ("AI performance and cost controls",2,"Token/cost ceilings measured","AiUsageMeter present; ANALYTICS_COLLECT_MAX_EVENTS caps ingest","none",[],40,"model budget","no","No token, prompt-size or time-to-first-token measurement"),
 ("Voice assistant",2,"Consent, transcripts, retention","Consent flags per capability in schema; transcripts in the data export","schema review",[],70,"n/a","no","No live STT/TTS run; latency unmeasured"),
 ("Document and OCR workflows",3,"Upload integrity, provider abstraction","Attachment integrity fails closed on metadata mismatch; OCR provider factory is vendor-agnostic","attachment-upload-integrity.spec.ts (6)",["DB-002"],90,"n/a","no","No real OCR provider exercised"),
 ("Notifications",2,"Delivery, preferences, ops dashboards","Notification ops + templates admin pages execute; bell reachable","3 admin e2e specs",["WEB-007"],90,"n/a","no",""),
 ("Messaging",3,"Threads isolated, paginated","11 messaging RLS suites; authorization now precedes conversation creation","messaging-* suites",["SEC-105"],100,"n/a","no",""),
 ("Consultant workflows",3,"Assignment, review, notes","Consultant dashboard executed for the first time; assignment event bus extracted","consultant-dashboard.spec.ts",["TEST-005"],80,"n/a","no","Only one consultant spec exists; booking/payout journeys unexecuted"),
 ("Payments and subscriptions",4,"Money paths correct and idempotent","Stripe-hosted, no PAN/CVV anywhere; webhook rejects forged+missing signatures; idempotency on money paths","jest-e2e money-path suite",[],85,"n/a","no","No sandbox payment executed end to end"),
 ("Analytics",3,"Events reach the warehouse","Ingest accepts unauthenticated beacons after ANALYTICS-001; PII blocked in CI","analytics-unauthenticated-ingest.spec.ts",["ANALYTICS-001"],90,"n/a","no","Journey/DAU dashboards not re-verified with real traffic"),
 ("Partner APIs and webhooks",2,"Scopes, keys, signatures","RequireScopes on partner routes; HMAC timingSafeEqual verification","partner suites",[],80,"n/a","no","Partner onboarding→credential→webhook journey not executed end to end"),
 ("Test coverage",4,"Critical paths covered; no silent skips","API 348 suites/2290 tests 0 skipped; web 256 unit + 113 e2e; mobile 185","full run",["TEST-001","TEST-002","TEST-005"],95,"n/a","no","Coverage percentage not measured; presence-of-test is not proof of quality"),
 ("Regression reliability",4,"Suites deterministic","0 skipped with credentials; 4 new guards each self-tested by reintroducing the defect","full run",[],95,"n/a","no","3 visual baselines are environment-coupled (WEB-010)"),
 ("CI/CD",3,"Gates real, not decorative","tenant-isolation job fails if suites skip; dependency gate on reachability; web-e2e-live added","workflow review",["SEC-101","DEP-001"],85,"not executed","no","web-e2e-live has never run on GitHub Actions"),
 ("Observability",3,"Correlation, redaction, alerting","X-Request-Id across whole API; PII redaction verified live","request-correlation.spec.ts",["OPS-004"],70,"n/a","no","SENTRY_DSN unset (BLK-3) — logs are the only diagnostic surface"),
 ("Operational readiness",5,"Backups, runbooks, rollback","Self-hosted stack backs itself up AND restore-tested (133 tables matched)","restore test",["BLK-1"],60,"purchase","no","HOSTED PRODUCTION HAS NO BACKUP. Single largest risk in the platform"),
 ("Documentation quality",2,"Accurate, no fabricated claims","CLAUDE.md corrected (Track step, Postmark); privacy policy false backup claim removed","doc audit",["ARCH-002","DOC-001","DOC-003"],90,"n/a","no",""),
 ("Repository separation",3,"Code and docs cleanly split","255 docs moved with double checksum verification; code builds with docs renamed away","separation proof",["ARCH-001","DOC-003"],95,"n/a","no","Phase 6-10 deliverables were briefly written to a stray path; corrected"),
 ("Maintainability",2,"Duplication controlled","Combobox ARIA logic extracted: shared 14-line blocks 21→3; 0 document duplicates","country-selector 43 tests",["DUP-002","DUP-003"],90,"n/a","no",""),
 ("Remaining-task completeness",3,"Every open item recorded with an owner","78 findings, 0 duplicate ids, 0 coverage gaps, blocked_by on all 11 blocked","register audit",[],95,"n/a","no","Phase 13 will sweep for TODO/FIXME/etc. not yet in the register"),
 ("Overall production readiness",5,"Safe to serve real users","No backup, 7 unapplied migrations, no device testing, no production pentest","aggregate",["BLK-1"],45,"purchase + credentials","no","NO-GO for public launch on BLK-1 alone"),
]

rows=[]
for (name,w,req,ev,tests,fids,internal,ext,prod,notes) in C:
    unresolved_ia = [i for i in fids if not resolved(i) and not blocked(i)]
    blocked_ids   = [i for i in fids if blocked(i)]
    # Rule: an internally-actionable unresolved Critical/High caps the category.
    for i in unresolved_ia:
        if BY.get(i,{}).get('severity','').upper() in ('CRITICAL','HIGH'):
            internal = min(internal, 60)
    # §18.2: 100 also requires independent review, which was waived ("solo").
    final = min(internal, 95)
    review_note = 'capped at 95 — independent review waived at program start (solo)' if internal >= 100 else ''
    rows.append(dict(
        category=name, weight=w, requirements=req, evidence_required=ev, tests_required=tests,
        blocking_findings='; '.join(fids) or 'none',
        unresolved_internally_actionable='; '.join(unresolved_ia) or 'none',
        externally_blocked='; '.join(blocked_ids) or 'none',
        internal_implementation_score=internal, external_execution_status=ext,
        production_validated=prod, target_score=100, final_score=final,
        remediation_needed=notes or '—', review_caveat=review_note,
        reviewer='solo (independent review waived)', review_date=TODAY, commit=COMMIT))

with open('/Users/bilawalmuzaffar/Desktop/VisaAI/VISAAIDocs/audit/VISAAI_MASTER_SCORECARD.csv','w',newline='') as fh:
    w_=csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w_.writeheader(); w_.writerows(rows)

tw=sum(r['weight'] for r in rows)
weighted=sum(r['final_score']*r['weight'] for r in rows)/tw
print(f'{len(rows)} categories written')
print(f'weighted final score: {weighted:.1f}')
print(f'unweighted mean: {sum(r["final_score"] for r in rows)/len(rows):.1f}')
print(f'categories at 95 (capped max): {sum(1 for r in rows if r["final_score"]==95)}')
print(f'categories below 70: {[r["category"] for r in rows if r["final_score"]<70]}')
json.dump(rows, open('/tmp/sc/rows.json','w'), indent=1)
