# Next Session Prompt

Self-contained resume instruction for the VisaAI master execution program.
Read this **and** `MASTER_EXECUTION_STATE.json` before touching anything.

---

## What this program is

Executing `../VisaAI_Claude_Master_Execution_Spec.md` — 89 numbered sections, a
68-item Definition of Done in §84 — against the VisaAI monorepo. It is a
long-running, restart-safe program, not a single task.

## Resume in four steps

```bash
cd /Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI
./scripts/resume-visaai-master-execution.sh          # validates state, exits 1 if it cannot be trusted
node scripts/execution/generate-master-state.mjs --docker supabase_db_VisaAI
node scripts/execution/generate-current-state-audit.mjs
```

Then read, in this order:

1. `docs/execution/MASTER_EXECUTION_STATE.json` — measured half first, asserted half second
2. `docs/execution/CURRENT_STATE_AUDIT.md` — every spec section and its status
3. `docs/exec/EXECUTION_STATUS.md` — the §84 checklist, row by row, with evidence
4. `docs/engineering/BUG_LOG.md` — currently through B-26

## Where the work stands

**Seventeen destinations are live in production** — Türkiye, Egypt, Lebanon and
China were admitted on 2026-08-26, bringing 16 routes and 303 verbatim
requirements. Every published requirement carries an official-source excerpt and
a source version.

**Every in-scope country is now covered.** Scope is 37 (`data/country-scope.json`):
19 researched, 18 assessed with evidence, and **0 that nobody has examined**. The
18 are recorded in `data/country-probe-evidence.json` under seven distinct
conclusions — an IP-level block (BL-3), a client-rendered page, an unresolvable
robots.txt redirect loop and an outright refusal are four different facts, and
collapsing them into "blocked" is what this file exists to prevent.

**Finland is live locally and ABSENT from production.** migri.fi challenges the
VPS, so its requirements have no source version there. Its extraction files
already exist and are already verified: when the egress is fixed, a sync from
the VPS promotes Finland with no new research. Tracked as `FI-PROD`.

The ordered backlog is `asserted.ordered_backlog` in the state file. Take the
highest-ranked entry whose `actionable_now` is true. Today that is **DOD-65** —
now a DEPTH problem rather than a breadth one: Lebanon's index enumerates about
a dozen further readable routes, China's enumerates two more, and Türkiye
enumerates subtypes its own pages do not describe.

## Five things that will bite you

These are not style preferences. Each one is a defect this program already
shipped, or nearly shipped.

**A verbatim excerpt can still be the wrong sentence, and every check will pass
(B-33).** Four Lebanese requirements shipped to production quoting section
headings — `regarding (6):`, `important notes:` — that sit one line from the
document each claimed to quote. `verify-excerpts.ts`, `verify-quotes-against-raw.ts`
and the promotion migration's provenance assertion all returned green, because
all three ask "is this text on the page" and the answer was yes. Run
`scripts/check-excerpt-shape.ts` over every new extraction: it asks whether the
excerpt is SHAPED like a requirement and rejects headings, bare amounts, column
labels and twins. And when taking excerpts by line offset out of a dump, NUMBER
THE DUMP FIRST — the offsets were exact, and they were chosen by eye against an
unnumbered file.

**A check built from the same assumption as the thing it checks will confirm
it.** `verify-excerpts.ts` normalizes the fetched page with the same function
that produced the excerpt, so it agreed with `fianc&eacute;` for as long as that
entity was missing from the decoder (B-26). The ISO round-trip check agreed that
`DY` was Benin, because it is — it is also a code that no longer exists (B-25).
When you verify something, ask a *different* question of the same data. And hold
the new check to the same standard: the raw-quote probe's own first two runs
were wrong.

**Probe from the host that will do the syncing.** Finland passed every
reachability criterion from a laptop and failed from the VPS, because migri.fi
challenges that egress IP. A local fetch is not evidence about production.

**Never mark an item complete before its acceptance evidence exists**, and state
denominators rather than bare pass counts. "0 failures" over an unstated subset
is how 22 unchecked quotations become a clean corpus.

**Deploying web has two known hazards**, both recorded in
`docs/operations/VISA_REGISTRY_PRODUCTION_CUTOVER.md`: restarting pm2 while
`next build` is still rewriting `.next` crash-loops the app on a missing
`prerender-manifest.json`, and `nest build` can exit 0 having written a partial
`dist/` from a stale tsbuildinfo. Wait for the manifest; `rm -rf dist *.tsbuildinfo`
before an API build.

## What is blocked, and by what

| ID | Blocker | Needs |
|---|---|---|
| BL-1 | No funded OpenAI key | A funded key — until then model tiers are reasoned, not measured |
| BL-2 | No Search Console ownership | Claim the property |
| BL-3 | migri.fi and immi.homeaffairs.gov.au refuse our egress | Allowlist the VPS IP, or an egress path their WAF does not challenge |
| BL-4 | No staging environment | Provision one |
| BL-6 | 11 legal items need counsel | Legal review |

None of these is fixable in-repo. Do not spend a session trying.

## What NOT to do

- **Do not rerun the program from the top.** §0.2: resume from the first
  non-complete item unless evidence shows prior work is invalid.
- **Do not trust a stale state file.** The resume script tells you whether it is
  current; if it says stale, regenerate before acting.
- **Do not invent government data.** A requirement without an official-source
  excerpt does not ship. This is the whole product.
