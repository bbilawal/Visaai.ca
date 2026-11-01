#!/usr/bin/env bash
#
# Classify a candidate authority host: does it refuse our bot, or refuse our IP?
#
# WHY
#
# probe-authority.ts runs from wherever you run it, and a single result cannot
# tell those apart. On 2026-08-24 that mattered twice in one batch:
# france-visas.gouv.fr returns 403 from everywhere (its policy, permanent) while
# Portugal's vistos.mne.gov.pt resets the TLS handshake from the VPS in 0.22s and
# answers 200 from anywhere else (our IP, fixable). Recorded as the same verdict,
# the second becomes a permanent exception against a country that is actually
# fine — an infrastructure fault filed as a decision about the world.
#
# Requests come from both paths with the SAME identified user-agent. This never
# tries to look like a browser: the point is to learn which party is refusing us,
# not to get past either.
#
# Usage:  ./scripts/classify-egress.sh host [host...]
set -uo pipefail

UA='VisaAIBot/1.0 (+https://visaai.co/bot)'
VPS="${VPS:-root@2.24.196.5}"
KEY="${VPS_KEY:-$HOME/.ssh/visaai_vps}"

printf '%-42s %-8s %-8s %s\n' HOST LOCAL VPS CLASS
for h in "$@"; do
  # curl already prints 000 when the connection never completes, so a `|| echo
  # 000` fallback appends a SECOND value and yields "000000" — which then fails
  # every numeric comparison and silently lands in the catch-all class.
  loc=$(curl -sS -o /dev/null -w '%{http_code}' -m 20 -A "$UA" "https://$h/robots.txt" 2>/dev/null)
  vps=$(ssh -i "$KEY" -o StrictHostKeyChecking=no "$VPS" \
        "curl -sS -o /dev/null -w '%{http_code}' -m 20 -A '$UA' 'https://$h/robots.txt' 2>/dev/null")
  loc=${loc:-000}; vps=${vps:-000}

  # 404 is NOT a refusal. probe-authority.ts has always known this — "a 404 is
  # different: conventionally no restrictions (Germany/BAMF)" — and the first
  # version of this script threw that away by testing `>= 400`, which filed
  # nyidanmark.dk as permanently refusing us when it simply publishes no
  # robots.txt. Same mistake as bucketing client-rendered pages with parse
  # errors: one bucket for two facts hides both.
  refusal() { case "$1" in 401|403|407|429|451) return 0;; *) return 1;; esac; }
  absent()  { [ "$1" = "404" ] || [ "$1" = "410" ]; }

  if   [ "$loc" = "$vps" ] && [ "$loc" = "000" ]; then class="no connection from either path — check the hostname before concluding"
  elif [ "$loc" = "$vps" ] && absent "$loc";       then class="no robots.txt — conventionally unrestricted; probe the content"
  elif [ "$loc" = "$vps" ] && refusal "$loc";      then class="(a) AUTHORITY REFUSES OUR BOT — permanent"
  elif [ "$loc" = "$vps" ] && [ "$loc" -ge 400 ] 2>/dev/null; then class="odd status $loc from both — investigate, do not assume refusal"
  elif [ "$loc" = "$vps" ];                        then class="readable — probe the content next"
  elif [ "$vps" = "000" ] || refusal "$vps";       then class="(b) OUR EGRESS IS DROPPED — BL-3, fixable"
  else class="differs ($loc vs $vps) — look closer"
  fi
  printf '%-42s %-8s %-8s %s\n' "$h" "$loc" "$vps" "$class"
done

cat <<'NOTE'

  (a) is theirs and permanent: the spec forbids working around bot protection.
  (b) is ours: the authority serves us fine from another network.
  Filing (b) as (a) records an infrastructure fault as a decision about a country.
NOTE
