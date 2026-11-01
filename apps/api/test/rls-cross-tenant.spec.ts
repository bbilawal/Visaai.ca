/**
 * F1 cross-tenant isolation integration test.
 *
 * Proves that the per-request RLS-scoped client (SupabaseService.forUser) only
 * exposes the owner's rows: user B must NOT be able to read user A's application,
 * documents, or checklist items, while user A can.
 *
 * Requires a live Supabase with the migrations + RLS policies applied. It is
 * GATED on env vars so the default `npm test` (no DB) stays green: when any of
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are missing the
 * whole suite is skipped.
 *
 * Run it with:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   npx jest rls-cross-tenant
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY && ANON_KEY);

// Same construction as SupabaseService.forUser.
function forUser(token: string): SupabaseClient {
  return createClient(URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const describeIf = CONFIGURED ? describe : describe.skip;

describeIf('F1 RLS cross-tenant isolation (live Supabase)', () => {
  jest.setTimeout(45_000);

  const admin = CONFIGURED
    ? createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);
  const anon = CONFIGURED
    ? createClient(URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);

  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!cross-tenant';
  const userA = { id: '', email: `rls-a-${stamp}@example.com`, token: '' };
  const userB = { id: '', email: `rls-b-${stamp}@example.com`, token: '' };
  let appAId = '';
  let docAId = '';

  async function createUser(u: { id: string; email: string; token: string }) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`createUser failed: ${error?.message}`);
    u.id = data.user.id;
    // public.users extends auth.users. A migration-installed trigger may already
    // have created the row, so upsert rather than insert — this must work both
    // with and without that trigger.
    const { error: pubErr } = await admin
      .from('users')
      .upsert({ id: u.id, email: u.email }, { onConflict: 'id' });
    if (pubErr) throw new Error(`seed public.users failed: ${pubErr.message}`);

    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword(
      {
        email: u.email,
        password: PASSWORD,
      },
    );
    if (signErr || !signIn.session)
      throw new Error(`signIn failed: ${signErr?.message}`);
    u.token = signIn.session.access_token;
  }

  beforeAll(async () => {
    await createUser(userA);
    await createUser(userB);

    // Seed an application + document + checklist item owned by user A (service role).
    const { data: app, error: appErr } = await admin
      .from('applications')
      .insert({ user_id: userA.id, destination_country: 'CA' })
      .select('id')
      .single();
    if (appErr || !app)
      throw new Error(`seed application failed: ${appErr?.message}`);
    appAId = app.id;

    const { data: doc, error: docErr } = await admin
      .from('documents')
      .insert({
        application_id: appAId,
        storage_path: `${userA.id}/${appAId}/passport.png`,
        mime_type: 'image/png',
        file_name: 'passport.png',
      })
      .select('id')
      .single();
    if (docErr || !doc)
      throw new Error(`seed document failed: ${docErr?.message}`);
    docAId = doc.id;

    const { error: ciErr } = await admin.from('checklist_items').insert({
      application_id: appAId,
      document_type: 'passport',
      label: 'Passport',
      required: true,
    });
    if (ciErr) throw new Error(`seed checklist failed: ${ciErr.message}`);
  });

  afterAll(async () => {
    // Deleting the auth users cascades to public.users -> applications -> children.
    if (userA.id) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
    if (userB.id) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
  });

  it('owner (A) can read their own application', async () => {
    const { data } = await forUser(userA.token)
      .from('applications')
      .select('id')
      .eq('id', appAId);
    expect(data?.map((r) => r.id)).toContain(appAId);
  });

  it("non-owner (B) cannot read A's application", async () => {
    const { data } = await forUser(userB.token)
      .from('applications')
      .select('id')
      .eq('id', appAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("non-owner (B) cannot read A's documents", async () => {
    const { data } = await forUser(userB.token)
      .from('documents')
      .select('id')
      .eq('id', docAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("non-owner (B) cannot read A's checklist items", async () => {
    const { data } = await forUser(userB.token)
      .from('checklist_items')
      .select('id')
      .eq('application_id', appAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("non-owner (B) cannot delete A's document (RLS blocks, row remains)", async () => {
    await forUser(userB.token).from('documents').delete().eq('id', docAId);
    // Verify with service role that the row still exists.
    const { data } = await admin
      .from('documents')
      .select('id')
      .eq('id', docAId)
      .maybeSingle();
    expect(data?.id).toBe(docAId);
  });

  it('owner (A) can read their own document', async () => {
    const { data } = await forUser(userA.token)
      .from('documents')
      .select('id')
      .eq('id', docAId);
    expect(data?.map((r) => r.id)).toContain(docAId);
  });
});
