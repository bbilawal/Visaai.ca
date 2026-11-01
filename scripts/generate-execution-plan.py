#!/usr/bin/env python3
"""
Generate VISAAI_REMAINING_TASKS_COMPLETE_EXECUTION_PLAN.md (Phase 14, section 20).

Section C is generated from .ai-audit/remaining-tasks.json rather than typed, for
the same reason the scorecard is generated: a plan and a tracker that disagree
are worse than either alone, and they always drift when both are maintained by
hand. Edit the tracker, re-run this.

Run:  python3 scripts/generate-execution-plan.py
"""
import json, subprocess, datetime

ROOT = '/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI'
OUT = '/Users/bilawalmuzaffar/Desktop/VisaAI/VISAAIDocs/roadmap/VISAAI_REMAINING_TASKS_COMPLETE_EXECUTION_PLAN.md'

tracker = json.load(open(f'{ROOT}/.ai-audit/remaining-tasks.json'))
TASKS = tracker['tasks']
REG = json.load(open(f'{ROOT}/.ai-audit/findings-register.json'))['findings']
SCORE = json.load(open(f'{ROOT}/.ai-audit/scorecard.json'))

commit = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--short', 'HEAD'],
                        capture_output=True, text=True).stdout.strip()

TERMINAL = ('RESOLVED', 'CLOSED', 'MITIGATED', 'WITHDRAWN')
open_f = [f for f in REG if not f['status'].upper().startswith(TERMINAL)]
blocked = [f for f in open_f if f.get('blocked_by')]
actionable = [f for f in open_f if not f.get('blocked_by')]

# Section B ordering: the spec's group taxonomy, most urgent first.
GROUPS = [
    'Critical pre-production blockers', 'High-priority stability work',
    'Security and privacy', 'Database and Supabase', 'Performance',
    'Web UI/UX', 'iOS', 'Android', 'Accessibility', 'Testing',
    'Infrastructure', 'Monitoring and operations', 'Closed beta',
    'Public launch', 'Marketing and growth', 'External/manual actions',
    'Documentation', 'Nice-to-have enhancements',
]
order = {g: i for i, g in enumerate(GROUPS)}
PRI = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}
TASKS.sort(key=lambda t: (order.get(t['group'], 99), PRI.get(t['priority'], 9), t['id']))

L = []
w = L.append

w('# VisaAI — Complete Remaining-Task Execution Plan')
w('')
w(f"**Phase 14 · §20** · {datetime.date.today()} · commit `{commit}`")
w('')
w('Generated from `.ai-audit/remaining-tasks.json` by')
w('`scripts/generate-execution-plan.py`. Edit the tracker, not this file — a plan')
w('and a tracker maintained separately always drift.')
w('')
w('---')
w('')

# ── Section A ────────────────────────────────────────────────────────────────
w('## Section A — Current verified project state')
w('')
w('### Completed')
w('')
w('| Area | State |')
w('|---|---|')
w('| Backend | NestJS 11, 51 modules, 304 routes. Typecheck clean |')
w('| Test suite | **351 suites / 2,320 tests — 0 failed, 0 skipped** (local Supabase, all 100 migrations) |')
w('| Web unit | 256 passed (56 files) |')
w('| Mobile | 185 passed; bundle measured (iOS 4.8 MB / Android 5.1 MB Hermes) |')
w('| Tenant isolation | RLS on 128/128 production tables, 0 disabled; 40 isolation tests gated in CI with a no-skip assert |')
w('| CI | 8 jobs, both authenticated E2E jobs now skip-gated |')
w('| Audit findings | 88 filed, **80 resolved** |')
w('')
w('### Partially completed')
w('')
w('| Area | What is done | What is not |')
w('|---|---|---|')
w('| Regional OCR | `azure-di` implemented and unit-tested | Never run against a live Azure endpoint; `aws-textract` and `google-docai` remain deliberate scaffolds |')
w('| Mobile | Bundle size measured | Startup and memory need physical devices |')
w('| Privacy | Export covers 18 categories, erasures audited | Retention policy still a proposal, no TTL enforced |')
w('| Payments | Charges, subscriptions, payouts shipped | Refund / claw-back reversal not built |')
w('| Deep links | Routes serve the files and 404 without credentials | Credentials not supplied, so both 404 in production |')
w('')
w('### Missing')
w('')
w('- Post-submission **Track** stage — no `monitor` module, no inbound webhook (`ARCH-002`)')
w('- Data-retention enforcement (`COMPLIANCE.md` §7)')
w('- Refund reversal, mobile intake chat, duplicate-document detection')
w('- Production error tracking — Sentry wired in code, `SENTRY_DSN` unset')
w('')
w('### Scores')
w('')
w(f"Weighted **{SCORE['weighted_score']}/100** across {SCORE['categories']} categories "
  f"(unweighted mean {SCORE['unweighted_mean']}). Ceiling **{SCORE['ceiling']}** — §18.2 requires")
w('independent review for 100, and review was waived at program start.')
w('')
w(f"Below 70: {', '.join(SCORE['below_70'])}.")
w('')
w('> **No category is production-validated.** Every measurement in this program was')
w('> taken against a local stack. Production runs a build from 2026-07-02..07-09.')
w('')
w('### Open findings')
w('')
w(f'**{len(open_f)} open — {len(actionable)} internally actionable, {len(blocked)} externally blocked.**')
w('')
w('| ID | Severity | Blocker |')
w('|---|---|---|')
for f in sorted(open_f, key=lambda x: x['id']):
    b = (f.get('blocked_by') or 'none — actionable').split('.')[0][:88]
    w(f"| `{f['id']}` | {f['severity'].title()} | {b} |")
w('')
w('### External blockers')
w('')
w('| Blocker | Unlocks |')
w('|---|---|')
w('| No backup on the production database (BLK-1) | 9 migrations, incl. the live Schengen defect |')
w('| VPS SSH access | the deploy, the env read, the firewall and header fixes |')
w('| Azure/AWS/GCP OCR account | validating `azure-di` against a real endpoint |')
w('| Play Console / Apple Developer | app-link verification |')
w('| Physical devices | mobile startup and memory |')
w('| A live model + spend budget | AI cost and latency measurement |')
w('| A second reviewer | the 5 points every category is capped by |')
w('')
w(f'**Last validated commit:** `{commit}` · **Validation date:** {datetime.date.today()}')
w('')

# ── Section B ────────────────────────────────────────────────────────────────
w('## Section B — Prioritized remaining tasks')
w('')
w('The critical path, in order. **The order is load-bearing.**')
w('')
w('```')
w('RT-003 backup ─────┐')
w('                   ├─> RT-004 apply 9 migrations ──┐')
w('RT-002 read env ───┘                               ├─> RT-005 deploy')
w('                                                   │')
w('RT-001 OCR adapter  [DONE — was the hard gate] ────┘')
w('```')
w('')
w('Before the Phase 13 remediation, deploying would have taken production **down**:')
w('the API could not boot under any OCR configuration. That gate is now cleared.')
w('')
open_tasks = [t for t in TASKS if t['status'] != 'done']
done_tasks = [t for t in TASKS if t['status'] == 'done']
for g in GROUPS:
    rows = [t for t in open_tasks if t['group'] == g]
    if not rows:
        continue
    w(f'### {g}')
    w('')
    w('| ID | Task | Pri | Blocked by |')
    w('|---|---|---|---|')
    for t in rows:
        b = (t['blocked_by'] or '—').split('—')[0].strip()[:46] or '—'
        w(f"| `{t['id']}` | {t['title']} | {t['priority']} | {b} |")
    w('')
w('### Completed during Phase 13')
w('')
w('| ID | Task | Evidence |')
w('|---|---|---|')
for t in done_tasks:
    w(f"| `{t['id']}` | {t['title']} | {t.get('completion_evidence','')[:150]} |")
w('')

# ── Section C ────────────────────────────────────────────────────────────────
w('## Section C — Complete details for every task')
w('')
for t in TASKS:
    flag = ' ✅ DONE' if t['status'] == 'done' else ''
    w(f"### {t['id']} — {t['title']}{flag}")
    w('')
    w(f"| | |")
    w(f"|---|---|")
    w(f"| **Priority / severity** | {t['priority']} / {t['severity']} |")
    w(f"| **Group** | {t['group']} |")
    w(f"| **Repository** | {t['repository']} |")
    w(f"| **Environment** | {t['environment']} |")
    if t.get('finding'):
        w(f"| **Finding** | `{t['finding']}` |")
    w(f"| **Dependencies** | {', '.join(t['dependencies']) or 'none'} |")
    w(f"| **Credentials** | {t['credentials_required'] or 'none'} |")
    w(f"| **External approval** | {'yes' if t['external_approval_required'] else 'no'} |")
    w(f"| **Migration** | {t['migration_required'] or 'none'} |")
    w('')
    w(f"**Reason.** {t['reason']}")
    w('')
    w(f"**Evidence.** {t['evidence']}")
    w('')
    if t['blocked_by']:
        w(f"**Blocked by.** {t['blocked_by']}")
        w('')
    w('**Steps.**')
    w('')
    for i, s in enumerate(t['steps'], 1):
        w(f'{i}. {s}')
    w('')
    if t['files']:
        w('**Files.** ' + ', '.join(f'`{f}`' for f in t['files']))
        w('')
    if t.get('security_considerations'):
        w(f"**Security.** {t['security_considerations']}")
        w('')
    if t.get('completion_evidence'):
        w(f"**Completed.** {t['completion_evidence']}")
        w('')
    w('---')
    w('')

open(OUT, 'w').write('\n'.join(L) + '\n')
print(f'wrote {OUT}')
print(f'  {len(TASKS)} tasks ({len(done_tasks)} done, {len(open_tasks)} open)')
print(f'  {len(open_f)} open findings ({len(actionable)} actionable, {len(blocked)} blocked)')
