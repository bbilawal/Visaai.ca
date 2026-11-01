/**
 * Pagination live (gated): getThread returns the newest PAGE with has_more, an
 * older-page fetch returns the remainder, and RLS still scopes it. Skipped
 * without SUPABASE_* env.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MessagingRepository } from '../src/modules/messaging/messaging.repository.impl';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY && ANON_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;
const PAGE = 50;

function forUser(token: string): SupabaseClient {
  return createClient(URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describeIf('Messaging pagination (live)', () => {
  jest.setTimeout(60_000);
  const repo = new MessagingRepository();
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!pg';
  const owner = { id: '', email: `pg-owner-${stamp}@example.com`, token: '' };
  const stranger = {
    id: '',
    email: `pg-stranger-${stamp}@example.com`,
    token: '',
  };
  let appId = '';
  let convId = '';

  async function makeUser(u: { id: string; email: string; token: string }) {
    const c = await admin.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
    });
    u.id = c.data.user!.id;
    await admin
      .from('users')
      .insert({ id: u.id, email: u.email })
      .then(
        () => {},
        () => {},
      );
    const s = await createClient(URL!, ANON_KEY!).auth.signInWithPassword({
      email: u.email,
      password: PASSWORD,
    });
    u.token = s.data.session!.access_token;
  }

  beforeAll(async () => {
    await makeUser(owner);
    await makeUser(stranger);
    appId = (
      await admin
        .from('applications')
        .insert({ user_id: owner.id, status: 'draft' })
        .select('id')
        .single()
    ).data!.id;
    convId = (
      await admin
        .from('conversations')
        .insert({ application_id: appId })
        .select('id')
        .single()
    ).data!.id;
    const rows = Array.from({ length: PAGE + 5 }, (_, i) => ({
      conversation_id: convId,
      sender_id: owner.id,
      sender_role: 'user',
      category: 'general',
      body: `msg ${i}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }));
    await admin.from('messages').insert(rows);
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convId);
    await admin.from('applications').delete().eq('id', appId);
    if (owner.id) await admin.auth.admin.deleteUser(owner.id);
    if (stranger.id) await admin.auth.admin.deleteUser(stranger.id);
  });

  it('owner first page returns PAGE+1 rows when fetching PAGE+1 (has_more true), older fetch returns the rest', async () => {
    const db = forUser(owner.token);
    const first = await repo.listMessagesPage(db, convId, PAGE + 1, null);
    expect(first.length).toBe(PAGE + 1); // 55 exist; fetching 51 returns 51 → service slices to 50, has_more true
    const oldestInWindow = first.slice(0, PAGE).reverse()[0].created_at; // ascending → [0] is oldest of the 50-window
    const older = await repo.listMessagesPage(
      db,
      convId,
      PAGE + 1,
      oldestInWindow,
    );
    expect(older.length).toBe(5); // remaining older rows
  });

  it('a stranger (RLS) gets an empty page', async () => {
    const db = forUser(stranger.token);
    const res = await repo.listMessagesPage(db, convId, PAGE + 1, null);
    expect(res.length).toBe(0);
  });
});
