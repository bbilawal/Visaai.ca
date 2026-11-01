import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../../../config/configuration';

/**
 * F4: authenticated field-level encryption for sensitive stored text
 * (e.g. post_submission_events.raw_email_encrypted).
 *
 * AES-256-GCM. Output layout: base64( iv[12] || authTag[16] || ciphertext ).
 * Key comes from EMAIL_ENCRYPTION_KEY (64 hex chars). There is NO default key:
 * if encryption is attempted without a configured key, this throws rather than
 * silently writing recoverable plaintext-equivalent data.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class FieldCryptoService {
  private readonly key: Buffer | null;

  constructor(config: ConfigService<Env>) {
    const hex = config.get('EMAIL_ENCRYPTION_KEY', { infer: true });
    this.key = hex ? Buffer.from(hex, 'hex') : null;
  }

  get isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new InternalServerErrorException(
        'EMAIL_ENCRYPTION_KEY is not configured; refusing to store sensitive data unencrypted',
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    if (!this.key) {
      throw new InternalServerErrorException(
        'EMAIL_ENCRYPTION_KEY is not configured; cannot decrypt',
      );
    }
    const buf = Buffer.from(payload, 'base64');
    // Without an explicit length, Node accepts a SHORT GCM tag (down to 4
    // bytes), and a truncated payload would yield one — turning a 2^-128
    // forgery into a 2^-32 one. Reject anything that cannot hold a full tag,
    // and pin the length on the decipher so a short tag is refused outright.
    if (buf.length < IV_BYTES + TAG_BYTES) {
      throw new InternalServerErrorException(
        'ciphertext is malformed (too short to contain an authentication tag)',
      );
    }
    const iv = buf.subarray(0, IV_BYTES);
    const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
