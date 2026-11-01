#!/usr/bin/env node
/**
 * Drive real intake conversations and record what the assistant actually says.
 *
 * WHY A SCRIPT AND NOT THE BROWSER
 *
 * The browser was tried first and is the wrong tool for this. One conversation
 * needs roughly fifteen dependable interactions, and the country combobox does
 * not reliably accept synthetic typing — three attempts left the field on its
 * placeholder. Eighty conversations that way produce eighty results nobody can
 * trust, and a mis-click reads exactly like a product bug. It did: a run was
 * reported as "selecting Japan creates a US application" before a deterministic
 * API check showed JP→JP, TR→TR, NO→NO, SG→SG all match.
 *
 * Here the destination is a field in a payload, so the same class of mistake
 * cannot happen.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not judge answers. It records the question asked, the answer sent and
 * the reply received, and flags only what can be checked mechanically — a
 * guardrail refusal, an empty reply, a socket error, a turn that timed out. The
 * expected_behaviour column in the matrix is for a human to score against.
 *
 * Usage:
 *   node scripts/qa/intake-harness.mjs --matrix docs/qa/intake-test-matrix.csv \
 *     --out docs/qa/results.csv [--limit 80] [--filter-polarity negative]
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_URL (defaults to prod).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'https://api.visaai.co';
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const MATRIX = arg('--matrix', 'docs/qa/intake-test-matrix.csv');
const OUT = arg('--out', 'docs/qa/results.csv');
const LIMIT = Number(arg('--limit', '80'));
const POLARITY = arg('--filter-polarity', null);
const TURNS = Number(arg('--turns', '4'));

/** Minimal CSV reader: the matrix is machine-written, quotes are well formed. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', qt = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (qt) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') qt = false;
      else field += c;
    } else if (c === '"') qt = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length)
             .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

/** A throwaway account per run, deleted at the end so nothing accumulates. */
async function makeUser() {
  const email = `qa-harness-${Date.now()}@visaai-test.invalid`;
  const password = `Qa-${Math.random().toString(36).slice(2)}-${Date.now()}!`;
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
  const created = await fetch(`${SB}/auth/v1/admin/users`, {
    method: 'POST', headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  }).then(r => r.json());
  const tok = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  }).then(r => r.json());
  if (!tok.access_token) throw new Error('could not mint a token');
  return { id: created.id, token: tok.access_token };
}

async function deleteUser(id) {
  await fetch(`${SB}/auth/v1/admin/users/${id}`, {
    method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  }).catch(() => {});
}

/**
 * One conversation. Resolves with the transcript rather than throwing, so a
 * single bad scenario cannot end the run.
 */
function converse({ token, applicationId, seed, turns, followUps, timeoutMs = 90_000 }) {
  return new Promise(resolve => {
    const transcript = [];
    const flags = [];
    let pending = null;
    let sent = 0;
    let settled = false;

    const socket = io(`${API}/intake`, {
      auth: { token }, transports: ['websocket'], reconnection: false, timeout: 20_000,
    });

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      socket.close();
      resolve({ transcript, flags });
    };
    const guard = setTimeout(() => { flags.push('timeout'); done(); }, timeoutMs);

    const say = text => {
      sent++;
      pending = text;
      socket.emit('intake:message', { applicationId, text });
    };

    if (process.env.QA_DEBUG) {
      socket.onAny((n, p) => console.log('   [ev]', n, JSON.stringify(p ?? '').slice(0, 90)));
    }
    socket.on('connect', () => {
      socket.emit('intake:start', { applicationId });
      // The opening question is generated, which takes time, and a fresh
      // application has no history to replay. Waiting for `intake:history`
      // alone left the run silent until it timed out, so the seed goes after a
      // pause whether or not anything has arrived — the assistant answers it
      // either way.
      setTimeout(() => { if (sent === 0) say(seed); }, 4000);
    });
    socket.on('connect_error', e => { flags.push(`connect_error:${e.message}`); done(); });
    socket.on('intake:error', e => { flags.push(`intake_error:${e?.message ?? 'unknown'}`); done(); });

    const seenTurns = new Set();
    socket.on('intake:message', msg => {
      if (msg.role !== 'assistant') return;
      // NOT `isComplete`. That flag means the INTERVIEW is finished, not that
      // this message is — `onReady: (question, isComplete) => deliver(...)`
      // passes the graph's completion state — so filtering on it discarded
      // every normal turn and the first version of this harness recorded
      // nothing but timeouts. One `intake:message` per turnId is the real
      // terminator; the streamed preview arrives as `intake:token`.
      if (msg.turnId) {
        if (seenTurns.has(msg.turnId)) return;
        seenTurns.add(msg.turnId);
      }
      const content = String(msg.content ?? '');
      if (msg.isComplete === true) flags.push('interview_complete');

      // An assistant turn that arrives before the seed is the opening question,
      // not an answer to anything. Record it, then send the seed rather than a
      // follow-up — otherwise the scenario under test is never actually asked.
      if (sent === 0) {
        transcript.push({ asked: '(opening question)', reply: content });
        return say(seed);
      }

      transcript.push({ asked: pending, reply: content });
      if (msg.guardrail) flags.push(`guardrail:${msg.guardrail}`);
      if (!content.trim()) flags.push('empty_reply');
      if (/I can not predict visa decisions/i.test(content)) flags.push('refusal_fallback');
      if (sent >= turns) return done();
      // Scripted follow-ups where the scenario needs them, generic filler
      // otherwise.
      //
      // The generic version alone cannot test a correction: the seed is sent,
      // then "yes"/"no"/"not sure", so nothing is ever corrected and a run that
      // looks clean proves only that nothing was tried. N1 and N6 exist
      // precisely to check that a corrected value overwrites the first one
      // instead of landing under a second key.
      const scripted = followUps ?? [];
      const next = scripted[sent - 1] ?? ['yes', 'no', 'I am not sure yet'][(sent - 1) % 3];
      say(next);
    });
  });
}

/**
 * Follow-ups that make a scenario actually test what it claims to.
 *
 * Only where the check needs a specific second turn. Everything else gets
 * filler, because the point there is to see what the assistant ASKS.
 */
const FOLLOW_UPS = {
  // The date is impossible; correct it and the stored value must become the
  // corrected one, under the same key.
  N1: ['Sorry, I mistyped. Departure is May 2027, not May 2026.', 'yes'],
  // Correct an amount already given, to prove the second value replaces the
  // first rather than creating a second key.
  N6: ['My annual income is 40000.', 'Correction: my annual income is 90000, not 40000.'],
};

const rows = parseCsv(readFileSync(MATRIX, 'utf8'))
  .filter(r => (POLARITY ? r.polarity === POLARITY : true))
  .slice(0, LIMIT);

console.log(`running ${rows.length} scenario(s), ${TURNS} turns each`);

const user = await makeUser();
const out = [[
  'test_id','destination_code','visa_type','applying_from','scenario_id','polarity',
  'application_id','turn','question_or_seed','assistant_reply','flags','elapsed_ms',
].join(',')];

let n = 0;
for (const r of rows) {
  n++;
  const t0 = Date.now();
  let appId = '', flags = [], transcript = [];
  try {
    const created = await api('/intake/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ country: r.destination_code }),
    });
    appId = (created.body.match(/"(?:applicationId|id)":"([^"]+)"/) ?? [])[1] ?? '';
    if (!appId) throw new Error(`create failed ${created.status}: ${created.body.slice(0, 120)}`);

    const res = await converse({
      token: user.token, applicationId: appId, seed: r.seed_message,
      turns: TURNS, followUps: FOLLOW_UPS[r.scenario_id],
    });
    transcript = res.transcript; flags = res.flags;
  } catch (err) {
    flags = [`harness_error:${err.message}`];
  }

  const elapsed = Date.now() - t0;
  if (transcript.length === 0) {
    out.push([r.test_id, r.destination_code, r.visa_type, r.applying_from, r.scenario_id, r.polarity,
      appId, 0, r.seed_message, '', flags.join('|'), elapsed].map(csvCell).join(','));
  } else {
    transcript.forEach((t, i) => out.push([
      r.test_id, r.destination_code, r.visa_type, r.applying_from, r.scenario_id, r.polarity,
      appId, i + 1, t.asked ?? '', t.reply, i === 0 ? flags.join('|') : '', i === 0 ? elapsed : '',
    ].map(csvCell).join(',')));
  }
  writeFileSync(OUT, out.join('\n') + '\n');
  console.log(`[${n}/${rows.length}] ${r.test_id} ${(elapsed / 1000).toFixed(0)}s turns=${transcript.length} ${flags.join('|') || 'ok'}`);
}

// `--keep` leaves the throwaway account (and therefore its applications) in
// place, because deleting it cascades the rows away and the interesting part of
// a correction test is what ended up in application_profiles. Clean up by hand
// afterwards; the run prints the id.
if (process.argv.includes('--keep')) {
  console.log(`done -> ${OUT} (KEPT user ${user.id} — delete it when finished)`);
} else {
  await deleteUser(user.id);
  console.log(`done -> ${OUT} (temp user deleted, its applications cascade)`);
}
