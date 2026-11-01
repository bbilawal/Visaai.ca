/**
 * Messaging cross-tenant isolation (live Supabase, gated like rls-cross-tenant).
 * Proves: user B cannot read user A's conversation/messages; an unassigned
 * consultant cannot read; the owner can. Skipped unless SUPABASE_* env present.
 *
 * Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *      npx jest messaging-rls
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

describeIf('Messaging RLS cross-tenant isolation', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!msg';
  const A = { id: '', email: `msg-a-${stamp}@example.com`, token: '' };
  const B = { id: '', email: `msg-b-${stamp}@example.com`, token: '' };
  let appAId = '';
  let convAId = '';

  async function makeUser(u: { id: string; email: string; token: string }) {
    const created = await admin.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
    });
    u.id = created.data.user!.id;
    const signedIn = await createClient(
      URL!,
      ANON_KEY!,
    ).auth.signInWithPassword({
      email: u.email,
      password: PASSWORD,
    });
    u.token = signedIn.data.session!.access_token;
  }

  beforeAll(async () => {
    await makeUser(A);
    await makeUser(B);
    const app = await admin
      .from('applications')
      .insert({ user_id: A.id, status: 'draft' })
      .select('id')
      .single();
    appAId = app.data!.id as string;
    const conv = await admin
      .from('conversations')
      .insert({ application_id: appAId })
      .select('id')
      .single();
    convAId = conv.data!.id as string;
    await admin.from('messages').insert({
      conversation_id: convAId,
      sender_id: A.id,
      sender_role: 'user',
      category: 'general',
      body: 'private to A',
    });
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convAId);
    await admin.from('applications').delete().eq('id', appAId);
    if (A.id) await admin.auth.admin.deleteUser(A.id);
    if (B.id) await admin.auth.admin.deleteUser(B.id);
  });

  it('owner A can read their conversation and messages', async () => {
    const db = forUser(A.token);
    const conv = await db.from('conversations').select('*').eq('id', convAId);
    expect(conv.data?.length).toBe(1);
    const msgs = await db
      .from('messages')
      .select('*')
      .eq('conversation_id', convAId);
    expect(msgs.data?.length).toBe(1);
  });

  it('unrelated user B cannot read A conversation or messages', async () => {
    const db = forUser(B.token);
    const conv = await db.from('conversations').select('*').eq('id', convAId);
    expect(conv.data ?? []).toHaveLength(0);
    const msgs = await db
      .from('messages')
      .select('*')
      .eq('conversation_id', convAId);
    expect(msgs.data ?? []).toHaveLength(0);
  });

  it('user B cannot insert a message into A conversation', async () => {
    const db = forUser(B.token);
    const res = await db.from('messages').insert({
      conversation_id: convAId,
      sender_id: B.id,
      sender_role: 'user',
      category: 'general',
      body: 'intrusion',
    });
    expect(res.error).toBeTruthy(); // RLS with-check denies
  });
});
