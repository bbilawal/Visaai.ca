import { DocumentsService } from './documents.service';
import { makeFakeDb } from './family-gaps/__fixtures__/fake-db';

/**
 * Upload-time auto-match for a file with no slot (prod 2026-10-24): the
 * `passport%` prefix also matched the `passport_photos` slot, and a photo
 * (`photo`) prefix-matched no photo slot at all.
 */
function setup(items: Array<{ id: string; document_type: string }>) {
  const fake = makeFakeDb({
    applications: [{ id: 'app-1', user_id: 'owner-1' }],
    checklist_items: items.map((i) => ({
      ...i,
      application_id: 'app-1',
      status: 'missing',
    })),
    documents: [],
    document_access_logs: [],
  });
  const queue = { add: jest.fn(() => Promise.resolve({ id: 'job' })) };
  const svc = new DocumentsService(
    { admin: fake.client } as never,
    {} as never,
    queue as never,
  );
  const register = (fileName: string) =>
    svc.registerUploadedDocument(fake.client, {
      applicationId: 'app-1',
      userId: 'owner-1',
      storagePath: `owner-1/app-1/${fileName}`,
      mimeType: 'image/jpeg',
      fileName,
    });
  const linkedTo = () => fake.tables.documents[0]?.checklist_item_id;
  return { register, linkedTo };
}

describe('registerUploadedDocument — photo slots', () => {
  it('files a photo into the passport_photos slot', async () => {
    const { register, linkedTo } = setup([
      { id: 'i-pass', document_type: 'passport_copy' },
      { id: 'i-photo', document_type: 'passport_photos' },
    ]);
    await register('passport photo.jpg');
    expect(linkedTo()).toBe('i-photo');
  });

  it('never files a photo into a relationship photo slot', async () => {
    const { register, linkedTo } = setup([
      { id: 'i-wed', document_type: 'wedding_photos' },
      { id: 'i-tog', document_type: 'photos_together' },
    ]);
    await register('photo.jpg');
    expect(linkedTo()).toBeNull();
  });

  it('leaves a photo unlinked when two applicant-photo slots are missing', async () => {
    const { register, linkedTo } = setup([
      { id: 'i-a', document_type: 'passport_photos' },
      { id: 'i-b', document_type: 'digital_photo' },
    ]);
    await register('passport photo.jpg');
    expect(linkedTo()).toBeNull();
  });

  it('files a photo into the one applicant-photo slot beside relationship ones', async () => {
    const { register, linkedTo } = setup([
      { id: 'i-wed', document_type: 'wedding_photos' },
      { id: 'i-photo', document_type: 'passport_photos' },
      { id: 'i-tog', document_type: 'photos_together' },
    ]);
    await register('photo.jpg');
    expect(linkedTo()).toBe('i-photo');
  });

  it('never files a passport into the passport_photos slot', async () => {
    const { register, linkedTo } = setup([
      { id: 'i-photo', document_type: 'passport_photos' },
    ]);
    await register('passport.jpg');
    expect(linkedTo()).toBeNull();
  });

  it('still files a passport into a prefixed passport slot', async () => {
    const { register, linkedTo } = setup([
      { id: 'i-photo', document_type: 'passport_photos' },
      { id: 'i-pass', document_type: 'passport_copy' },
    ]);
    await register('passport.jpg');
    expect(linkedTo()).toBe('i-pass');
  });
});
