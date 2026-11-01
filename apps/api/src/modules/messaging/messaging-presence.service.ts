import { Injectable } from '@nestjs/common';

/** Max concurrent SSE connections per user. Generous for multi-tab use
 *  (post-P5 ≈ 1 connection/tab); bounds a runaway/abusive client. */
export const MAX_SSE_CONNECTIONS_PER_USER = 8;

/**
 * In-proc presence registry for the messaging SSE layer. A user may hold more
 * than one SSE connection (multiple tabs), so connections are refcounted; a user
 * is "online" while count > 0, capped at MAX_SSE_CONNECTIONS_PER_USER. Single
 * instance only — cross-instance presence (Redis) is a later concern.
 */
@Injectable()
export class MessagingPresenceService {
  private readonly counts = new Map<string, number>();

  /** Take a connection slot if under the cap. Returns false (no increment) at cap. */
  tryConnect(userId: string): boolean {
    const cur = this.counts.get(userId) ?? 0;
    if (cur >= MAX_SSE_CONNECTIONS_PER_USER) return false;
    this.counts.set(userId, cur + 1);
    return true;
  }

  disconnect(userId: string): void {
    const next = (this.counts.get(userId) ?? 0) - 1;
    if (next <= 0) this.counts.delete(userId);
    else this.counts.set(userId, next);
  }

  isOnline(userId: string): boolean {
    return (this.counts.get(userId) ?? 0) > 0;
  }
}
