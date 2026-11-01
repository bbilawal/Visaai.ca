/**
 * P2 e2e: consultant creates a document request, user fulfills with an
 * attachment, consultant moves under_review then approves. Gated + e2e config.
 * Reuse the fixture-seeding block from messaging.e2e-spec.ts (owner, consultant
 * with an active consultant_assignments row, application -> ownerToken,
 * consultantToken, applicationId). Storage upload is exercised against the live
 * bucket when env present; the test confirms the attachment row + request flow.
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

describeIf('Messaging P2 e2e', () => {
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
  const PASSWORD = 'Test-Passw0rd!p2e2e';
  const owner = {
    id: '',
    email: `p2e2e-owner-${stamp}@example.com`,
    token: '',
  };
  const consultant = {
    id: '',
    email: `p2e2e-consultant-${stamp}@example.com`,
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

  it('document request lifecycle: create -> fulfill -> under_review -> approved', async () => {
    const http = app.getHttpServer();

    const created = await request(http)
      .post(`/messaging/${applicationId}/document-requests`)
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({
        documentType: 'bank_statement',
        label: 'Bank statement',
        priority: 'high',
      });
    expect(created.status).toBe(201);
    const requestId = created.body.id as string;

    // Owner uploads a small attachment: get signed url -> PUT -> confirm.
    const urlRes = await request(http)
      .post(`/messaging/${applicationId}/attachments/upload-url`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        fileName: 'statement.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4,
        kind: 'file',
      });
    expect(urlRes.status).toBe(201);
    await fetch(urlRes.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: Buffer.from('PDF!'),
    });
    const confirmed = await request(http)
      .post(`/messaging/${applicationId}/attachments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storagePath: urlRes.body.storagePath,
        fileName: 'statement.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4,
        kind: 'file',
      });
    expect(confirmed.status).toBe(201);

    const fulfilled = await request(http)
      .post(`/messaging/document-requests/${requestId}/fulfill`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ attachmentId: confirmed.body.id });
    expect(fulfilled.body.status).toBe('submitted');

    const review = await request(http)
      .patch(`/messaging/document-requests/${requestId}/status`)
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({ status: 'under_review' });
    expect(review.body.status).toBe('under_review');

    const approved = await request(http)
      .patch(`/messaging/document-requests/${requestId}/status`)
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({ status: 'approved' });
    expect(approved.body.status).toBe('approved');
  });
});
