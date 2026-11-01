#!/usr/bin/env bash
#
# Resume entry point for the VisaAI master execution program (spec §0.2).
#
# WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
#
# The spec is blunt about the limit: a model cannot relaunch a terminated
# operating-system process by willpower. This script does not restart anything,
# recover a closed terminal, renew a credential or bring up infrastructure. A
# human runs it.
#
# What it does is the part that CAN be automated and is easy to get wrong by
# hand: prove the durable state is real and current before anyone acts on it.
# A resume that trusts a stale state file is worse than no resume at all,
# because it starts confident work from a false position.
#
# Every check below therefore reports rather than repairs, and the script exits
# non-zero when the state cannot be trusted.
#
# Usage:  ./scripts/resume-visaai-master-execution.sh [--regenerate]
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
REPO="$(pwd)"

STATE="docs/execution/MASTER_EXECUTION_STATE.json"
LEDGER="docs/execution/EXECUTION_LEDGER.md"
PROMPT="docs/execution/NEXT_SESSION_PROMPT.md"
AUDIT="docs/execution/CURRENT_STATE_AUDIT.md"
SPEC="../VisaAI_Claude_Master_Execution_Spec.md"

problems=0
note()  { printf '  %s\n' "$1"; }
ok()    { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
warn()  { printf '  \033[33mWARN\033[0m  %s\n' "$1"; problems=$((problems+1)); }
fail()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; problems=$((problems+1)); }

echo
echo "VisaAI master execution — resume check"
echo "Repository: $REPO"
echo

echo "Required state files"
for f in "$STATE" "$LEDGER" "$PROMPT" "$AUDIT"; do
  if [ -f "$f" ]; then ok "$f"; else fail "$f is MISSING — spec §0.1 requires it"; fi
done
echo

if [ ! -f "$STATE" ]; then
  echo "Cannot validate further without $STATE."
  echo "Generate it:  node scripts/execution/generate-master-state.mjs --docker supabase_db_VisaAI"
  exit 1
fi

if ! python3 -c "import json,sys; json.load(open('$STATE'))" 2>/dev/null; then
  fail "$STATE is not valid JSON. Do not act on it."
  exit 1
fi
ok "$STATE parses"
echo

# --- Is the state current? -------------------------------------------------
# The single most useful question, and the one nobody remembers to ask by hand.
echo "Is the state current?"
STATE_COMMIT=$(python3 -c "
import json;d=json.load(open('$STATE'))
g=d.get('measured',{}).get('git',{}).get('commit',{})
print(g.get('value','') if g.get('ok') else '')" 2>/dev/null)
HEAD_COMMIT=$(git rev-parse HEAD 2>/dev/null)
GENERATED=$(python3 -c "import json;print(json.load(open('$STATE')).get('generated_at',''))" 2>/dev/null)

note "generated at   $GENERATED"
note "state commit   ${STATE_COMMIT:-<none recorded>}"
note "HEAD commit    ${HEAD_COMMIT:-<not a git repo>}"

if [ -z "$STATE_COMMIT" ]; then
  warn "State records no commit. Treat every claim in it as unverified."
elif [ "$STATE_COMMIT" = "$HEAD_COMMIT" ]; then
  ok "State was generated at the current HEAD."
else
  BEHIND=$(git rev-list --count "$STATE_COMMIT..HEAD" 2>/dev/null || echo "?")
  warn "State is STALE — $BEHIND commit(s) landed since it was generated."
  note "Its counts, test results and backlog may all predate work already done."
  note "Regenerate before acting:  node scripts/execution/generate-master-state.mjs --docker supabase_db_VisaAI"
fi
echo

# --- Spec drift ------------------------------------------------------------
# If the specification itself changed, a backlog derived from the old one is
# answering a question nobody is asking any more.
echo "Specification"
if [ -f "$SPEC" ]; then
  RECORDED=$(python3 -c "
import json;d=json.load(open('$STATE')).get('specification',{})
print(d.get('value',{}).get('sha256','') if d.get('ok') else '')" 2>/dev/null)
  CURRENT=$(shasum -a 256 "$SPEC" | awk '{print $1}')
  if [ -z "$RECORDED" ]; then
    warn "State recorded no spec hash."
  elif [ "$RECORDED" = "$CURRENT" ]; then
    ok "Specification unchanged since the state was generated."
  else
    warn "SPECIFICATION HAS CHANGED since the state was generated."
    note "The backlog was derived from the previous revision. Re-reconcile before continuing."
  fi
else
  warn "Specification not found at $SPEC — cannot check for drift."
fi
echo

# --- Working tree ----------------------------------------------------------
echo "Working tree"
DIRTY=$(git status --porcelain 2>/dev/null | grep -v '^?? \.DS_Store' || true)
if [ -z "$DIRTY" ]; then
  ok "Clean."
else
  warn "Uncommitted changes present. Inspect them BEFORE resuming — they may be an"
  note "interrupted atomic slice, and continuing on top of one loses the evidence"
  note "of what it was doing."
  printf '%s\n' "$DIRTY" | sed 's/^/        /'
fi
UNPUSHED=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "?")
[ "$UNPUSHED" = "0" ] && ok "Nothing unpushed." || note "  $UNPUSHED commit(s) not pushed."
echo

# --- Measurement failures recorded in the state ----------------------------
echo "Measurements the state could not take"
python3 - "$STATE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
fails = []
def walk(o, p=""):
    if isinstance(o, dict):
        if o.get("ok") is False and o.get("error"):
            fails.append(f"{p}: {o['error']}")
        for k, v in o.items():
            walk(v, f"{p}.{k}" if p else k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            walk(v, f"{p}[{i}]")
walk(d.get("measured", {}))
walk(d.get("specification", {}))
tests = d.get("measured", {}).get("tests", {})
head = d.get("measured", {}).get("git", {}).get("commit", {}).get("value")
if tests.get("executed"):
    pass
elif tests.get("carried_forward"):
    at = tests.get("measured_at_commit")
    # Stale evidence and absent evidence are different problems with different
    # fixes, and collapsing them into one warning teaches people to ignore both.
    if at and head and at != head:
        fails.append(
            f"measured.tests: carried forward from {at[:8]}, which is not the current commit. "
            "Re-run with --run-tests before relying on it."
        )
    else:
        print("  \033[32mOK\033[0m    measured.tests: carried forward from the current commit.")
else:
    fails.append("measured.tests: never run — no pass claim is evidenced anywhere in this state")
if fails:
    for f in fails:
        print(f"  \033[33mWARN\033[0m  {f}")
else:
    print("  \033[32mOK\033[0m    Every measurement was taken.")
PY
echo

# --- The actual resume instruction -----------------------------------------
echo "════════════════════════════════════════════════════════════════════"
echo "Next session prompt — $PROMPT"
echo "════════════════════════════════════════════════════════════════════"
[ -f "$PROMPT" ] && cat "$PROMPT" || echo "(missing)"
echo

if [ "${1:-}" = "--regenerate" ]; then
  echo "Regenerating state…"
  node scripts/execution/generate-master-state.mjs --docker supabase_db_VisaAI
fi

echo
if [ "$problems" -eq 0 ]; then
  echo "State validated. Resume from the next action above."
else
  echo "$problems item(s) need attention before the state can be trusted."
  echo "This script cannot fix them: it reports, it does not repair. Nothing here"
  echo "restarts a machine, a terminal or a credential — that part is yours."
  exit 1
fi
