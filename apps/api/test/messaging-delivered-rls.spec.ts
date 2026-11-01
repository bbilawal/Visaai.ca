/**
 * Delivered live (gated): service-role can advance delivered_at and read it back;
 * a non-member still cannot read participant rows (column add didn't widen RLS).
 * Skipped without SUPABASE_* env + the delivered migration applied.
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

describeIf('Messaging delivered (live)', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!dlv';
  const owner = { id: '', email: `dlv-owner-${stamp}@example.com`, token: '' };
  const stranger = {
    id: '',
    email: `dlv-stranger-${stamp}@example.com`,
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
    await admin
      .from('conversation_participants')
      .insert({ conversation_id: convId, user_id: owner.id, role: 'user' });
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convId);
    await admin.from('applications').delete().eq('id', appId);
    if (owner.id) await admin.auth.admin.deleteUser(owner.id);
    if (stranger.id) await admin.auth.admin.deleteUser(stranger.id);
  });

  it('service-role advances delivered_at and reads it back', async () => {
    const at = new Date().toISOString();
    const upd = await admin
      .from('conversation_participants')
      .update({ delivered_at: at })
      .eq('conversation_id', convId)
      .in('user_id', [owner.id]);
    expect(upd.error).toBeNull();
    const row = await admin
      .from('conversation_participants')
      .select('delivered_at')
      .eq('conversation_id', convId)
      .eq('user_id', owner.id)
      .single();
    expect(row.data!.delivered_at).not.toBeNull();
  });

  it('a stranger still cannot read participant rows (column add did not widen RLS)', async () => {
    const db = forUser(stranger.token);
    const res = await db
      .from('conversation_participants')
      .select('*')
      .eq('conversation_id', convId);
    expect((res.data ?? []).length).toBe(0);
  });
});
