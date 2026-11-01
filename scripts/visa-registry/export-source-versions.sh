#!/usr/bin/env bash
#
# Regenerate supabase/migrations/20260820170000_visa_source_versions_bootstrap.sql
# from production's real fetch records.
#
# The requirement migrations bind to an ACTIVE source version, and nothing in
# the chain creates one — versions come from the sync job. This exports the
# active versions that production actually fetched so an empty database can
# replay the chain without anyone inventing a content hash.
#
# Read-only against production. It selects; it never writes.
#
# Re-run it when the registry gains sources that a fresh database should start
# with — not on every sync. A stale bootstrap is harmless: the guard skips any
# source that already has a version, and the sync supersedes what it plants.
#
# Usage: scripts/visa-registry/export-source-versions.sh [output-file]

set -euo pipefail

OUT="${1:-supabase/migrations/20260820170000_visa_source_versions_bootstrap.sql}"
VPS="${VISAAI_VPS:-root@2.24.196.5}"
KEY="${VISAAI_VPS_KEY:-$HOME/.ssh/visaai_vps}"

# -U supabase_admin, not postgres: the registry tables are owned by
# supabase_admin and postgres cannot read them under RLS.
remote_psql() {
  ssh -i "$KEY" -o ConnectTimeout=15 "$VPS" \
    "docker exec -i selfhosted_db psql -U supabase_admin -d postgres -tA -f -"
}

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

remote_psql > "$body" <<'SQL'
select format(
$f$insert into public.visa_source_versions (
  source_id, version_number, raw_sha256, normalized_sha256,
  http_status, content_type, byte_size, published_at, effective_from,
  extractor_version, fetched_at, is_active)
select s.id, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, true
  from public.visa_sources s
 where s.source_url = %L
   and coalesce(s.visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
     = coalesce((select id from public.visa_types where visaai_id = %L),
                '00000000-0000-0000-0000-000000000000'::uuid)
   and not exists (select 1 from public.visa_source_versions v
                    where v.source_id = s.id);$f$,
  v.version_number, v.raw_sha256, v.normalized_sha256, v.http_status,
  v.content_type, v.byte_size, v.published_at, v.effective_from,
  v.extractor_version, v.fetched_at, s.source_url, t.visaai_id)
from public.visa_source_versions v
join public.visa_sources s on s.id = v.source_id
left join public.visa_types t on t.id = s.visa_type_id
where v.is_active
order by s.source_url, t.visaai_id nulls first;
SQL

count="$(grep -c 'insert into public.visa_source_versions' "$body" || true)"
if [ "$count" -eq 0 ]; then
  echo "export produced no statements — refusing to overwrite $OUT" >&2
  exit 1
fi

echo "exported $count active source versions" >&2
echo "now splice \"$body\" between the header and the trailing do-block of $OUT" >&2
echo "(the header carries the provenance note and must be updated with today's date)" >&2
