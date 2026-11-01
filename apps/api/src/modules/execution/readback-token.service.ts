import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReadbackTokenPayload } from '@visaai/types';
import type { Env } from '../../config/configuration';

const TTL_MS = 15 * 60 * 1000; // readback confirmation is valid for 15 minutes

/**
 * Stateless, signed readback token bound to the exact lock the user confirmed.
 * Minted at readback-confirm; verified at the execution choke point. Any change
 * to lockedDiffHash / mappings / app since issuance invalidates the binding
 * (a different signature is required), and TTL expiry invalidates it too.
 */
@Injectable()
export class ReadbackTokenService {
  private readonly secret: string;

  constructor(config: ConfigService<Env>) {
    this.secret =
      (config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }) as string) ??
      'dev-secret';
  }

  mint(payload: Omit<ReadbackTokenPayload, 'issuedAt'>): string {
    const full: ReadbackTokenPayload = { ...payload, issuedAt: Date.now() };
    const body = Buffer.from(JSON.stringify(full), 'utf8').toString(
      'base64url',
    );
    return `${body}.${this.sign(body)}`;
  }

  /** Returns the payload if the signature is valid and unexpired, else null. */
  verify(token: string): ReadbackTokenPayload | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = this.sign(body);
    if (!this.safeEq(sig, expected)) return null;
    let payload: ReadbackTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as ReadbackTokenPayload;
    } catch {
      return null;
    }
    if (Date.now() - payload.issuedAt > TTL_MS) return null;
    return payload;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  private safeEq(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
