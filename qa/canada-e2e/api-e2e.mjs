#!/usr/bin/env node
/**
 * VisaAI Canada (visaai.ca) guest API end-to-end check.
 *
 * For each of the 8 Canadian visa types: anonymous Supabase sign-in -> create a
 * CA application -> list + select the visa type -> intake chat over socket.io
 * (/intake namespace) -> checklist (GET + POST rebuild) -> gated post-intake
 * endpoints (documents / forms / document-templates must refuse a guest) ->
 * public pricing quote. Plus global scope checks (non-CA rejected, /countries
 * CA-only, unauthenticated + cross-tenant access refused).
 *
 * Usage:
 *   node qa/canada-e2e/api-e2e.mjs                 # all 8 types
 *   ONLY=ca-study-permit node qa/canada-e2e/api-e2e.mjs
 *   REUSE_SESSION=1 ...   # one anonymous session for every type (saves the
 *                         # Supabase anonymous-signup rate limit on reruns)
 *   SKIP_GLOBAL=1 ...     # skip the scope/tenancy checks (2 fewer sign-ups)
 * NOTE: Supabase allows ~30 anonymous sign-ups per hour per IP. A full run uses
 * 10; the browser spec uses 10 more. A 429 on step 1 is that limit, not the app.
 * Env: API_URL (default https://api.visaai.ca), SUPABASE_URL, SUPABASE_ANON_KEY
 * (read from ~/.visaai-ca-secrets.env when not set). The key is never printed.
 * Output: qa/canada-e2e/evidence/api-results.json (+ console table).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const require = createRequire(join(REPO, 'apps', 'web', 'package.json'))
const { io } = require('socket.io-client')

function loadSecrets() {
  try {
    const txt = readFileSync(join(homedir(), '.visaai-ca-secrets.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch { /* optional */ }
}
loadSecrets()

const API = (process.env.API_URL ?? 'https://api.visaai.ca').replace(/\/$/, '')
const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'https://hxudeduwshfdhrujrqvk.supabase.co').replace(/\/$/, '')
const ANON = process.env.SUPABASE_ANON_KEY
if (!ANON) { console.error('SUPABASE_ANON_KEY missing'); process.exit(2) }

const TYPES = [
  { id: 'ca-visitor-visa-temporary-resident-visa', pricing: 'visitor',
    msg: 'Hi, I am a citizen of India and I want to visit my cousin in Toronto for three weeks next summer.' },
  { id: 'ca-super-visa', pricing: 'visitor',
    msg: 'Hello, I am a Pakistani citizen. My daughter is a Canadian citizen in Calgary and I want to stay with her for a long visit.' },
  { id: 'ca-business-visitors', pricing: 'visitor',
    msg: 'I am a Nigerian citizen and I need to attend a five-day business conference in Vancouver.' },
  { id: 'ca-study-permit', pricing: 'student',
    msg: 'I am from India and I have a letter of acceptance from the University of Toronto for a two-year master’s program.' },
  { id: 'ca-work-permit', pricing: 'work_permit',
    msg: 'I am a citizen of the Philippines and I have a job offer from a Canadian employer in Ontario with an approved LMIA.' },
  { id: 'ca-electronic-travel-authorization-eta', pricing: 'eta',
    msg: 'I am a British citizen with a UK passport and I am flying to Montreal for a one-week holiday.' },
  { id: 'ca-express-entry', pricing: 'express_entry',
    msg: 'I am a software engineer from India with four years of experience and IELTS 8.0, and I want Canadian permanent residence.' },
  { id: 'ca-sponsor-your-spouse-partner-or-child', pricing: 'family_sponsorship',
    msg: 'I am a Canadian citizen living in Ottawa and I want to sponsor my wife, who lives in Pakistan.' },
]

const CANADA_RE = /\bIMM\s?\d|IRCC|Canad|\bCIC\b|Express Entry|\bDLI\b|designated learning|\bPAL\b|\bLMIA\b|biometric|panel physician|super visa|eTA\b|CRS\b|ECA\b|sponsor/i
const FOREIGN_RE = /Schengen|USCIS|DS-160|\bI-130\b|Home Office|UKVI|Australian|Department of Home Affairs|ESTA\b|\bBRP\b|Bundesamt|VFS Global Schengen/i

const results = { startedAt: new Date().toISOString(), api: API, global: [], types: {}, createdApplicationIds: [], anonymousUserIds: [] }
const short = (v, n = 220) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s == null ? '' : s.length > n ? s.slice(0, n) + '…' : s
}

async function http(method, path, { token, body, headers = {}, base = API } = {}) {
  const t0 = Date.now()
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, ms: Date.now() - t0 }
}

function record(bucket, step, pass, status, detail) {
  const row = { step, pass: pass ? 'PASS' : 'FAIL', status, detail: short(detail, 300) }
  bucket.push(row)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step.padEnd(34)} ${String(status).padEnd(5)} ${short(detail, 160)}`)
  return pass
}

async function anonSignIn() {
  const r = await http('POST', '/auth/v1/signup', { base: SUPABASE_URL, body: {}, headers: { apikey: ANON } })
  const token = r.json?.access_token
  const uid = r.json?.user?.id
  if (uid) results.anonymousUserIds.push(uid)
  return { r, token, uid, isAnon: r.json?.user?.is_anonymous }
}

async function createCa(token) {
  const r = await http('POST', '/intake/applications', { token, body: { country: 'CA' } })
  if (r.json?.applicationId) results.createdApplicationIds.push(r.json.applicationId)
  return r
}

/** One intake turn over socket.io, the same protocol the browser uses. */
function intakeTurn(token, applicationId, text, timeoutMs = 150_000) {
  return new Promise((resolve) => {
    const out = { connected: false, history: null, received: false, reply: null, error: null, tokens: 0 }
    const socket = io(`${API}/intake`, { transports: ['polling', 'websocket'], auth: { token }, reconnection: false })
    const clientMsgId = randomUUID()
    const done = (extra = {}) => { clearTimeout(timer); socket.removeAllListeners(); socket.disconnect(); resolve({ ...out, ...extra }) }
    const timer = setTimeout(() => done({ error: out.error ?? `timeout after ${timeoutMs}ms` }), timeoutMs)
    socket.on('connect_error', (e) => done({ error: `connect_error: ${e.message}` }))
    socket.on('connect', () => { out.connected = true; socket.emit('intake:start', { applicationId }) })
    socket.on('intake:history', (h) => {
      if (out.history) return
      out.history = h
      socket.emit('intake:message', { applicationId, text, clientMsgId })
    })
    socket.on('intake:received', (m) => { if (m?.clientMsgId === clientMsgId) out.received = true })
    socket.on('intake:token', () => { out.tokens++ })
    socket.on('intake:message', (m) => {
      if (m?.role === 'assistant' && (!m.clientMsgId || m.clientMsgId === clientMsgId)) {
        out.reply = m
        done()
      }
    })
    socket.on('intake:error', (e) => {
      if (!e?.clientMsgId || e.clientMsgId === clientMsgId) { out.error = e; done() }
    })
  })
}

async function globalChecks() {
  const g = results.global
  console.log('\n== Global / scope checks ==')
  let r = await http('GET', '/health')
  record(g, 'GET /health', r.status === 200, r.status, r.text)

  r = await http('GET', '/countries')
  const codes = (r.json?.countries ?? []).map((c) => c.code)
  record(g, 'GET /countries == [CA]', r.status === 200 && codes.length === 1 && codes[0] === 'CA', r.status, codes)

  r = await http('GET', '/pricing/countries')
  const pc = Array.isArray(r.json) ? r.json.map((c) => c.country_code) : []
  record(g, 'GET /pricing/countries CA-only', r.status === 200 && pc.length > 0 && pc.every((c) => c === 'CA'), r.status, pc)

  r = await http('GET', '/pricing/quotes')
  const qc = Array.isArray(r.json) ? [...new Set(r.json.map((q) => q.country_code))] : []
  const qt = Array.isArray(r.json) ? r.json.map((q) => q.visa_type) : []
  record(g, 'GET /pricing/quotes CA-only', r.status === 200 && qc.length === 1 && qc[0] === 'CA', r.status, { countries: qc, visaTypes: qt })
  // Canada has no digital-nomad visa / no citizenship route on this site.
  const nonCa = qt.filter((t) => ['digital_nomad', 'citizenship'].includes(t))
  record(g, 'quotes: no non-Canadian products', nonCa.length === 0, r.status, nonCa.length ? `listed: ${nonCa.join(', ')}` : 'ok')

  r = await http('GET', '/pricing/quote?visaType=visitor&country=US')
  record(g, 'GET /pricing/quote US -> 4xx', r.status >= 400 && r.status < 500, r.status, r.json?.message ?? r.text)

  r = await http('POST', '/intake/applications', { body: { country: 'CA' } })
  record(g, 'create app without token -> 401', r.status === 401, r.status, r.json?.message ?? r.text)

  const a = await anonSignIn()
  record(g, 'anonymous sign-in (A)', a.r.status === 200 && !!a.token && a.isAnon === true, a.r.status, { uid: a.uid, is_anonymous: a.isAnon })
  if (!a.token) return
  for (const country of ['US', 'GB', 'FR', 'AU', 'SCHENGEN', 'ZZ']) {
    r = await http('POST', '/intake/applications', { token: a.token, body: { country } })
    if (r.json?.applicationId) results.createdApplicationIds.push(r.json.applicationId)
    record(g, `create app country=${country} -> 4xx`, r.status >= 400 && r.status < 500, r.status, r.json?.message ?? r.text)
  }
  r = await http('POST', '/intake/applications', { token: a.token, body: {} })
  if (r.json?.applicationId) results.createdApplicationIds.push(r.json.applicationId)
  record(g, 'create app no country -> 400', r.status === 400, r.status, r.json?.message ?? r.text)
  r = await http('POST', '/intake/applications', { token: a.token, body: { frameworkId: 'us-h1b' } })
  if (r.json?.applicationId) results.createdApplicationIds.push(r.json.applicationId)
  record(g, 'create app frameworkId only -> 400', r.status === 400, r.status, r.json?.message ?? r.text)
  r = await http('POST', '/intake/applications', { token: a.token, body: { country: 'ca' } })
  if (r.json?.applicationId) results.createdApplicationIds.push(r.json.applicationId)
  record(g, 'create app country=ca (lower) -> 201', r.status === 201 && !!r.json?.applicationId, r.status, r.json)
  const appA = r.json?.applicationId

  // Cross-tenant: guest B must not read guest A's application.
  const b = await anonSignIn()
  record(g, 'anonymous sign-in (B)', !!b.token, b.r.status, { uid: b.uid })
  if (b.token && appA) {
    r = await http('GET', `/intake/applications/${appA}`, { token: b.token })
    record(g, 'B reads A application -> 403', r.status === 403, r.status, r.json?.message ?? r.text)
    r = await http('GET', `/intake/applications/${appA}/checklist`, { token: b.token })
    record(g, 'B reads A checklist -> 403', r.status === 403, r.status, r.json?.message ?? r.text)
    r = await http('GET', `/intake/applications/${appA}/messages`, { token: b.token })
    record(g, 'B reads A messages -> 403/empty', r.status === 403 || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0), r.status, r.text)
    r = await http('PATCH', `/intake/applications/${appA}/visa-type`, { token: b.token, body: { visaTypeId: null } })
    record(g, 'B sets A visa-type -> 403', r.status === 403, r.status, r.json?.message ?? r.text)
  }
  // Guests must be refused by gated (non-intake) controllers.
  for (const p of ['/admin/users', '/consultant/queue', '/applications']) {
    r = await http('GET', p, { token: a.token })
    record(g, `guest GET ${p} -> 401/403/404`, [401, 403, 404].includes(r.status), r.status, r.json?.message ?? r.text)
  }
  r = await http('GET', '/me', { token: a.token })
  record(g, 'guest GET /me (anonymous)', r.status === 200, r.status, r.json)
  r = await http('GET', '/feature-flags', { token: a.token })
  record(g, 'guest GET /feature-flags', r.status === 200, r.status, r.text)
  r = await http('GET', '/marketplace/consultants', { token: a.token })
  const mc = Array.isArray(r.json) ? r.json : r.json?.items ?? r.json?.consultants ?? r.json?.data
  record(g, 'guest GET /marketplace/consultants', r.status === 200, r.status, Array.isArray(mc) ? `${mc.length} consultants` : r.text)
  results.sharedSession = a
}

async function runType(t, shared) {
  const steps = []
  results.types[t.id] = steps
  const meta = (results.typeMeta ??= {})[t.id] = {}
  console.log(`\n== ${t.id} ==`)
  let token = shared?.token
  if (!token) {
    const s = await anonSignIn()
    if (!record(steps, '1 anonymous sign-in', s.r.status === 200 && !!s.token && s.isAnon === true, s.r.status, { uid: s.uid, is_anonymous: s.isAnon })) return
    token = s.token
  } else {
    record(steps, '1 anonymous sign-in (reused)', true, 200, 'REUSE_SESSION')
  }

  let r = await createCa(token)
  if (!record(steps, '2 create CA application', r.status === 201 && !!r.json?.applicationId, r.status, r.json)) return
  const appId = r.json.applicationId
  meta.applicationId = appId

  r = await http('GET', `/intake/applications/${appId}`, { token })
  record(steps, '3 GET application (CA)', r.status === 200 && r.json?.destination_country === 'CA', r.status,
    { destination_country: r.json?.destination_country, visa_type_id: r.json?.visa_type_id })

  r = await http('GET', `/intake/applications/${appId}/visa-types`, { token })
  const list = Array.isArray(r.json) ? r.json : []
  const ids = list.map((v) => v.visaaiId)
  const allCa = ids.every((i) => i?.startsWith('ca-'))
  const missing = TYPES.map((x) => x.id).filter((x) => !ids.includes(x))
  record(steps, '4 list visa types (8 CA)', r.status === 200 && allCa && missing.length === 0, r.status,
    { count: list.length, missing, nonCa: ids.filter((i) => !i?.startsWith('ca-')) })
  const vt = list.find((v) => v.visaaiId === t.id)
  if (!record(steps, '4b type present w/ requirements', !!vt && vt.requirementCount > 0, r.status,
    vt ? { name: vt.name, requirementCount: vt.requirementCount, dataQuality: vt.dataQuality, eligibility: vt.eligibility?.status } : 'NOT LISTED')) return

  r = await http('PATCH', `/intake/applications/${appId}/visa-type`, { token, body: { visaTypeId: vt.id } })
  record(steps, '5 select visa type', r.status === 200 && r.json?.visaTypeId === vt.id, r.status, r.json)
  r = await http('GET', `/intake/applications/${appId}`, { token })
  record(steps, '5b visa_type_id persisted', r.status === 200 && r.json?.visa_type_id === vt.id, r.status, { visa_type_id: r.json?.visa_type_id })

  const turn = await intakeTurn(token, appId, t.msg)
  const reply = turn.reply?.content ?? ''
  const replyOk = turn.connected && turn.received && !turn.error && reply.trim().length > 20 &&
    !/unavailable|try again later|configuration issue|do not have access/i.test(reply)
  record(steps, '6 intake chat turn', replyOk, turn.error ? 'ERR' : 'WS',
    turn.error ? turn.error : { received: turn.received, tokens: turn.tokens, isComplete: turn.reply?.isComplete, guardrail: turn.reply?.guardrail, reply })
  meta.reply = reply
  meta.historyAtStart = turn.history?.messages?.length ?? null
  if (turn.history?.messages?.[0]) meta.openingQuestion = short(turn.history.messages[0].content, 300)
  record(steps, '6b reply not foreign-program', !FOREIGN_RE.test(reply), 'WS', FOREIGN_RE.test(reply) ? reply.match(FOREIGN_RE)[0] : 'ok')

  r = await http('GET', `/intake/applications/${appId}/messages`, { token })
  const msgs = Array.isArray(r.json) ? r.json : []
  record(steps, '7 transcript persisted', r.status === 200 && msgs.some((m) => m.role === 'user') && msgs.some((m) => m.role === 'assistant'), r.status,
    { count: msgs.length, roles: msgs.map((m) => m.role) })

  r = await http('GET', `/intake/applications/${appId}/checklist`, { token })
  record(steps, '8 GET checklist (stored)', r.status === 200 && Array.isArray(r.json), r.status, { count: Array.isArray(r.json) ? r.json.length : null })

  r = await http('POST', `/intake/applications/${appId}/checklist/rebuild`, { token })
  const items = Array.isArray(r.json) ? r.json : []
  const blob = items.map((i) => `${i.label} ${JSON.stringify(i.meta ?? {})}`).join('\n')
  const caHits = items.filter((i) => CANADA_RE.test(`${i.label} ${JSON.stringify(i.meta ?? {})}`)).length
  const foreign = blob.match(FOREIGN_RE)
  record(steps, '9 rebuild checklist non-empty', r.status === 200 && items.length > 0, r.status,
    { count: items.length, required: items.filter((i) => i.required).length, labels: items.slice(0, 6).map((i) => i.label) })
  record(steps, '9b checklist Canada-specific', caHits > 0 && !foreign, r.status, { canadaSpecificItems: caHits, foreignHit: foreign?.[0] ?? null })
  meta.checklistLabels = items.map((i) => i.label)

  // Post-intake surfaces: by design (JwtGuard fail-closed) guests are refused.
  for (const [name, path] of [
    ['10 forms (guest gated)', `/forms/${appId}`],
    ['10b document-templates (guest gated)', `/document-templates/${appId}`],
    ['10c documents (guest gated)', `/documents/${appId}`],
  ]) {
    r = await http('GET', path, { token })
    record(steps, name, r.status === 401 || r.status === 403, r.status, r.json?.message ?? r.text)
  }

  r = await http('GET', `/pricing/quote?visaType=${t.pricing}&country=CA`)
  record(steps, `11 pricing quote (${t.pricing})`, r.status === 200 && typeof r.json?.price === 'number' && r.json?.country_code === 'CA', r.status, r.json)
}

async function main() {
  if (!process.env.SKIP_GLOBAL) await globalChecks()
  const shared = process.env.REUSE_SESSION ? results.sharedSession : null
  for (const t of TYPES) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(t.id)) continue
    try { await runType(t, shared) } catch (err) {
      record(results.types[t.id] ?? (results.types[t.id] = []), 'EXCEPTION', false, 'EXC', err?.stack ?? String(err))
    }
  }
  delete results.sharedSession
  results.finishedAt = new Date().toISOString()
  mkdirSync(join(HERE, 'evidence'), { recursive: true })
  writeFileSync(join(HERE, 'evidence', 'api-results.json'), JSON.stringify(results, null, 2))

  console.log('\n== Summary ==')
  const all = [...results.global, ...Object.values(results.types).flat()]
  const fails = all.filter((s) => s.pass === 'FAIL')
  console.log(`${all.length - fails.length}/${all.length} steps passed`)
  for (const [id, steps] of Object.entries(results.types)) {
    console.log(`${id.padEnd(44)} ${steps.filter((s) => s.pass === 'PASS').length}/${steps.length}  app=${results.typeMeta?.[id]?.applicationId ?? '-'}`)
  }
  console.log('Created application ids:', results.createdApplicationIds.join(' '))
  process.exit(fails.length ? 1 : 0)
}
main()
