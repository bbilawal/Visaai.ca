/**
 * P3b owner-only isolation (live Supabase, gated). User A must NOT read or write
 * user B's push_subscriptions or notification_preferences. Service-role reads
 * across users. Skipped without SUPABASE_* env.
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

describeIf('Messaging P3b owner-only isolation', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!p3b';
  const A = { id: '', email: `p3b-a-${stamp}@example.com`, token: '' };
  const B = { id: '', email: `p3b-b-${stamp}@example.com`, token: '' };

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
    // B owns a push subscription + prefs row.
    await admin.from('push_subscriptions').insert({
      user_id: B.id,
      endpoint: `https://push/${stamp}`,
      p256dh: 'p',
      auth: 'a',
    });
    await admin
      .from('notification_preferences')
      .insert({ user_id: B.id, email_enabled: false, push_enabled: true });
  });

  afterAll(async () => {
    if (A.id) await admin.auth.admin.deleteUser(A.id);
    if (B.id) await admin.auth.admin.deleteUser(B.id);
  });

  it('A cannot read B push_subscriptions', async () => {
    const db = forUser(A.token);
    expect(
      (await db.from('push_subscriptions').select('*').eq('user_id', B.id))
        .data ?? [],
    ).toHaveLength(0);
  });

  it('A cannot read B notification_preferences', async () => {
    const db = forUser(A.token);
    expect(
      (
        await db
          .from('notification_preferences')
          .select('*')
          .eq('user_id', B.id)
      ).data ?? [],
    ).toHaveLength(0);
  });

  it('A cannot insert a subscription owned by B', async () => {
    const db = forUser(A.token);
    const res = await db.from('push_subscriptions').insert({
      user_id: B.id,
      endpoint: `https://evil/${stamp}`,
      p256dh: 'p',
      auth: 'a',
    });
    expect(res.error).not.toBeNull();
  });

  it('service-role reads across users', async () => {
    expect(
      (await admin.from('push_subscriptions').select('*').eq('user_id', B.id))
        .data ?? [],
    ).not.toHaveLength(0);
  });
});
