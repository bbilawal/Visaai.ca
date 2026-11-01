/**
 * P4 live (gated): full-text search is RLS-scoped (a non-member gets nothing)
 * and the tsvector/index match a seeded body. Skipped without SUPABASE_* env +
 * the migration applied.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY && ANON_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

function forUser(token: string): SupabaseClient {
  return createClient(URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describeIf('Messaging P4 live search', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!p4';
  const owner = { id: '', email: `p4-owner-${stamp}@example.com`, token: '' };
  const stranger = {
    id: '',
    email: `p4-stranger-${stamp}@example.com`,
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
    await admin.from('messages').insert({
      conversation_id: convId,
      sender_id: owner.id,
      sender_role: 'user',
      category: 'documents',
      body: 'Please upload your bank statement and passport.',
    });
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convId);
    await admin.from('applications').delete().eq('id', appId);
    if (owner.id) await admin.auth.admin.deleteUser(owner.id);
    if (stranger.id) await admin.auth.admin.deleteUser(stranger.id);
  });

  it('owner FTS matches the seeded message body', async () => {
    const db = forUser(owner.token);
    const res = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', convId)
      .textSearch('search_tsv', 'bank statement', {
        type: 'websearch',
        config: 'simple',
      });
    expect((res.data ?? []).length).toBe(1);
  });

  it('owner FTS for a non-present term returns nothing', async () => {
    const db = forUser(owner.token);
    const res = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', convId)
      .textSearch('search_tsv', 'helicopter', {
        type: 'websearch',
        config: 'simple',
      });
    expect((res.data ?? []).length).toBe(0);
  });

  it('a stranger (not in the conversation) gets nothing (RLS)', async () => {
    const db = forUser(stranger.token);
    const res = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', convId)
      .textSearch('search_tsv', 'bank statement', {
        type: 'websearch',
        config: 'simple',
      });
    expect((res.data ?? []).length).toBe(0);
  });
});
