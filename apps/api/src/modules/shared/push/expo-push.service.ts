import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';

export type DevicePushResult = 'ok' | 'gone' | 'error';

export interface DevicePushMessage {
  /** Lock-screen visible. Must stay generic — see the privacy note below. */
  title: string;
  body: string;
  /** Delivered to the app, not shown. Used for deep-link routing. */
  data?: Record<string, unknown>;
  /** Collapse key: a burst about one conversation replaces itself. */
  collapseId?: string;
  badge?: number;
}

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo's documented per-request message cap
const SEND_TIMEOUT_MS = 10_000;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Native push delivery through Expo Push Service (which fans out to APNs and
 * FCM). Deliberately shaped like WebPushService: never throws, returns 'gone'
 * so the caller prunes a dead token, and no-ops with a warning when unconfigured.
 *
 * PRIVACY: notification payloads reach the lock screen of a possibly-unlocked,
 * possibly-shared device, and transit Expo's servers. Callers must pass generic
 * copy only — never a visa outcome, document name, case detail, or consultant
 * message body. Identifiers travel in `data` for the app to resolve after auth.
 *
 * Configuration: none required for Expo-managed credentials in development.
 * Set EXPO_ACCESS_TOKEN in production to enable push-security enforcement, so a
 * leaked project id alone cannot be used to send to your users.
 */
@Injectable()
export class ExpoPushService {
  private readonly log = new Logger(ExpoPushService.name);
  private readonly accessToken?: string;
  private readonly enabled: boolean;

  constructor(config: ConfigService<Env>) {
    this.accessToken = config.get('EXPO_ACCESS_TOKEN', { infer: true });
    this.enabled =
      config.get('MOBILE_PUSH_ENABLED', { infer: true }) !== 'false';
  }

  /**
   * Send one message to many device tokens. Returns a per-token result so the
   * caller can prune exactly the dead ones. Never throws.
   */
  async sendToTokens(
    tokens: string[],
    message: DevicePushMessage,
  ): Promise<Map<string, DevicePushResult>> {
    const results = new Map<string, DevicePushResult>();
    if (!this.enabled || tokens.length === 0) {
      if (!this.enabled)
        this.log.warn('MOBILE_PUSH_ENABLED=false — device push skipped');
      tokens.forEach((t) => results.set(t, 'error'));
      return results;
    }

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      await this.sendBatch(batch, message, results);
    }
    return results;
  }

  private async sendBatch(
    tokens: string[],
    message: DevicePushMessage,
    results: Map<string, DevicePushResult>,
  ): Promise<void> {
    const payload = tokens.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: 'default',
      // iOS groups by thread; Android collapses by tag. Both prevent a burst of
      // consultant replies from filling the shade with duplicates.
      ...(message.collapseId
        ? { collapseId: message.collapseId, threadId: message.collapseId }
        : {}),
      ...(message.badge !== undefined ? { badge: message.badge } : {}),
      // Hide content on the lock screen where the OS supports it.
      priority: 'high' as const,
    }));

    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        // Without a deadline a hung Expo connection stalls notifyRecipient and
        // therefore every remaining recipient in the serial dispatch loop.
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.accessToken
            ? { Authorization: `Bearer ${this.accessToken}` }
            : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // 4xx/5xx from Expo itself: the whole batch failed, none are provably dead.
        this.log.error(`expo push batch failed: HTTP ${res.status}`);
        tokens.forEach((t) => results.set(t, 'error'));
        return;
      }

      const body = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = body.data ?? [];
      tokens.forEach((token, idx) => {
        const ticket = tickets[idx];
        if (!ticket) {
          results.set(token, 'error');
          return;
        }
        if (ticket.status === 'ok') {
          results.set(token, 'ok');
          return;
        }
        // DeviceNotRegistered is the APNs/FCM "this token is dead" signal —
        // the app was uninstalled or the token rotated. Prune it.
        results.set(
          token,
          ticket.details?.error === 'DeviceNotRegistered' ? 'gone' : 'error',
        );
        if (ticket.details?.error !== 'DeviceNotRegistered') {
          this.log.warn(
            `expo push ticket error: ${ticket.details?.error ?? ticket.message}`,
          );
        }
      });
    } catch (err) {
      this.log.error(`expo push transport error: ${(err as Error).message}`);
      tokens.forEach((t) => results.set(t, 'error'));
    }
  }
}
