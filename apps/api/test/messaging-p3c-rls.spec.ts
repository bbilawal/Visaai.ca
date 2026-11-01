/**
 * P3c multi-consultant DB invariants (live Supabase, gated). Verifies the
 * one-active-PRIMARY index allows a 2nd active backup but blocks a 2nd active
 * primary, and that a backup (active, role=backup) passes is_active_assignee
 * (so they can read P3a consultant_notes). Skipped without SUPABASE_* env.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY && ANON_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

describeIf('Messaging P3c multi-consultant DB', () => {
  jest.setTimeout(45_000);
  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!p3c';
  const owner = { id: '', email: `p3c-owner-${stamp}@example.com` };
  const primary = { id: '', email: `p3c-primary-${stamp}@example.com` };
  const backup = {
    id: '',
    email: `p3c-backup-${stamp}@example.com`,
    token: '',
  };
  const third = { id: '', email: `p3c-third-${stamp}@example.com` };
  let appId = '';
  let convId = '';

  async function makeUser(u: { id: string; email: string; token?: string }) {
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
    if ('token' in u)
      (u as { token: string }).token = s.data.session!.access_token;
  }

  beforeAll(async () => {
    await makeUser(owner);
    await makeUser(primary);
    await makeUser(backup);
    await makeUser(third);
    appId = (
      await admin
        .from('applications')
        .insert({
          user_id: owner.id,
          status: 'draft',
          destination_country: 'CA',
        })
        .select('id')
        .single()
    ).data!.id;
    await admin.from('consultant_assignments').insert({
      application_id: appId,
      consultant_id: primary.id,
      role: 'primary',
      status: 'active',
    });
    await admin.from('consultant_assignments').insert({
      application_id: appId,
      consultant_id: backup.id,
      role: 'backup',
      status: 'active',
    });
    convId = (
      await admin
        .from('conversations')
        .insert({ application_id: appId })
        .select('id')
        .single()
    ).data!.id;
    await admin.from('consultant_notes').insert({
      conversation_id: convId,
      application_id: appId,
      author_id: primary.id,
      body: 'internal',
    });
  });

  afterAll(async () => {
    await admin.from('conversations').delete().eq('id', convId);
    await admin.from('applications').delete().eq('id', appId);
    for (const u of [owner, primary, backup, third])
      if (u.id) await admin.auth.admin.deleteUser(u.id);
  });

  it('allows a 2nd active backup (already inserted in beforeAll)', async () => {
    const rows =
      (
        await admin
          .from('consultant_assignments')
          .select('role')
          .eq('application_id', appId)
          .eq('status', 'active')
      ).data ?? [];
    expect(rows.length).toBe(2);
  });

  it('blocks a 2nd active PRIMARY by a DIFFERENT consultant (isolates one-active-primary index)', async () => {
    // `third` is not yet assigned, so unique(application_id, consultant_id) does
    // NOT fire — only the partial one_active_primary index can block this.
    const res = await admin.from('consultant_assignments').insert({
      application_id: appId,
      consultant_id: third.id,
      role: 'primary',
      status: 'active',
    });
    expect(res.error).not.toBeNull();
    // ...but the SAME third consultant CAN be added as a 2nd active backup.
    const ok = await admin.from('consultant_assignments').insert({
      application_id: appId,
      consultant_id: third.id,
      role: 'backup',
      status: 'active',
    });
    expect(ok.error).toBeNull();
  });

  it('a BACKUP can read consultant_notes (is_active_assignee)', async () => {
    const db = createClient(URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${backup.token}` } },
    });
    const notes =
      (
        await db
          .from('consultant_notes')
          .select('*')
          .eq('conversation_id', convId)
      ).data ?? [];
    expect(notes.length).toBe(1);
  });
});
