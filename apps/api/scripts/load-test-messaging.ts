/* eslint-disable no-console */
/**
 * Messaging load-test harness (manual, not CI). Seeds two users + a conversation
 * via the service-role key, opens many SSE subscribers, fires concurrent message
 * sends, prints a latency/throughput report, then tears everything down.
 *
 * Run (from apps/api, with apps/api/.env loaded):
 *   set -a; . ./.env; set +a
 *   npx ts-node scripts/load-test-messaging.ts
 * Knobs: LT_API_URL, LT_SUBSCRIBERS, LT_MESSAGES, LT_CONCURRENCY.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { summarize } from './lt-metrics';

const API_URL = process.env.LT_API_URL ?? 'http://localhost:4000';
const SUBSCRIBERS = Number(process.env.LT_SUBSCRIBERS ?? 12);
const MESSAGES = Number(process.env.LT_MESSAGES ?? 300);
const CONCURRENCY = Number(process.env.LT_CONCURRENCY ?? 20);
const ERROR_RATE_LIMIT = 0.05;

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

interface Party { id: string; email: string; token: string }

async function makeUser(admin: SupabaseClient, email: string): Promise<Party> {
  const c = await admin.auth.admin.createUser({ email, password: 'LoadTest-Passw0rd!', email_confirm: true });
  const id = c.data.user?.id;
  if (!id) throw new Error(`createUser failed for ${email}: ${c.error?.message ?? 'no user returned'}`);
  await admin.from('users').insert({ id, email }).then(() => {}, () => {});
  const s = await createClient(URL!, ANON_KEY!).auth.signInWithPassword({ email, password: 'LoadTest-Passw0rd!' });
  const token = s.data.session?.access_token;
  if (!token) throw new Error(`signIn failed for ${email}: ${s.error?.message ?? 'no session returned'}`);
  return { id, email, token };
}

/** Open one SSE connection; resolves with a live handle that counts events. */
function openSubscriber(token: string) {
  const controller = new AbortController();
  const state = { events: 0, lastEventAt: 0, rejected: false, status: 0 };
  const run = async () => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/messaging/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch {
      state.rejected = true;
      return;
    }
    state.status = res.status;
    if (!res.ok || !res.body) { state.rejected = true; return; } // 429 over the per-user cap, etc.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let payload: Record<string, unknown>;
          try { payload = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (payload.heartbeat || payload.connected) continue;
          state.events++;
          state.lastEventAt = Date.now();
        }
      }
    } catch {
      // aborted at teardown — expected
    }
  };
  const started = run();
  return { state, controller, started };
}

/** POST one message; returns round-trip ms + ok flag. */
async function sendOne(token: string, applicationId: string, n: number): Promise<{ ms: number; ok: boolean }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API_URL}/messaging/${applicationId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: `load test message ${n}`, category: 'general' }),
    });
    return { ms: Date.now() - t0, ok: res.ok };
  } catch {
    return { ms: Date.now() - t0, ok: false };
  }
}

/** Run `total` tasks with at most `concurrency` in flight. */
async function pool<T>(total: number, concurrency: number, task: (n: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(total);
  let next = 0;
  async function worker() {
    while (true) {
      const n = next++;
      if (n >= total) return;
      results[n] = await task(n);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return results;
}

async function main() {
  if (!URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY. Source apps/api/.env first.');
    process.exit(1);
  }
  const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const stamp = Date.now();
  let owner: Party | null = null;
  let consultant: Party | null = null;
  let appId = '';
  let convId = '';
  const subs: ReturnType<typeof openSubscriber>[] = [];

  try {
    // Reachability check.
    try {
      // A running API root has no route → 404, which still proves reachability.
      // A 5xx (e.g. proxy up but API down) or a network error means not reachable.
      const ping = await fetch(`${API_URL}/`).catch(() => null);
      if (!ping || ping.status >= 500) throw new Error('unreachable');
    } catch {
      console.error(`API not reachable at ${API_URL}. Start it (pnpm --filter api start:dev) or set LT_API_URL.`);
      process.exit(1);
    }

    console.log(`Seeding (api=${API_URL}, subscribers=${SUBSCRIBERS}, messages=${MESSAGES}, concurrency=${CONCURRENCY})…`);
    owner = await makeUser(admin, `lt-owner-${stamp}@example.com`);
    consultant = await makeUser(admin, `lt-consultant-${stamp}@example.com`);
    appId = (await admin.from('applications').insert({ user_id: owner.id, status: 'draft' }).select('id').single()).data!.id;
    convId = (await admin.from('conversations').insert({ application_id: appId }).select('id').single()).data!.id;
    await admin.from('consultant_assignments')
      .insert({ application_id: appId, consultant_id: consultant.id, status: 'active', role: 'primary' })
      .then(
        ({ error }) => { if (error) console.warn(`consultant_assignments insert failed: ${error.message} — consultant may receive no SSE events`); },
        (e) => console.warn(`consultant_assignments insert threw: ${String(e)}`),
      );

    // Open subscribers (alternating the two tokens).
    for (let i = 0; i < SUBSCRIBERS; i++) {
      subs.push(openSubscriber(i % 2 === 0 ? owner.token : consultant.token));
    }
    // Give the fetch streams time to negotiate the SSE handshake before sends begin.
    await new Promise((r) => setTimeout(r, 1000));

    // Concurrent sends (alternating sender so each fans out to the other party).
    console.log('Sending…');
    const sendStart = Date.now();
    const sent = await pool(MESSAGES, CONCURRENCY, (n) =>
      sendOne(n % 2 === 0 ? owner!.token : consultant!.token, appId, n),
    );
    const lastSendAt = Date.now();
    const sendWindowSec = (lastSendAt - sendStart) / 1000;

    await new Promise((r) => setTimeout(r, 2000)); // drain SSE

    // Metrics.
    const okSends = sent.filter((s) => s.ok);
    const latency = summarize(okSends.map((s) => s.ms));
    const errorRate = (sent.length - okSends.length) / sent.length;
    const throughput = sendWindowSec > 0 ? okSends.length / sendWindowSec : 0;
    const rejected = subs.filter((s) => s.state.rejected).length;
    const totalEvents = subs.reduce((acc, s) => acc + s.state.events, 0);
    const lastEventAt = Math.max(0, ...subs.map((s) => s.state.lastEventAt));
    const lagMs = lastEventAt > 0 ? lastEventAt - lastSendAt : -1;

    console.log('\n========== Messaging load test ==========');
    console.log(`POST latency ms   count=${latency.count} min=${latency.min} p50=${latency.p50} p95=${latency.p95} p99=${latency.p99} max=${latency.max} mean=${latency.mean.toFixed(1)}`);
    console.log(`Throughput        ${throughput.toFixed(1)} msg/s over ${sendWindowSec.toFixed(2)}s`);
    console.log(`Send errors       ${((errorRate) * 100).toFixed(2)}% (${sent.length - okSends.length}/${sent.length})`);
    console.log(`Subscribers       opened=${SUBSCRIBERS} rejected(429+)=${rejected} connected=${SUBSCRIBERS - rejected}`);
    console.log(`SSE events        received=${totalEvents} (cap per user = 8; rejections expected above that)`);
    console.log(`SSE drain lag     ${lagMs >= 0 ? lagMs + 'ms (last event after last send)' : 'n/a'}`);
    console.log('=========================================\n');

    if (errorRate > ERROR_RATE_LIMIT) {
      console.error(`FAIL: send error rate ${(errorRate * 100).toFixed(2)}% exceeds ${(ERROR_RATE_LIMIT * 100)}%`);
      process.exitCode = 2;
    }
  } finally {
    for (const s of subs) s.controller.abort();
    if (convId) await admin.from('conversations').delete().eq('id', convId);
    if (appId) await admin.from('applications').delete().eq('id', appId);
    if (owner?.id) await admin.auth.admin.deleteUser(owner.id);
    if (consultant?.id) await admin.auth.admin.deleteUser(consultant.id);
    console.log('Teardown complete.');
  }
}

void main();
