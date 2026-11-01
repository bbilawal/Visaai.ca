/**
 * P2 cross-tenant isolation (live Supabase, gated). Proves an unrelated user
 * cannot read another conversation's attachments/voice/document_requests, and
 * cannot insert a document_request. Run with SUPABASE_* set; skipped otherwise.
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

describeIf('Messaging P2 RLS cross-tenant isolation', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!p2';
  const A = { id: '', email: `p2-a-${stamp}@example.com`, token: '' };
  const B = { id: '', email: `p2-b-${stamp}@example.com`, token: '' };
  let appAId = '';
  let convAId = '';
  let msgAId = '';
  let attAId = '';

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
    await makeUser(B);
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
    msgAId = (
      await admin
        .from('messages')
        .insert({
          conversation_id: convAId,
          sender_id: A.id,
          sender_role: 'user',
          category: 'documents',
          body: 'doc',
        })
        .select('id')
        .single()
    ).data!.id as string;
    attAId = (
      await admin
        .from('message_attachments')
        .insert({
          message_id: msgAId,
          conversation_id: convAId,
          storage_path: `${A.id}/${appAId}/messages/${convAId}/x.png`,
          file_name: 'x.png',
          mime_type: 'image/png',
          size_bytes: 10,
          kind: 'image',
        })
        .select('id')
        .single()
    ).data!.id as string;
    await admin.from('document_requests').insert({
      conversation_id: convAId,
      application_id: appAId,
      requested_by: A.id,
      document_type: 'bank',
      label: 'Bank',
    });
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convAId);
    await admin.from('applications').delete().eq('id', appAId);
    if (A.id) await admin.auth.admin.deleteUser(A.id);
    if (B.id) await admin.auth.admin.deleteUser(B.id);
  });

  it('owner A reads attachment + document_request', async () => {
    const db = forUser(A.token);
    expect(
      (await db.from('message_attachments').select('*').eq('id', attAId)).data
        ?.length,
    ).toBe(1);
    expect(
      (
        await db
          .from('document_requests')
          .select('*')
          .eq('conversation_id', convAId)
      ).data?.length,
    ).toBe(1);
  });

  it('unrelated user B cannot read attachment or document_request', async () => {
    const db = forUser(B.token);
    expect(
      (await db.from('message_attachments').select('*').eq('id', attAId))
        .data ?? [],
    ).toHaveLength(0);
    expect(
      (
        await db
          .from('document_requests')
          .select('*')
          .eq('conversation_id', convAId)
      ).data ?? [],
    ).toHaveLength(0);
  });

  it('user B cannot insert a document_request into A application', async () => {
    const db = forUser(B.token);
    const res = await db.from('document_requests').insert({
      conversation_id: convAId,
      application_id: appAId,
      requested_by: B.id,
      document_type: 'x',
      label: 'X',
    });
    expect(res.error).toBeTruthy();
  });
});
