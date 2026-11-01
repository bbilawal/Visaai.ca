import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { makeFakeDb } from './family-gaps/__fixtures__/fake-db';
import type { AuthUser } from '../auth/jwt.guard';

/**
 * POST /documents/item/:documentId/confirm-holder — "This is my passport".
 *
 * A passport whose name shares nothing with the name the applicant gave is
 * held (needs_confirmation) until confirmed. The applicant can confirm it
 * themselves: an append-only document_holder_confirmations row (the audit
 * trail the consultant sees), then an immediate re-sync of the profile.
 */
const passport = {
  full_name: 'QUEBEC ZULU',
  given_name: 'QUEBEC',
  family_name: 'ZULU',
  passport_number: 'XQ0000001',
  date_of_birth: '1970-01-01',
};

function setup(mismatch: Record<string, unknown> | null) {
  const fake = makeFakeDb({
    documents: [
      {
        id: 'doc-1',
        application_id: 'app-1',
        document_type: 'passport',
        checklist_item_id: 'item-1',
      },
    ],
    applications: [{ id: 'app-1', user_id: 'owner-1' }],
    checklist_items: [
      {
        id: 'item-1',
        application_id: 'app-1',
        document_type: 'passport',
        meta: { owner: 'applicant' },
      },
    ],
    application_profiles: [
      {
        application_id: 'app-1',
        profile_json: { given_name: 'Romeo Sierra', family_name: 'Kilo' },
      },
    ],
    document_verifications: [
      {
        id: 'ver-1',
        document_id: 'doc-1',
        verification_type: 'identity',
        result: 'pass',
        verified_at: '2026-10-30T09:00:00Z',
        details_json: {
          extracted_fields: passport,
          ...(mismatch
            ? {
                holder_mismatch: {
                  holder: 'QUEBEC ZULU',
                  applicant: 'Romeo Sierra Kilo',
                  message: 'confirm',
                  ...mismatch,
                },
              }
            : {}),
        },
      },
    ],
    application_item_reviews: [],
    document_holder_confirmations: [],
  });
  const svc = new DocumentsService(
    { admin: fake.client } as never,
    {} as never,
    {} as never,
  );
  return { svc, fake };
}

const owner = { id: 'owner-1', appRole: 'user' } as AuthUser;

describe('DocumentsService.confirmHolder', () => {
  it('records the confirmation and re-syncs the profile from the passport', async () => {
    const { svc, fake } = setup({ needs_confirmation: true });

    const res = await svc.confirmHolder(fake.client, 'doc-1', owner);

    expect(res).toEqual({ documentId: 'doc-1', confirmed: true });
    expect(fake.tables.document_holder_confirmations).toEqual([
      expect.objectContaining({
        document_id: 'doc-1',
        application_id: 'app-1',
        confirmed_by: 'owner-1',
        holder_name: 'QUEBEC ZULU',
        stated_name: 'Romeo Sierra Kilo',
      }),
    ]);
    const profile = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(profile).toMatchObject({
      given_name: 'QUEBEC',
      family_name: 'ZULU',
      passport_number: 'XQ0000001',
    });
    expect(profile.other_names).toEqual([
      expect.objectContaining({
        given_name: 'Romeo Sierra',
        family_name: 'Kilo',
      }),
    ]);
    const details = fake.tables.document_verifications[0]
      .details_json as Record<string, unknown>;
    expect(details.holder_mismatch).toBeUndefined();
    expect(details.holder_confirmation).toMatchObject({
      holder: 'QUEBEC ZULU',
      stated_name: 'Romeo Sierra Kilo',
    });
  });

  it('refuses a document that is clearly someone else', async () => {
    const { svc, fake } = setup({ clearly_other: true });
    await expect(
      svc.confirmHolder(fake.client, 'doc-1', owner),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fake.tables.document_holder_confirmations).toEqual([]);
  });

  it('refuses a document that is not held', async () => {
    const { svc, fake } = setup(null);
    await expect(
      svc.confirmHolder(fake.client, 'doc-1', owner),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fake.tables.document_holder_confirmations).toEqual([]);
  });

  it('only the applicant who owns the application may confirm', async () => {
    const { svc, fake } = setup({ needs_confirmation: true });
    const consultant = { id: 'consultant-1', appRole: 'user' } as AuthUser;
    await expect(
      svc.confirmHolder(fake.client, 'doc-1', consultant),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fake.tables.document_holder_confirmations).toEqual([]);
  });

  it('a confirmation that cannot be recorded (table not migrated yet) is a clean 503, and nothing is re-synced', async () => {
    const { svc, fake } = setup({ needs_confirmation: true });
    const realFrom = fake.client.from.bind(fake.client);
    const db = {
      ...fake.client,
      from: (t: string) =>
        t === 'document_holder_confirmations'
          ? {
              insert: () =>
                Promise.resolve({
                  data: null,
                  error: {
                    message:
                      'relation "public.document_holder_confirmations" does not exist',
                  },
                }),
            }
          : realFrom(t),
    };
    const broken = new DocumentsService(
      { admin: db } as never,
      {} as never,
      {} as never,
    );
    void svc;
    const err = await broken
      .confirmHolder(fake.client, 'doc-1', owner)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).not.toMatch(/relation/);
    const profile = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(profile.passport_number).toBeUndefined();
  });
});
