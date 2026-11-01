import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import {
  isApplicantPhotoType,
  isIdentityDocumentType,
  isPhotoDocumentType,
  resolveExtractionType,
} from '../../ocr/extraction-schema';
import { resolveExpiryPolicy } from '../expiry-policy';
import { isPassportType, slotContentMismatch } from './classify-document';
import { identityRole } from './identity-compare';
import { makeClassifyDocumentNode } from './classify-document.node';
import { makeEvaluateExpiryNode } from './evaluate-expiry';
import { makeSyncChecklistNode } from './sync-checklist';
import { makeSyncProfileNode, mergeExtractedIntoProfile } from './sync-profile';
import { planOrphanLinks } from '../../slot-link';
import { inferDocumentType } from '../../documents.service';

/**
 * Prod 2026-10-24 (Canada study permit, registry slot `passport_photos`): the
 * applicant's photo was run through the passport checks because the type
 * starts with `passport_`. It got `identity` fail (no fields — a photo has
 * none) and `expiry` warn under the passport policy ("expiry date could not
 * be read"), so its slot stayed `uploaded` and the Documents stage never
 * completed.
 */
const PHOTO_TYPES = [
  'passport_photo',
  'passport_photos',
  'photo',
  'photos',
  'digital_photo',
  'applicant_photo',
  'applicant_photograph',
  'passport_size_picture',
];

// Photos of something other than an identity document stay photos.
const OTHER_PHOTO_TYPES = [
  'photographs_of_relationship',
  'photos_of_you_together',
  'photos_together',
  'wedding_photos',
  'sponsor_photo',
];

const BIO_PAGE = `PASSPORT
P<PAKAHMAD<<MUZAFFAR<<<<<<<<<<<<<<<<<<<<<<<<<
AB12345670PAK6106155M3001019<<<<<<<<<<<<<<02`;

const PASSPORT_TYPES = [
  'passport',
  'passport_copy',
  'passport_biographic_page',
  'passport_bio_page',
];

describe('photo slots are not passports (prod 2026-10-24)', () => {
  it.each(PHOTO_TYPES)('%s is a photo, not an identity document', (t) => {
    expect(isPhotoDocumentType(t)).toBe(true);
    expect(resolveExtractionType(t)).toBeNull();
    expect(isIdentityDocumentType(t)).toBe(false);
    expect(isPassportType(t)).toBe(false);
    expect(identityRole(t)).toBe('supporting');
    const policy = resolveExpiryPolicy(t);
    expect(policy.id).toBe('default');
    expect(policy.requiresExpiry).toBe(false);
  });

  it.each(OTHER_PHOTO_TYPES)(
    '%s is a photo, but not the applicant photo',
    (t) => {
      expect(isPhotoDocumentType(t)).toBe(true);
      expect(isApplicantPhotoType(t)).toBe(false);
      expect(resolveExpiryPolicy(t).id).toBe('default');
    },
  );

  it.each([
    'photo',
    'photos',
    'passport_photo',
    'passport_photos',
    'passport_photograph',
    'passport_photographs',
    'digital_photo',
    'digital_photos',
    'applicant_photo',
    'applicant_photos',
  ])('%s is the applicant photo', (t) => {
    expect(isApplicantPhotoType(t)).toBe(true);
  });

  it.each(PASSPORT_TYPES)('%s still behaves as a passport', (t) => {
    expect(isPhotoDocumentType(t)).toBe(false);
    expect(resolveExtractionType(t)).toBe('passport');
    expect(isIdentityDocumentType(t)).toBe(true);
    expect(isPassportType(t)).toBe(true);
    expect(identityRole(t)).toBe('identity');
    expect(resolveExpiryPolicy(t).id).toBe('passport');
  });

  // Review of #290: a substring match made every one of these a "photo", and a
  // correct bio page in a `passport_photo_page` slot failed as a mismatch.
  // [type, resolveExtractionType, isPassportType, identityRole, expiry policy]
  // — each as it was before #290.
  it.each([
    ['passport_photo_page', 'passport', true, 'identity', 'passport'],
    ['passport_photo_page_copy', 'passport', true, 'identity', 'passport'],
    ['passport_photocopy', 'passport', true, 'identity', 'passport'],
    ['national_id_with_photo', 'national_id', false, 'identity', 'national_id'],
    ['cnic_photo', 'national_id', false, 'identity', 'national_id'],
    ['photo_of_cnic', 'national_id', false, 'supporting', 'national_id'],
    ['photo_page', null, false, 'supporting', 'default'],
    ['photographic_id', null, false, 'supporting', 'default'],
    ['photograph_id', null, false, 'supporting', 'default'],
    ['photo_id', null, false, 'supporting', 'default'],
    ['photo_ids', null, false, 'supporting', 'default'],
    ['photo_identification', null, false, 'supporting', 'default'],
    // Re-review of #290: a "photo copy" is a photocopy.
    ['passport_photo_copy', 'passport', true, 'identity', 'passport'],
    ['passport_photo_copies', 'passport', true, 'identity', 'passport'],
    ['photo_stat_cnic', 'national_id', false, 'supporting', 'national_id'],
    ['photo_of_passport', 'passport', false, 'supporting', 'passport'],
    ['picture_id', null, false, 'supporting', 'default'],
    ['id_with_picture', null, false, 'supporting', 'default'],
    ['photocard_driving_licence', null, false, 'supporting', 'default'],
    ['photo_card', null, false, 'supporting', 'default'],
  ])('%s is not a photograph slot', (t, schema, passport, role, policy) => {
    expect(isPhotoDocumentType(t)).toBe(false);
    expect(resolveExtractionType(t)).toBe(schema);
    expect(isPassportType(t)).toBe(passport);
    expect(identityRole(t)).toBe(role);
    expect(resolveExpiryPolicy(t).id).toBe(policy);
  });

  it('accepts a bio page in a passport_photo_page slot', () => {
    expect(slotContentMismatch('passport_photo_page', BIO_PAGE)).toBeNull();
  });

  it('still rejects a passport bio page dropped into the photo slot', () => {
    expect(slotContentMismatch('passport_photos', BIO_PAGE)).toMatchObject({
      expected: 'passport_photos',
      detected: 'passport',
    });
  });

  it('copies no passport fields into the profile from a photo', () => {
    const { result } = mergeExtractedIntoProfile(
      {},
      { issue_date: '2024-01-01', expiry_date: '2034-01-01' },
      'passport_photos',
    );
    expect(result.added).not.toContain('passport_issue_date');
    expect(result.added).not.toContain('passport_expiry_date');
    // A real passport still maps them.
    const passport = mergeExtractedIntoProfile(
      {},
      { issue_date: '2024-01-01', expiry_date: '2034-01-01' },
      'passport_copy',
    );
    expect(passport.result.added).toEqual(
      expect.arrayContaining(['passport_issue_date', 'passport_expiry_date']),
    );
  });

  it('sync_profile never touches the profile for a photo', async () => {
    const from = jest.fn();
    const out = await makeSyncProfileNode({
      from,
    } as unknown as SupabaseClient)(
      state({ extractedFields: { full_name: 'PHOTO STUDIO LAHORE' } }),
    );
    expect(out).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('never files an orphan passport into the photo slot, nor a photo into the passport slot', () => {
    const items = [
      {
        id: 'i-photo',
        document_type: 'passport_photos',
        status: 'missing',
        meta: { kind: 'document' },
      },
    ];
    expect(
      planOrphanLinks(
        [{ id: 'd-pass', document_type: 'passport', checklist_item_id: null }],
        items,
      ),
    ).toEqual([]);
    expect(
      planOrphanLinks(
        [{ id: 'd-photo', document_type: 'photo', checklist_item_id: null }],
        [{ ...items[0], id: 'i-pass', document_type: 'passport_copy' }],
      ),
    ).toEqual([]);
  });

  it.each([
    ['passport photo.jpg', 'photo'],
    ['Passport_Photos.png', 'photo'],
    ['passport size photo.jpeg', 'photo'],
    ['photo.jpg', 'photo'],
    ['my pictures.png', 'photo'],
    ['IMG_photo_2.jpg', 'photo'],
    // Review of #290: a photo OF a document is that document.
    ['photo of passport.jpg', 'passport'],
    ['passport photo page.jpg', 'passport'],
    ['passport photocopy.pdf', 'passport'],
    ['passport_bio_page.jpg', 'passport'],
    ['bank statement photo.png', 'bank_statement'],
    ['marriage certificate photo.jpg', 'marriage_certificate'],
    ['passport photo copy.pdf', 'passport'],
    ['passport photo scan.pdf', 'passport'],
    ['cnic photo.jpg', 'document'],
    ['photo ids.jpg', 'document'],
  ])('files %s as %s', (fileName, expected) => {
    expect(inferDocumentType(fileName)).toBe(expected);
  });

  // Re-review of #290: spousal apps also ask for wedding / together photos,
  // and a photo in a photo slot is graded pass.
  const slot = (id: string, document_type: string) => ({
    id,
    document_type,
    status: 'missing',
    meta: { kind: 'document' },
  });

  it('never files the applicant photo into a relationship photo slot', () => {
    expect(
      planOrphanLinks(
        [{ id: 'd-photo', document_type: 'photo', checklist_item_id: null }],
        [slot('i-wed', 'wedding_photos'), slot('i-tog', 'photos_together')],
      ),
    ).toEqual([]);
  });

  it('never files a relationship photo into the passport photo slot', () => {
    expect(
      planOrphanLinks(
        [
          {
            id: 'd-wed',
            document_type: 'wedding_photos',
            checklist_item_id: null,
          },
        ],
        [slot('i-photo', 'passport_photos')],
      ),
    ).toEqual([]);
  });

  it('files a relationship photo into its own slot, by prefix', () => {
    expect(
      planOrphanLinks(
        [
          {
            id: 'd-wed',
            document_type: 'wedding_photos',
            checklist_item_id: null,
          },
        ],
        [slot('i-photo', 'passport_photos'), slot('i-wed', 'wedding_photos_2')],
      ),
    ).toEqual([{ documentId: 'd-wed', itemId: 'i-wed' }]);
  });

  it('files an orphan photo into the photo slot, whatever it is called', () => {
    expect(
      planOrphanLinks(
        [{ id: 'd-photo', document_type: 'photo', checklist_item_id: null }],
        [
          {
            id: 'i-photo',
            document_type: 'passport_photos',
            status: 'missing',
            meta: { kind: 'document' },
          },
        ],
      ),
    ).toEqual([{ documentId: 'd-photo', itemId: 'i-photo' }]);
  });
});

function state(over: Partial<DocumentState> = {}): DocumentState {
  return {
    documentId: 'doc-1',
    applicationId: 'app-1',
    documentType: 'passport_photos',
    rawOcrText: '',
    extractedFields: {},
    verificationResult: 'fail',
    slotMismatch: null,
    error: null,
    ...over,
  } as DocumentState;
}

/** Chainable stub: every query resolves to `data`, and calls are recorded. */
function makeSupabase(checklistItemId: string | null = 'item-1') {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = jest.fn((table: string) => {
    let isSingle = false;
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'update', 'insert', 'eq', 'in', 'is']) {
      builder[m] = jest.fn((...args: unknown[]) => {
        calls.push({ table, op: m, args });
        return builder;
      });
    }
    builder.single = jest.fn(() => {
      isSingle = true;
      return builder;
    });
    builder.maybeSingle = builder.single;
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === 'documents' && isSingle
          ? { data: { checklist_item_id: checklistItemId }, error: null }
          : { data: [], error: null },
      );
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe('a clean photo upload reaches verified (prod 2026-10-24)', () => {
  it('classify_document grades a text-less photo in its slot as pass', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({ mimeType: 'image/jpeg' }),
    );
    expect(out.slotMismatch).toBeNull();
    expect(out.verificationResult).toBe('pass');
  });

  // Review of #290: anything that is not a text-less image in the photo slot
  // is for the consultant to check, never verified.
  it.each([
    ['a PDF', { mimeType: 'application/pdf' }],
    ['a blank PDF', { mimeType: 'application/pdf', rawOcrText: '' }],
    [
      'a page of text',
      { mimeType: 'image/png', rawOcrText: 'This lease agreement '.repeat(20) },
    ],
    [
      'a document with fields',
      {
        mimeType: 'image/jpeg',
        rawOcrText: 'Certificate of birth registration '.repeat(10),
        verificationResult: 'pass' as const,
        extractedFields: { full_name: 'X', date_of_birth: '2000-01-01' },
      },
    ],
  ])('grades %s in the photo slot warn', async (_label, over) => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(state(over));
    expect(out.verificationResult).toBe('warn');
  });

  it('a bio page in the photo slot fails, not passes', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({ rawOcrText: BIO_PAGE }),
    );
    expect(out.slotMismatch).toMatchObject({ detected: 'passport' });
    expect(out.verificationResult).toBe('fail');
  });

  it('a real passport that yielded no fields is still not upgraded', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({ documentType: 'passport_copy' }),
    );
    expect(out.verificationResult).toBeUndefined();
  });

  it('evaluate_expiry writes no expiry row for a photo', async () => {
    const { client, calls } = makeSupabase();
    const out = await makeEvaluateExpiryNode(client)(
      state({ verificationResult: 'pass' }),
    );
    expect(out).toEqual({});
    expect(calls.filter((c) => c.op === 'insert')).toEqual([]);
  });

  it('a passport with no readable expiry still warns under the passport policy', async () => {
    const { client, calls } = makeSupabase();
    await makeEvaluateExpiryNode(client)(
      state({ documentType: 'passport_copy', verificationResult: 'pass' }),
    );
    const insert = calls.find(
      (c) => c.table === 'document_verifications' && c.op === 'insert',
    );
    expect(insert?.args[0]).toMatchObject({
      verification_type: 'expiry',
      result: 'warn',
      details_json: { policy_id: 'passport' },
    });
  });

  it('sync_checklist promotes the photo slot to verified', async () => {
    const { client, calls } = makeSupabase();
    const classified = await makeClassifyDocumentNode(makeSupabase().client)(
      state({ mimeType: 'image/jpeg' }),
    );
    const expiry = await makeEvaluateExpiryNode(makeSupabase().client)(
      state(classified),
    );
    await makeSyncChecklistNode(client)(state({ ...classified, ...expiry }));
    const updates = calls
      .filter((c) => c.table === 'checklist_items' && c.op === 'update')
      .map((c) => c.args[0]);
    expect(updates).toContainEqual({ status: 'verified' });
  });
});
