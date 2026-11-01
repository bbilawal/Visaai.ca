// Load Canada reference data (*.jsonl from export-reference-data.sh) into the
// visaai.ca Supabase project through PostgREST with the service-role key.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node load-reference-data.mjs <dir>
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!dir || !url || !key) throw new Error('usage: SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY node load-reference-data.mjs <dir>')

const ORDER = ['roles','permissions','role_permissions','feature_flags','notification_templates','pricing_constants','pricing_visa_tiers','pricing_country_factors','risk_weights','escalation_thresholds','country_frameworks','form_templates','form_template_versions','document_templates','template_revisions','visa_countries','visa_types','kb_blobs','visa_sources','visa_source_versions','visa_requirements','kb_freshness_policies','kb_extractions','kb_sections','kb_chunk_texts','kb_chunks','kb_embeddings','kb_chunk_scopes']
const GENERATED = { kb_chunk_texts: ['tsv'] }
const SELF_REF = { visa_source_versions: 'superseded_by', kb_chunks: 'superseded_by' }
const CONFLICT = { kb_blobs: 'sha256', kb_chunk_texts: 'sha256', kb_embeddings: 'text_sha256,model', feature_flags: 'key' }

async function post(table, rows) {
  const q = CONFLICT[table] ? `?on_conflict=${CONFLICT[table]}` : ''
  const res = await fetch(`${url}/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 500)}`)
}

for (const table of ORDER) {
  const file = path.join(dir, `${table}.jsonl`)
  if (!fs.existsSync(file)) continue
  let rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  for (const g of GENERATED[table] ?? []) rows.forEach((r) => delete r[g])
  const self = SELF_REF[table]
  const deferred = []
  if (self) rows.forEach((r) => { if (r[self]) { deferred.push({ id: r.id, v: r[self] }); r[self] = null } })
  const batch = table === 'kb_embeddings' ? 40 : table.startsWith('kb_') ? 200 : 500
  for (let i = 0; i < rows.length; i += batch) await post(table, rows.slice(i, i + batch))
  for (const d of deferred) {
    const res = await fetch(`${url}/rest/v1/${table}?id=eq.${d.id}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ [self]: d.v }),
    })
    if (!res.ok) throw new Error(`${table} patch: ${res.status} ${await res.text()}`)
  }
  console.log(`${table.padEnd(28)} ${String(rows.length).padStart(6)} rows${deferred.length ? `, ${deferred.length} self-refs` : ''}`)
}
