/**
 * P3a staff-only isolation (live Supabase, gated). The application OWNER must
 * NOT be able to read consultant_notes or escalation_history for their own
 * application, and must NOT be able to set conversations.consultant_state via a
 * direct authenticated UPDATE (column REVOKE'd). Skipped without SUPABASE_* env.
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

describeIf('Messaging P3a staff-only isolation', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!p3a';
  const A = { id: '', email: `p3a-a-${stamp}@example.com`, token: '' };
  let appAId = '';
  let convAId = '';

  async function makeUser(u: { id: string; email: string; token: string }) {
    const created = await admin.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
    });
    u.id = created.data.user!.id;
    await admin
      .from('users')
      .insert({ id: u.id, email: u.email })
      .then(
        () => {},
        () => {},
      );
    const signedIn = await createClient(
      URL!,
      ANON_KEY!,
    ).auth.signInWithPassword({ email: u.email, password: PASSWORD });
    u.token = signedIn.data.session!.access_token;
  }

  beforeAll(async () => {
    await makeUser(A);
    appAId = (
      await admin
        .from('applications')
        .insert({ user_id: A.id, status: 'draft' })
        .select('id')
        .single()
    ).data!.id as string;
    convAId = (
      await admin
        .from('conversations')
        .insert({ application_id: appAId })
        .select('id')
        .single()
    ).data!.id as string;
    await admin.from('consultant_notes').insert({
      conversation_id: convAId,
      application_id: appAId,
      author_id: A.id,
      body: 'internal',
    });
    await admin.from('escalation_history').insert({
      conversation_id: convAId,
      application_id: appAId,
      escalated_by: A.id,
      escalation_type: 'legal_review',
      reason: 'r',
    });
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convAId);
    await admin.from('applications').delete().eq('id', appAId);
    if (A.id) await admin.auth.admin.deleteUser(A.id);
  });

  it('owner CANNOT read consultant_notes for their own application', async () => {
    const db = forUser(A.token);
    expect(
      (
        await db
          .from('consultant_notes')
          .select('*')
          .eq('conversation_id', convAId)
      ).data ?? [],
    ).toHaveLength(0);
  });

  it('owner CANNOT read escalation_history for their own application', async () => {
    const db = forUser(A.token);
    expect(
      (
        await db
          .from('escalation_history')
          .select('*')
          .eq('conversation_id', convAId)
      ).data ?? [],
    ).toHaveLength(0);
  });

  it('owner CANNOT set consultant_state via direct UPDATE (column revoked)', async () => {
    const db = forUser(A.token);
    await db
      .from('conversations')
      .update({ consultant_state: 'under_review' })
      .eq('id', convAId);
    // The owner CAN see the conversation row, but the consultant_state write is
    // blocked by the column REVOKE — verify it is still null via the admin read.
    const row = await admin
      .from('conversations')
      .select('consultant_state')
      .eq('id', convAId)
      .single();
    expect(
      (row.data as { consultant_state: string | null }).consultant_state,
    ).toBeNull();
  });
});
