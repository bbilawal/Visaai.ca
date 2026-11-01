#!/usr/bin/env bash
# Export Canada-scoped reference data (no user PII) from the visaai.co database
# as COPY text files, for loading into the visaai.ca Supabase project.
# Run on the VPS: bash export-reference-data.sh <outdir>
set -euo pipefail
OUT=${1:-/root/visaai-ca-migrate/data}
mkdir -p "$OUT"
PSQL="docker exec -i selfhosted_db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At"
CA="(select id from visa_countries where code='CA')"
SRC="(select id from visa_sources where country_id=$CA)"
VER="(select id from visa_source_versions where source_id in $SRC)"
EXT="(select id from kb_extractions where source_version_id in $VER)"
CHK="(select id from kb_chunks where source_id in $SRC and (country_id is null or country_id=$CA))"

dump() { # name, select
  echo "select row_to_json(t) from ($2) t" | $PSQL > "$OUT/$1.jsonl"
  printf '%-32s %8s rows\n' "$1" "$(wc -l < "$OUT/$1.jsonl")"
}
# order = load order (parents first)
dump roles                 "select * from roles"
dump permissions           "select * from permissions"
dump role_permissions      "select * from role_permissions"
dump feature_flags         "select key,description,enabled,rollout_percentage,allowed_roles,allowed_cohorts,'{}'::uuid[] as allowed_user_ids,environments,null::uuid as updated_by,updated_at,created_at from feature_flags"
dump notification_templates "select id,event_type,locale,subject,title,body,variables,version,is_active,null::uuid as created_by,created_at from notification_templates"
dump pricing_constants     "select * from pricing_constants"
dump pricing_visa_tiers    "select * from pricing_visa_tiers"
dump pricing_country_factors "select * from pricing_country_factors where country_code='CA'"
dump risk_weights          "select * from risk_weights"
dump escalation_thresholds "select * from escalation_thresholds"
dump country_frameworks    "select * from country_frameworks where country_code='CA'"
dump form_templates        "select * from form_templates where country_code='CA'"
dump form_template_versions "select * from form_template_versions where form_template_id in (select id from form_templates where country_code='CA')"
dump document_templates    "select * from document_templates where country_code='CA'"
dump template_revisions    "select id,source,country_code,program,code,name,change_kind,previous_sha256,new_sha256,previous_version_label,new_version_label,previous_field_count,new_field_count,resolved_url,byte_size,storage_path,reviewed_at,null::uuid as reviewed_by,created_at from template_revisions where country_code='CA'"
dump visa_countries        "select * from visa_countries where code='CA'"
dump visa_types            "select * from visa_types where country_id=$CA"
dump kb_blobs              "select * from kb_blobs where sha256 in (select blob_sha256 from visa_source_versions where id in $VER)"
dump visa_sources          "select * from visa_sources where country_id=$CA"
dump visa_source_versions  "select * from visa_source_versions where source_id in $SRC"
dump visa_requirements     "select * from visa_requirements where visa_type_id in (select id from visa_types where country_id=$CA)"
dump kb_freshness_policies "select * from kb_freshness_policies where country_id is null or country_id=$CA"
dump kb_extractions        "select * from kb_extractions where source_version_id in $VER"
dump kb_sections           "select * from kb_sections where extraction_id in $EXT"
dump kb_chunk_texts        "select * from kb_chunk_texts where sha256 in (select text_sha256 from kb_chunks where id in $CHK)"
dump kb_chunks             "select * from kb_chunks where id in $CHK"
dump kb_embeddings         "select * from kb_embeddings where text_sha256 in (select text_sha256 from kb_chunks where id in $CHK)"
dump kb_chunk_scopes       "select * from kb_chunk_scopes where chunk_id in $CHK"
du -sh "$OUT"
