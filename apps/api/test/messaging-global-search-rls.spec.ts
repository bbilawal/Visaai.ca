/**
 * Global-search live (gated): an RLS-scoped FTS with NO conversation filter
 * returns hits from ALL of a caller's conversations and none from a stranger's.
 * Skipped without SUPABASE_* env + the P4 search migration applied.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY && ANON_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

const SELECT =
  'id, conversation_id, body, conversations!inner(application_id, applications!inner(country_frameworks(country_code, visa_type)))';

function forUser(token: string): SupabaseClient {
  return createClient(URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describeIf('Messaging global search (live)', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!gs';
  const owner = { id: '', email: `gs-owner-${stamp}@example.com`, token: '' };
  const stranger = {
    id: '',
    email: `gs-stranger-${stamp}@example.com`,
    token: '',
  };
  const apps: string[] = [];
  const convs: string[] = [];

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
  async function seedConversation(
    ownerId: string,
    body: string,
  ): Promise<void> {
    const appId = (
      await admin
        .from('applications')
        .insert({ user_id: ownerId, status: 'draft' })
        .select('id')
        .single()
    ).data!.id;
    apps.push(appId);
    const convId = (
      await admin
        .from('conversations')
        .insert({ application_id: appId })
        .select('id')
        .single()
    ).data!.id;
    convs.push(convId);
    await admin.from('messages').insert({
      conversation_id: convId,
      sender_id: ownerId,
      sender_role: 'user',
      category: 'documents',
      body,
    });
  }

  beforeAll(async () => {
    await makeUser(owner);
    await makeUser(stranger);
    await seedConversation(
      owner.id,
      'Please upload your bank statement and passport.',
    );
    await seedConversation(owner.id, 'The bank statement fee was paid.');
    await seedConversation(
      stranger.id,
      'A bank statement only the stranger should see.',
    );
  });

  afterAll(async () => {
    for (const c of convs)
      await admin.from('conversations').delete().eq('id', c);
    for (const a of apps) await admin.from('applications').delete().eq('id', a);
    if (owner.id) await admin.auth.admin.deleteUser(owner.id);
    if (stranger.id) await admin.auth.admin.deleteUser(stranger.id);
  });

  it('owner global FTS returns hits from BOTH own conversations', async () => {
    const db = forUser(owner.token);
    const res = await db
      .from('messages')
      .select(SELECT)
      .textSearch('search_tsv', 'bank statement', {
        type: 'websearch',
        config: 'simple',
      });
    expect(res.error).toBeNull();
    expect((res.data ?? []).length).toBe(2);
  });

  it('owner does NOT see the stranger conversation', async () => {
    const db = forUser(owner.token);
    const res = await db
      .from('messages')
      .select(SELECT)
      .textSearch('search_tsv', 'bank statement', {
        type: 'websearch',
        config: 'simple',
      });
    const ids = (res.data ?? []).map(
      (r) => (r as { conversation_id: string }).conversation_id,
    );
    expect(ids).not.toContain(convs[2]);
  });

  it('stranger global FTS returns only their own conversation', async () => {
    const db = forUser(stranger.token);
    const res = await db
      .from('messages')
      .select(SELECT)
      .textSearch('search_tsv', 'bank statement', {
        type: 'websearch',
        config: 'simple',
      });
    expect((res.data ?? []).length).toBe(1);
  });
});
