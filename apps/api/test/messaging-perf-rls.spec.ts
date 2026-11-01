/**
 * countUnread live (gated): the head count matches the old JS-filter semantics
 * against real Postgres, and RLS still scopes it (a stranger counts 0).
 * Skipped without SUPABASE_* env.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MessagingRepository } from '../src/modules/messaging/messaging.repository.impl';

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

describeIf('countUnread (live)', () => {
  jest.setTimeout(45_000);
  const repo = new MessagingRepository();
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!perf';
  const owner = { id: '', email: `perf-owner-${stamp}@example.com`, token: '' };
  const other = { id: '', email: `perf-other-${stamp}@example.com`, token: '' };
  const stranger = {
    id: '',
    email: `perf-stranger-${stamp}@example.com`,
    token: '',
  };
  let appId = '';
  let convId = '';
  const watermark = '2026-01-01T00:00:02.000Z';

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
    await makeUser(other);
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
    // Make `other` an active consultant so RLS lets them post + the owner can see it.
    await admin
      .from('consultant_assignments')
      .insert({
        application_id: appId,
        consultant_id: other.id,
        status: 'active',
        role: 'primary',
      })
      .then(
        () => {},
        () => {},
      );
    await admin.from('messages').insert([
      {
        conversation_id: convId,
        sender_id: other.id,
        sender_role: 'consultant',
        category: 'general',
        body: 'before',
        created_at: '2026-01-01T00:00:01.000Z',
      }, // before watermark → not unread
      {
        conversation_id: convId,
        sender_id: owner.id,
        sender_role: 'user',
        category: 'general',
        body: 'mine',
        created_at: '2026-01-01T00:00:03.000Z',
      }, // own → excluded
      {
        conversation_id: convId,
        sender_id: other.id,
        sender_role: 'consultant',
        category: 'general',
        body: 'after1',
        created_at: '2026-01-01T00:00:04.000Z',
      }, // unread
      {
        conversation_id: convId,
        sender_id: other.id,
        sender_role: 'consultant',
        category: 'general',
        body: 'after2',
        created_at: '2026-01-01T00:00:05.000Z',
      }, // unread
    ]);
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convId);
    await admin.from('applications').delete().eq('id', appId);
    for (const u of [owner, other, stranger])
      if (u.id) await admin.auth.admin.deleteUser(u.id);
  });

  it('counts only OTHER-sender messages after the watermark (service-role)', async () => {
    expect(await repo.countUnread(admin, convId, owner.id, watermark)).toBe(2);
  });

  it('with a null watermark counts all OTHER-sender messages', async () => {
    expect(await repo.countUnread(admin, convId, owner.id, null)).toBe(3);
  });

  it('a stranger (RLS-scoped) counts 0', async () => {
    expect(
      await repo.countUnread(
        forUser(stranger.token),
        convId,
        stranger.id,
        null,
      ),
    ).toBe(0);
  });
});
