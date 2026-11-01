/**
 * P3a e2e: consultant adds an internal note (user cannot read notes), escalates
 * then resolves, and sets consultant_state (user's thread reflects it). Gated +
 * e2e config. Seeds owner + consultant + active consultant_assignments +
 * application via the admin client (mirrors messaging.e2e-spec.ts). Skips
 * cleanly without SUPABASE_* env.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const CONFIGURED = Boolean(SUPABASE_URL && SERVICE_KEY && ANON_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

describeIf('Messaging P3a e2e', () => {
  jest.setTimeout(60_000);

  const admin = CONFIGURED
    ? createClient(SUPABASE_URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as unknown as SupabaseClient);

  let app: INestApplication;
  let ownerToken = '';
  let consultantToken = '';
  let applicationId = '';

  const stamp = Date.now();
  const PASSWORD = 'Test-Passw0rd!p3ae2e';
  const owner = {
    id: '',
    email: `p3a-e2e-owner-${stamp}@example.com`,
    token: '',
  };
  const consultant = {
    id: '',
    email: `p3a-e2e-consultant-${stamp}@example.com`,
    token: '',
  };
  let assignmentId = '';

  async function makeUser(u: { id: string; email: string; token: string }) {
    const created = await admin.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
    });
    u.id = created.data.user!.id;
    await admin.from('users').insert({ id: u.id, email: u.email });
    const signedIn = await createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).auth.signInWithPassword({ email: u.email, password: PASSWORD });
    u.token = signedIn.data.session!.access_token;
  }

  beforeAll(async () => {
    // Loaded here, not at the top: evaluating AppModule runs env validation,
    // which throws without SUPABASE_* and used to crash the Jest worker even
    // though this suite is skipped in exactly that case.
    type AppModuleExports = typeof import('../src/app.module');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred, see above
    const { AppModule } = require('../src/app.module') as AppModuleExports;
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();

    await makeUser(owner);
    await makeUser(consultant);

    const appRes = await admin
      .from('applications')
      .insert({ user_id: owner.id, status: 'draft' })
      .select('id')
      .single();
    applicationId = appRes.data!.id as string;

    const assignRes = await admin
      .from('consultant_assignments')
      .insert({
        application_id: applicationId,
        consultant_id: consultant.id,
        status: 'active',
      })
      .select('id')
      .single();
    assignmentId = assignRes.data!.id as string;

    ownerToken = owner.token;
    consultantToken = consultant.token;
  });

  afterAll(async () => {
    await app?.close();
    if (assignmentId) {
      await admin
        .from('consultant_assignments')
        .delete()
        .eq('id', assignmentId)
        .then(
          () => {},
          () => {},
        );
    }
    if (owner.id)
      await admin.auth.admin.deleteUser(owner.id).then(
        () => {},
        () => {},
      );
    if (consultant.id)
      await admin.auth.admin.deleteUser(consultant.id).then(
        () => {},
        () => {},
      );
  });

  it('consultant note is hidden from the user; escalate+resolve; set state', async () => {
    const http = app.getHttpServer();

    const note = await request(http)
      .post(`/messaging/${applicationId}/notes`)
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({ body: 'internal: applicant seems high risk' });
    expect(note.status).toBe(201);

    // User listing notes is forbidden (staff-only).
    const userNotes = await request(http)
      .get(`/messaging/${applicationId}/notes`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(userNotes.status).toBe(403);

    const esc = await request(http)
      .post(`/messaging/${applicationId}/escalations`)
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({ type: 'supervisor_review', reason: 'needs a second opinion' });
    expect(esc.status).toBe(201);

    const resolved = await request(http)
      .patch(`/messaging/escalations/${esc.body.id}/resolve`)
      .set('Authorization', `Bearer ${consultantToken}`);
    expect(resolved.body.status).toBe('resolved');

    const state = await request(http)
      .patch(`/messaging/${applicationId}/consultant-state`)
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({ state: 'under_review' });
    expect(state.body.state).toBe('under_review');

    // User reads the thread and sees the consultant_state on the conversation.
    const thread = await request(http)
      .get(`/messaging/${applicationId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(thread.body.conversation.consultant_state).toBe('under_review');

    // User cannot set consultant-state (403).
    const userState = await request(http)
      .patch(`/messaging/${applicationId}/consultant-state`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ state: 'resolved' });
    expect(userState.status).toBe(403);
  });
});
