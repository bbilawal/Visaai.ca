import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import type { Env } from '../../config/configuration';

export interface TokenPayload {
  sessionId: string;
  applicationId: string;
  userId: string;
}

export interface ResumePayload extends TokenPayload {
  /** Epoch ms. Fixed at first connect; rotation never extends it. */
  resumableUntil: number;
}

/** TTL of the connect token minted by POST /automation/session. */
const CONNECT_TTL_S = 300;
/** TTL of each resume token; a reconnect after a longer outage re-launches. */
const RESUME_TTL_S = 300;
/** Absolute cap on how long one connect token can be kept alive by resuming. */
export const RESUME_WINDOW_MS = 30 * 60_000;

@Injectable()
export class SessionTokenService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;

  constructor(private config: ConfigService<Env>) {}

  onModuleInit() {
    this.redis = new Redis(this.config.get('REDIS_URL', { infer: true })!);
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  async mint(payload: TokenPayload): Promise<string> {
    const token = randomUUID();
    await this.redis.set(
      `automation:token:${token}`,
      JSON.stringify(payload),
      'EX',
      CONNECT_TTL_S,
    );
    return token;
  }

  /**
   * Reconnect credential (REVIEW_HANDOFF item 60). The connect token is
   * single-use (GETDEL), so socket.io's automatic reconnect — which replays
   * the same handshake `auth` — always failed after a transient blip. Each
   * authenticated connection is instead issued a fresh resume token: also
   * single-use, rotated on every connect, bound to the same session, and
   * bounded by an absolute `resumableUntil` that rotation never extends. It is
   * kept under its own key prefix, so it is never accepted as a connect token.
   */
  async mintResume(
    payload: TokenPayload,
    resumableUntil: number,
  ): Promise<string> {
    const token = randomUUID();
    const body: ResumePayload = {
      sessionId: payload.sessionId,
      applicationId: payload.applicationId,
      userId: payload.userId,
      resumableUntil,
    };
    await this.redis.set(
      `automation:resume:${token}`,
      JSON.stringify(body),
      'EX',
      RESUME_TTL_S,
    );
    return token;
  }

  async redeemResume(
    token: string,
    now = Date.now(),
  ): Promise<ResumePayload | null> {
    const raw = await this.redis.getdel(`automation:resume:${token}`);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as ResumePayload;
      if (
        typeof p.resumableUntil !== 'number' ||
        p.resumableUntil <= now ||
        !p.sessionId ||
        !p.applicationId ||
        !p.userId
      )
        return null;
      return p;
    } catch {
      return null;
    }
  }

  async redeem(token: string): Promise<TokenPayload | null> {
    const raw = await this.redis.getdel(`automation:token:${token}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TokenPayload;
    } catch {
      return null;
    }
  }
}
