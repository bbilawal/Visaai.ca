import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * An owner must be able to UPDATE their own application.
 *
 * WHY THIS EXISTS
 *
 * It could not. Every owner UPDATE on `applications` answered:
 *
 *   infinite recursion detected in policy for relation "applications"
 *
 * Found live, on the visa-route picker: `IntakeService.setVisaType` answered
 * 500 on a row the caller owned. The cycle was
 *
 *   UPDATE applications
 *     → applications_owner_consultant_admin_update inlines
 *       EXISTS (SELECT 1 FROM consultant_assignments ...)
 *     → reading that applies consultant_assignments_owner_read
 *     → which does (SELECT user_id FROM applications WHERE id = ...)
 *     → back into applications' policies.
 *
 * The SELECT policy on the same table makes the identical check and does NOT
 * recurse, because it goes through `is_active_assignee()` — SECURITY DEFINER,
 * so the inner read runs without RLS. The helper was introduced for exactly
 * this reason and the SELECT policy converted; the UPDATE policy kept its
 * inline EXISTS, and a later migration carried it forward verbatim.
 *
 * WHY THE ASSERTION IS ABOUT BEHAVIOUR, NOT ABOUT THE POLICY TEXT
 *
 * Asserting "the policy body does not contain the substring consultant_assignments"
 * would pass for any number of new ways to build the same cycle, and fail on a
 * correct policy that merely mentions the table. Recursion is a property of
 * what the predicates DO. So this performs the write, under RLS, as the owner —
 * the operation the applicant actually performs — and rolls it back.
 *
 * Requires a live Supabase (the local disposable stack is fine). GATED on env
 * so the default `pnpm test` stays green without a database:
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx jest applications-update-rls
 */
const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

describeIf('applications UPDATE under RLS', () => {
  jest.setTimeout(45_000);

  let admin: SupabaseClient;
  let userId: string;
  let applicationId: string;
  let ownerToken: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // A throwaway owner. The email is randomised so repeated runs do not
    // collide, and the row is removed in afterAll.
    const email = `rls-update-${Date.now()}@example.test`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        email_confirm: true,
      });
    if (createErr || !created?.user) throw createErr ?? new Error('no user');
    userId = created.user.id;

    const { data: app, error: appErr } = await admin
      .from('applications')
      .insert({ user_id: userId, destination_country: 'CA' })
      .select('id')
      .single();
    if (appErr || !app) throw appErr ?? new Error('no application');
    applicationId = app.id as string;

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkErr) throw linkErr;
    // The generated link carries a session for that user; its access token is
    // what makes the request run under the owner's RLS scope rather than the
    // service role's (which bypasses RLS and would prove nothing).
    const token = (
      link as unknown as {
        properties?: { hashed_token?: string };
      }
    )?.properties?.hashed_token;
    const verified = await admin.auth.verifyOtp({
      type: 'magiclink',
      token_hash: token!,
    });
    ownerToken = verified.data.session?.access_token ?? '';
    if (!ownerToken) throw new Error('could not mint an owner session');
  });

  afterAll(async () => {
    if (applicationId)
      await admin.from('applications').delete().eq('id', applicationId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  function asOwner(): SupabaseClient {
    return createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${ownerToken}` } },
    });
  }

  it('lets the owner update their own row without recursing', async () => {
    const { error } = await asOwner()
      .from('applications')
      .update({ destination_state: 'Ontario' })
      .eq('id', applicationId)
      .eq('user_id', userId);

    // The failure this guards reads:
    //   infinite recursion detected in policy for relation "applications"
    expect(error?.message ?? null).toBeNull();
  });

  it('actually wrote the value, rather than matching zero rows', async () => {
    // RLS filtering a row out is NOT an error in PostgREST — it is a silent
    // no-op. A test that only asserted "no error" would pass on a policy that
    // denied every owner.
    const { data } = await admin
      .from('applications')
      .select('destination_state')
      .eq('id', applicationId)
      .single();
    expect(data?.destination_state).toBe('Ontario');
  });

  it('still refuses an update from someone who does not own the row', async () => {
    // The fix must not have widened the policy into letting anyone write.
    const stranger = await admin.auth.admin.createUser({
      email: `rls-stranger-${Date.now()}@example.test`,
      password: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      email_confirm: true,
    });
    const strangerId = stranger.data.user!.id;
    try {
      const { data: link } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: stranger.data.user!.email!,
      });
      const hash = (
        link as unknown as {
          properties?: { hashed_token?: string };
        }
      )?.properties?.hashed_token;

      // Redeem the link on a SEPARATE client.
      //
      // `verifyOtp` signs the client it is called on IN. Calling it on `admin`
      // replaced the service-role Authorization header with the stranger's
      // JWT, so the verification read at the end of this test ran as the
      // stranger — who correctly cannot see the row — and the assertion got
      // `undefined` rather than 'Ontario'. The test then failed while RLS was
      // working exactly as intended.
      //
      // It is invisible in the owner case above (an owner CAN see the row),
      // which is why only this test failed.
      const otpClient = createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const verified = await otpClient.auth.verifyOtp({
        type: 'magiclink',
        token_hash: hash!,
      });
      const token = verified.data.session!.access_token;

      const db = createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      await db
        .from('applications')
        .update({ destination_state: 'Quebec' })
        .eq('id', applicationId);

      const { data } = await admin
        .from('applications')
        .select('destination_state')
        .eq('id', applicationId)
        .single();
      expect(data?.destination_state).toBe('Ontario');
    } finally {
      await admin.auth.admin.deleteUser(strangerId);
    }
  });
});
