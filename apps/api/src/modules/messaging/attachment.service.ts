import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { basename } from 'path';
import type {
  AttachmentKind,
  MessageAttachment,
  VoiceMessage,
  SignedUploadResult,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { MessagingService, type MessagingCaller } from './messaging.service';
import { MessagingEventBus } from './messaging-event-bus';
import {
  MESSAGING_REPOSITORY,
  type IMessagingRepository,
} from './messaging.repository';
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from './attachment.repository';

const BUCKET = 'documents';
const MAX_BYTES = 25 * 1024 * 1024;
const SIGN_TTL = 300; // 5 min
const FILE_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
]);
const VOICE_MIMES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg']);

function safeName(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class AttachmentService {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY)
    private readonly attRepo: IAttachmentRepository,
    @Inject(MESSAGING_REPOSITORY)
    private readonly msgRepo: IMessagingRepository,
    private readonly messaging: MessagingService,
    private readonly bus: MessagingEventBus,
    private readonly supabase: SupabaseService,
  ) {}

  /** Reject oversize / disallowed-mime uploads. Enforced at BOTH upload-url and
   *  confirm steps — confirm is a separate endpoint and must not trust the client. */
  private assertAllowed(
    kind: AttachmentKind | 'voice',
    mimeType: string,
    sizeBytes: number,
  ): void {
    if (sizeBytes > MAX_BYTES) {
      throw new BadRequestException(
        `File exceeds ${MAX_BYTES / (1024 * 1024)}MB limit`,
      );
    }
    const allowed = kind === 'voice' ? VOICE_MIMES : FILE_MIMES;
    if (!allowed.has(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
  }

  /** Resolve the conversation (lazily create) + the storage folder owner uid. */
  private async resolveTarget(token: string, applicationId: string) {
    const conversation = await this.messaging.ensureConversation(
      token,
      applicationId,
    );
    const parties = await this.msgRepo.getApplicationParties(
      this.supabase.admin,
      applicationId,
    );
    if (!parties.ownerId) {
      // Owner is the storage path's first segment; a null owner would write a
      // corrupt `unknown/...` path. Applications always have an owner, so this
      // signals a data/consistency problem — fail loudly rather than store junk.
      throw new BadRequestException('Application owner not found');
    }
    return { conversation, ownerUserId: parties.ownerId };
  }

  async createUploadUrl(
    token: string,
    _caller: MessagingCaller,
    applicationId: string,
    input: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      kind: AttachmentKind | 'voice';
    },
  ): Promise<SignedUploadResult> {
    this.assertAllowed(input.kind, input.mimeType, input.sizeBytes);
    const { conversation, ownerUserId } = await this.resolveTarget(
      token,
      applicationId,
    );
    const path = `${ownerUserId}/${applicationId}/messages/${conversation.id}/${Date.now()}-${safeName(input.fileName)}`;
    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data)
      throw new BadRequestException(
        `Failed to create upload URL: ${error?.message}`,
      );
    // Rewritten for the browser — see SupabaseService.toPublicStorageUrl. The
    // raw value is built from the loopback Kong base and is unreachable from a
    // customer's machine.
    return {
      uploadUrl: this.supabase.toPublicStorageUrl(data.signedUrl),
      storagePath: path,
      token: data.token,
    };
  }

  /**
   * Confirm a finished upload: the object must exist AND its ACTUAL size and
   * content type must satisfy the same limits.
   *
   * DB-002: this previously only checked existence, while `assertAllowed` ran
   * against the size and MIME the CLIENT declared. Because uploads go straight
   * to storage through a signed URL, and the bucket carries neither
   * `file_size_limit` nor `allowed_mime_types`, nothing measured the real file:
   * a caller could declare `image/png, 1 KB`, upload an arbitrarily large
   * executable, and have the declared values recorded in the database.
   *
   * `list()` already returns the true metadata — it simply was not compared.
   * Returns the measured values so callers persist what is actually stored
   * rather than what was claimed.
   */
  /**
   * SEC-3050 (cross-tenant document read): `confirm*` accepts a client-supplied
   * `storagePath`. Existence is validated with the service-role client, which
   * bypasses storage ownership, and `getDownloadUrl` later signs the STORED path
   * with the same service-role client — so any path an attacker manages to
   * persist onto their own attachment row becomes readable. Without this check a
   * caller could staple ANY object in the bucket (another tenant's passport
   * scan) onto their own conversation and download it. Bind the path to the
   * caller's own conversation folder, exactly matching `createUploadUrl`.
   */
  private assertPathOwnedBy(
    storagePath: string,
    ownerUserId: string,
    applicationId: string,
    conversationId: string,
  ): void {
    const expectedPrefix = `${ownerUserId}/${applicationId}/messages/${conversationId}/`;
    if (
      !storagePath.startsWith(expectedPrefix) ||
      storagePath.includes('..') ||
      storagePath.length <= expectedPrefix.length
    ) {
      throw new ForbiddenException(
        'storagePath does not belong to this conversation',
      );
    }
  }

  private async assertObjectValid(
    storagePath: string,
    kind: AttachmentKind | 'voice',
  ): Promise<{ sizeBytes: number; mimeType: string | null }> {
    const slash = storagePath.lastIndexOf('/');
    const folder = storagePath.slice(0, slash);
    const name = storagePath.slice(slash + 1);
    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .list(folder, { search: name });
    if (error)
      throw new BadRequestException(
        `Upload verification failed: ${error.message}`,
      );
    const object = data?.find((o) => o.name === name);
    if (!object) {
      throw new BadRequestException(
        'Uploaded object not found — confirm after the upload completes',
      );
    }

    const meta = (object.metadata ?? {}) as {
      size?: number;
      mimetype?: string;
    };
    const actualSize = typeof meta.size === 'number' ? meta.size : null;
    const actualMime = typeof meta.mimetype === 'string' ? meta.mimetype : null;

    // Storage should always report these. If it ever does not, fail closed
    // rather than silently fall back to trusting the client again.
    if (actualSize === null) {
      throw new BadRequestException(
        'Upload verification failed: storage reported no size',
      );
    }
    this.assertAllowed(
      kind,
      actualMime ?? 'application/octet-stream',
      actualSize,
    );
    return { sizeBytes: actualSize, mimeType: actualMime };
  }

  async confirmAttachment(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
    input: {
      storagePath: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      kind: AttachmentKind;
      body?: string;
    },
  ): Promise<MessageAttachment> {
    // Cheap rejection on the declared values first, then the authoritative
    // check against what storage actually holds.
    this.assertAllowed(input.kind, input.mimeType, input.sizeBytes);
    const { conversation, ownerUserId } = await this.resolveTarget(
      token,
      applicationId,
    );
    // SEC-3050: bind the client-supplied path to the caller's own folder.
    this.assertPathOwnedBy(
      input.storagePath,
      ownerUserId,
      applicationId,
      conversation.id,
    );
    const actual = await this.assertObjectValid(input.storagePath, input.kind);
    const db = this.supabase.forUser(token);
    const senderRole =
      caller.appRole === 'admin'
        ? 'admin'
        : caller.appRole === 'consultant'
          ? 'consultant'
          : 'user';
    const message = await this.msgRepo.insertMessage(db, {
      conversationId: conversation.id,
      senderId: caller.id,
      senderRole,
      category: 'documents',
      body: input.body?.trim() || input.fileName,
      parentMessageId: null,
    });
    await this.msgRepo.touchLastMessageAt(
      db,
      conversation.id,
      message.created_at,
    );
    const attachment = await this.attRepo.insertAttachment(db, {
      messageId: message.id,
      conversationId: conversation.id,
      storagePath: input.storagePath,
      fileName: input.fileName,
      // Persist what storage measured, not what the client asserted.
      mimeType: actual.mimeType ?? input.mimeType,
      sizeBytes: actual.sizeBytes,
      kind: input.kind,
    });
    await this.fanOut(
      applicationId,
      conversation.id,
      caller.id,
      message.id,
      'attachment.created',
    );
    return attachment;
  }

  async confirmVoice(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
    input: {
      storagePath: string;
      mimeType: string;
      durationMs: number;
      sizeBytes: number;
    },
  ): Promise<VoiceMessage> {
    this.assertAllowed('voice', input.mimeType, input.sizeBytes);
    const { conversation, ownerUserId } = await this.resolveTarget(
      token,
      applicationId,
    );
    // SEC-3050: bind the client-supplied path to the caller's own folder.
    this.assertPathOwnedBy(
      input.storagePath,
      ownerUserId,
      applicationId,
      conversation.id,
    );
    const actualVoice = await this.assertObjectValid(
      input.storagePath,
      'voice',
    );
    const db = this.supabase.forUser(token);
    const senderRole =
      caller.appRole === 'admin'
        ? 'admin'
        : caller.appRole === 'consultant'
          ? 'consultant'
          : 'user';
    const message = await this.msgRepo.insertMessage(db, {
      conversationId: conversation.id,
      senderId: caller.id,
      senderRole,
      category: 'general',
      body: '[voice message]',
      parentMessageId: null,
    });
    await this.msgRepo.touchLastMessageAt(
      db,
      conversation.id,
      message.created_at,
    );
    const voice = await this.attRepo.insertVoice(db, {
      messageId: message.id,
      conversationId: conversation.id,
      storagePath: input.storagePath,
      mimeType: actualVoice.mimeType ?? input.mimeType,
      durationMs: Math.max(0, Math.floor(input.durationMs)),
      sizeBytes: actualVoice.sizeBytes,
    });
    await this.fanOut(
      applicationId,
      conversation.id,
      caller.id,
      message.id,
      'voice.created',
    );
    return voice;
  }

  async getDownloadUrl(
    token: string,
    _caller: MessagingCaller,
    attachmentId: string,
  ): Promise<{ url: string }> {
    const db = this.supabase.forUser(token);
    const attachment = await this.attRepo.getAttachment(db, attachmentId);
    if (!attachment) throw new NotFoundException('Attachment not found');
    return this.sign(attachment.storage_path);
  }

  async getVoiceDownloadUrl(
    token: string,
    _caller: MessagingCaller,
    voiceId: string,
  ): Promise<{ url: string }> {
    const db = this.supabase.forUser(token);
    const voice = await this.attRepo.getVoice(db, voiceId);
    if (!voice) throw new NotFoundException('Voice message not found');
    return this.sign(voice.storage_path);
  }

  private async sign(storagePath: string): Promise<{ url: string }> {
    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGN_TTL);
    if (error || !data)
      throw new BadRequestException(
        `Failed to sign download: ${error?.message}`,
      );
    // Rewritten for the browser — see SupabaseService.toPublicStorageUrl.
    return { url: this.supabase.toPublicStorageUrl(data.signedUrl) };
  }

  private async fanOut(
    applicationId: string,
    conversationId: string,
    actorId: string,
    messageId: string,
    type: 'attachment.created' | 'voice.created',
  ): Promise<void> {
    const recipients = await this.messaging.recipientIds(
      applicationId,
      actorId,
    );
    await this.msgRepo.insertNotifications(
      this.supabase.admin,
      recipients.map((userId) => ({
        userId,
        type: 'message.received',
        conversationId,
        messageId,
      })),
    );
    this.bus.emit({
      type,
      conversation_id: conversationId,
      application_id: applicationId,
      recipient_ids: recipients,
    });
  }
}
