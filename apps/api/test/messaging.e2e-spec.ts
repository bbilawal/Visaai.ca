/**
 * E2E: user posts a question, consultant replies, user marks resolved.
 * Boots the Nest app over a live Supabase; gated on SUPABASE_* + run via the
 * e2e jest config. Skipped otherwise.
 *
 * Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
 *      npx jest --config ./test/jest-e2e.json messaging
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

describeIf('Messaging e2e', () => {
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
  const PASSWORD = 'Test-Passw0rd!e2e';
  const owner = { id: '', email: `e2e-owner-${stamp}@example.com`, token: '' };
  const consultant = {
    id: '',
    email: `e2e-consultant-${stamp}@example.com`,
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
    // public.users extends auth.users — seed it (consultant_assignments references it).
    await admin.from('users').insert({ id: u.id, email: u.email });
    const signedIn = await createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).auth.signInWithPassword({ email: u.email, password: PASSWORD });
    u.token = signedIn.data.session!.access_token;
  }

  beforeAll(async () => {
    // Boot the NestJS app first (parallel with seeding is fine but sequential
    // here for clarity — the e2e suite only runs when SUPABASE_* are present).
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

    // Seed users
    await makeUser(owner);
    await makeUser(consultant);

    // Seed an application owned by the owner user
    const appRes = await admin
      .from('applications')
      .insert({ user_id: owner.id, status: 'draft' })
      .select('id')
      .single();
    applicationId = appRes.data!.id as string;

    // Seed an active consultant assignment so JwtGuard resolves consultantRole
    // to 'consultant' via the DB fallback (hasActiveConsultantAssignment).
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
    // Clean up in reverse FK order; deleting auth users cascades to
    // public.users -> applications -> conversations -> messages.
    // We also explicitly delete the assignment first (not cascaded from users
    // since consultant_id references public.users, not the owner's user).
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

  it('user asks, consultant replies, user marks resolved', async () => {
    const http = app.getHttpServer();

    const ask = await request(http)
      .post(`/messaging/${applicationId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ body: 'What documents are missing?', category: 'documents' });
    expect(ask.status).toBe(201);

    const reply = await request(http)
      .post(`/messaging/${applicationId}/messages`)
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({
        body: 'Please upload your bank statement.',
        category: 'documents',
      });
    expect(reply.status).toBe(201);

    const thread = await request(http)
      .get(`/messaging/${applicationId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages).toHaveLength(2);

    const resolved = await request(http)
      .patch(`/messaging/${applicationId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'resolved' });
    expect(resolved.body.status).toBe('resolved');
  });
});
