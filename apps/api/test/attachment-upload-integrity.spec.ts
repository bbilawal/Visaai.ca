import { BadRequestException } from '@nestjs/common';
import type { AttachmentKind } from '@visaai/types';
import { AttachmentService } from '../src/modules/messaging/attachment.service';

/**
 * DB-002 regression cover.
 *
 * Attachments are uploaded CLIENT-DIRECT to Supabase storage through a signed
 * URL, and the `documents` bucket carries neither `file_size_limit` nor
 * `allowed_mime_types`. So the only thing standing between a caller and an
 * arbitrary object in the bucket is what the server checks at confirm time.
 *
 * It used to check the size and MIME the CLIENT DECLARED, and then record those
 * declared values in the database. A caller could say "image/png, 1 KB", upload
 * a 500 MB executable to the signed URL, and have it stored and indexed as a
 * small PNG.
 *
 * The metadata was always available — `list()` returns it — it just was not
 * compared. These tests pin that it is.
 */

const MB = 1024 * 1024;

function makeService(objectMetadata: Record<string, unknown> | undefined) {
  const storageFrom = {
    createSignedUploadUrl: jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://signed/put', token: 't' },
      error: null,
    }),
    createSignedUrl: jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://signed/get' },
      error: null,
    }),
    list: jest.fn().mockResolvedValue({
      data: [
        {
          name: 'obj.png',
          ...(objectMetadata ? { metadata: objectMetadata } : {}),
        },
      ],
      error: null,
    }),
  };
  const insertAttachment = jest.fn().mockResolvedValue({ id: 'att-1' });
  // Constructor order: (attRepo, msgRepo, messaging, bus, supabase).
  const svc = new AttachmentService(
    {
      insertAttachment,
      insertVoice: jest.fn().mockResolvedValue({ id: 'v1' }),
    } as never,
    {
      getApplicationParties: jest
        .fn()
        .mockResolvedValue({ ownerId: 'u1', consultantIds: [] }),
      insertMessage: jest.fn().mockResolvedValue({ id: 'm1', created_at: 't' }),
      touchLastMessageAt: jest.fn().mockResolvedValue(undefined),
      insertNotifications: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      ensureConversation: jest.fn().mockResolvedValue({ id: 'c1' }),
      recipientIds: jest.fn().mockResolvedValue([]),
    } as never,
    { emit: jest.fn() } as never,
    {
      admin: { storage: { from: () => storageFrom } },
      forUser: () => ({}),
    } as never,
  );
  return { svc, insertAttachment, storageFrom };
}

const caller = { id: 'u1', appRole: 'user' } as never;
const declare = (over: Partial<Record<string, unknown>> = {}) => ({
  storagePath: 'u1/app-1/messages/c1/obj.png',
  fileName: 'obj.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
  kind: 'file' as AttachmentKind,
  ...over,
});

describe('DB-002 — confirm measures the stored object, not the client claim', () => {
  it('accepts an upload whose real metadata is within limits', async () => {
    const { svc, insertAttachment } = makeService({
      size: 2048,
      mimetype: 'image/png',
    });
    await svc.confirmAttachment('tok', caller, 'app-1', declare());
    expect(insertAttachment).toHaveBeenCalled();
  });

  it('persists the MEASURED size and type, not the declared ones', async () => {
    const { svc, insertAttachment } = makeService({
      size: 5000,
      mimetype: 'image/jpeg',
    });
    await svc.confirmAttachment(
      'tok',
      caller,
      'app-1',
      declare({ sizeBytes: 1, mimeType: 'image/png' }),
    );
    expect(insertAttachment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sizeBytes: 5000, mimeType: 'image/jpeg' }),
    );
  });

  it('rejects a small declared size hiding a large real upload', async () => {
    // The attack: declare 1 KB, upload 500 MB. The bucket has no size limit.
    const { svc, insertAttachment } = makeService({
      size: 500 * MB,
      mimetype: 'image/png',
    });
    await expect(
      svc.confirmAttachment(
        'tok',
        caller,
        'app-1',
        declare({ sizeBytes: 1024 }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(insertAttachment).not.toHaveBeenCalled();
  });

  it('rejects a disallowed real content type declared as an image', async () => {
    const { svc, insertAttachment } = makeService({
      size: 2048,
      mimetype: 'application/x-msdownload',
    });
    await expect(
      svc.confirmAttachment(
        'tok',
        caller,
        'app-1',
        declare({ mimeType: 'image/png' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(insertAttachment).not.toHaveBeenCalled();
  });

  it('fails CLOSED when storage reports no size rather than trusting the client', async () => {
    const { svc, insertAttachment } = makeService(undefined);
    await expect(
      svc.confirmAttachment('tok', caller, 'app-1', declare()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(insertAttachment).not.toHaveBeenCalled();
  });

  it('applies the same measurement to voice uploads', async () => {
    const { svc } = makeService({ size: 500 * MB, mimetype: 'audio/webm' });
    await expect(
      svc.confirmVoice('tok', caller, 'app-1', {
        storagePath: 'u1/app-1/messages/c1/obj.png',
        mimeType: 'audio/webm',
        durationMs: 1000,
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
