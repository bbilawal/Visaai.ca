import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AttachmentService } from '../src/modules/messaging/attachment.service';

const conv = {
  id: 'c1',
  application_id: 'app-1',
  status: 'open',
  last_message_at: null,
  created_at: 't',
};
const message = {
  id: 'm1',
  conversation_id: 'c1',
  sender_id: 'owner',
  sender_role: 'user',
  category: 'documents',
  body: 'f.png',
  parent_message_id: null,
  created_at: '2026-06-12T00:00:00.000Z',
  edited_at: null,
  deleted_at: null,
};

function deps() {
  const signed = { signedUrl: 'https://signed/put', token: 'tok', path: '' };
  const storageFrom = {
    createSignedUploadUrl: jest.fn().mockResolvedValue({
      data: { signedUrl: signed.signedUrl, token: signed.token },
      error: null,
    }),
    createSignedUrl: jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://signed/get' },
      error: null,
    }),
    // DB-002: real Supabase storage `list()` always returns metadata. The stub
    // previously omitted it, which is why nothing noticed that confirm was
    // validating the client's declared size/MIME instead of the stored object's.
    list: jest.fn().mockResolvedValue({
      data: [
        {
          name: '1-My_File.png',
          metadata: { size: 1234, mimetype: 'image/png' },
        },
      ],
      error: null,
    }),
  };
  const supabase = {
    admin: { storage: { from: () => storageFrom } },
    forUser: () => ({}),
    // Identity in tests: the rewrite is a no-op unless SUPABASE_PUBLIC_URL
    // differs from SUPABASE_URL, which is the hosted/local case. Its own
    // behaviour is covered in shared/supabase/public-storage-url.spec.ts.
    toPublicStorageUrl: (url: string) => url,
  };
  const messaging = {
    ensureConversation: jest.fn().mockResolvedValue(conv),
    recipientIds: jest.fn().mockResolvedValue(['consultant']),
  };
  const msgRepo = {
    insertMessage: jest.fn().mockResolvedValue(message),
    touchLastMessageAt: jest.fn().mockResolvedValue(undefined),
    insertNotifications: jest.fn().mockResolvedValue(undefined),
    getApplicationParties: jest
      .fn()
      .mockResolvedValue({ ownerId: 'owner', consultantIds: ['consultant'] }),
  };
  const attRepo = {
    insertAttachment: jest.fn().mockResolvedValue({ id: 'at1' }),
    insertVoice: jest.fn().mockResolvedValue({ id: 'v1' }),
    getAttachment: jest.fn().mockResolvedValue({
      id: 'at1',
      storage_path: 'p',
      conversation_id: 'c1',
    }),
    getVoice: jest.fn().mockResolvedValue({ id: 'v1', storage_path: 'pv' }),
  };
  const bus = { emit: jest.fn() };
  return { supabase, messaging, msgRepo, attRepo, bus, storageFrom };
}

describe('AttachmentService', () => {
  it('rejects oversize uploads', async () => {
    const d = deps();
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.createUploadUrl('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
        fileName: 'big.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 26 * 1024 * 1024,
        kind: 'file',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects disallowed mime', async () => {
    const d = deps();
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.createUploadUrl('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
        fileName: 'x.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 10,
        kind: 'file',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('createUploadUrl returns a signed url under the owner/app/messages path', async () => {
    const d = deps();
    d.messaging.recipientIds = jest.fn().mockResolvedValue(['consultant']);
    // owner uid comes from ensureConversation->parties; here service derives path from conv + caller resolved owner.
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    const out = await svc.createUploadUrl(
      'tok',
      { id: 'owner', appRole: 'user' },
      'app-1',
      {
        fileName: 'My File.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        kind: 'image',
      },
    );
    expect(out.uploadUrl).toBe('https://signed/put');
    expect(out.storagePath).toContain('/app-1/messages/c1/');
    expect(out.storagePath).toMatch(/My_File\.png$/);
  });

  it('confirmAttachment creates a message + attachment, notifies, emits', async () => {
    const d = deps();
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    const out = await svc.confirmAttachment(
      'tok',
      { id: 'owner', appRole: 'user' },
      'app-1',
      {
        storagePath: 'owner/app-1/messages/c1/1-My_File.png',
        fileName: 'My_File.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        kind: 'image',
      },
    );
    expect(out.id).toBe('at1');
    expect(d.msgRepo.insertMessage).toHaveBeenCalled();
    expect(d.attRepo.insertAttachment).toHaveBeenCalled();
    expect(d.msgRepo.insertNotifications).toHaveBeenCalled();
    expect(d.bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'attachment.created' }),
    );
  });

  it('getDownloadUrl returns a signed GET url for a visible attachment', async () => {
    const d = deps();
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    const out = await svc.getDownloadUrl(
      'tok',
      { id: 'owner', appRole: 'user' },
      'at1',
    );
    expect(out.url).toBe('https://signed/get');
  });

  it('getDownloadUrl 404s when attachment not visible', async () => {
    const d = deps();
    d.attRepo.getAttachment = jest.fn().mockResolvedValue(null);
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.getDownloadUrl('tok', { id: 'x', appRole: 'user' }, 'nope'),
    ).rejects.toThrow(NotFoundException);
  });

  // SEC-3050 / SEC-3005: confirm must not accept a storagePath outside the
  // caller's own conversation folder, or an attacker could staple another
  // tenant's private document onto their own conversation and download it.
  it('confirmAttachment rejects a storagePath in another tenant folder', async () => {
    const d = deps();
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.confirmAttachment('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
        storagePath: 'victim-user/app-9/messages/c9/1-passport.png',
        fileName: 'passport.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        kind: 'image',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(d.attRepo.insertAttachment).not.toHaveBeenCalled();
  });

  it('confirmAttachment rejects a traversal storagePath', async () => {
    const d = deps();
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.confirmAttachment('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
        storagePath: 'owner/app-1/messages/c1/../../../victim/secret.png',
        fileName: 'secret.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        kind: 'image',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('confirmVoice rejects a storagePath in another tenant folder', async () => {
    const d = deps();
    const svc = new AttachmentService(
      d.attRepo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.confirmVoice('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
        storagePath: 'victim-user/app-9/messages/c9/1-voice.webm',
        mimeType: 'audio/webm',
        durationMs: 1000,
        sizeBytes: 100,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(d.attRepo.insertVoice).not.toHaveBeenCalled();
  });
});
