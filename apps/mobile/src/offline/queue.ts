import * as Crypto from 'expo-crypto';
import { api } from '@/api/client';
import { isApiError } from '@/api/errors';
import { secureStorage } from '@/storage/secure-store';
import { isOnline, onNetworkChange } from './network';

/**
 * Queue for mutations made while offline, replayed when connectivity returns.
 *
 * SCOPE IS DELIBERATELY NARROW. Only operations that are safe to replay late
 * are allowed — sending a chat message, marking a notification read, saving
 * profile fields. Explicitly NOT queued: payments (replaying a stale payment
 * intent is real money), application submission (no undo on the government
 * side), and document uploads (large binaries; the resumable uploader owns them).
 *
 * Three properties this file must hold, each of which was broken before:
 *
 *  1. NOTHING IS LOST. `flush()` used to snapshot the list and write back
 *     `remaining` at the end, silently overwriting anything enqueued while
 *     requests were in flight — send a message during a flush and it vanished.
 *     Writes now re-read and merge under a lock.
 *  2. NOTHING CROSSES USERS. The store was one global key, so on a shared
 *     device user A's queued `profile.update` replayed into user B's account.
 *     Every item records its owner and the store is namespaced per user.
 *  3. NOTHING SENSITIVE IN PLAINTEXT. Message bodies are immigration
 *     correspondence; they live in SecureStore, not AsyncStorage (which is
 *     world-readable on a rooted device and can land in a device backup).
 */
export type QueueableOp = 'message.send' | 'notification.read' | 'profile.update';

interface QueuedItem {
  id: string;
  /** Supabase user id that enqueued this. Never replayed for anyone else. */
  userId: string;
  op: QueueableOp;
  path: string;
  method: 'POST' | 'PATCH';
  body?: unknown;
  createdAt: string;
  attempts: number;
}

const KEY_PREFIX = 'visaai.offlineQueue';
const MAX_ITEMS = 100;
const MAX_ATTEMPTS = 5;
/** Older than this and replaying is more confusing than helpful. */
const MAX_AGE_MS = 24 * 3600_000;

function storageKey(userId: string): string {
  return `${KEY_PREFIX}.${userId}`;
}

let flushing = false;
/** Serializes read-modify-write cycles so a concurrent enqueue cannot be lost. */
let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.catch(() => undefined).then(fn);
  chain = next.catch(() => undefined);
  return next;
}

async function read(userId: string): Promise<QueuedItem[]> {
  const raw = await secureStorage.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QueuedItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(userId: string, items: QueuedItem[]): Promise<void> {
  await secureStorage.setItem(storageKey(userId), JSON.stringify(items));
}

export const offlineQueue = {
  async enqueue(input: {
    userId: string;
    op: QueueableOp;
    path: string;
    method: 'POST' | 'PATCH';
    body?: unknown;
  }): Promise<string> {
    const item: QueuedItem = {
      id: Crypto.randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    await withLock(async () => {
      const items = await read(input.userId);
      // Drop the OLDEST on overflow: a 100-deep backlog means something is very
      // wrong, and the newest intent is the one the user still cares about.
      await write(input.userId, [...items, item].slice(-MAX_ITEMS));
    });
    return item.id;
  },

  async size(userId: string): Promise<number> {
    return (await read(userId)).length;
  },

  async list(userId: string): Promise<QueuedItem[]> {
    return read(userId);
  },

  async clear(userId: string): Promise<void> {
    await withLock(() => write(userId, []));
  },

  /**
   * Replay pending items for ONE user, in order. Returns counts for the UI.
   * Never throws.
   */
  async flush(userId: string): Promise<{ sent: number; failed: number; dropped: number }> {
    if (flushing || !isOnline() || !userId) return { sent: 0, failed: 0, dropped: 0 };
    flushing = true;
    let sent = 0;
    let failed = 0;
    let dropped = 0;

    try {
      const items = await read(userId);
      /** Ids that must not survive this pass — sent, expired, or exhausted. */
      const settled = new Set<string>();
      /** id -> new attempt count for items that failed retryably. */
      const retried = new Map<string, number>();
      let stopped = false;

      for (const item of items) {
        if (stopped) break;

        if (item.userId !== userId) {
          // Belt and braces alongside the namespaced key: never replay another
          // account's intent with the current token.
          settled.add(item.id);
          dropped += 1;
          continue;
        }
        if (Date.now() - Date.parse(item.createdAt) > MAX_AGE_MS) {
          settled.add(item.id);
          dropped += 1;
          continue;
        }

        try {
          // `auth: 'required'` — without it the default 'optional' sent an
          // UNAUTHENTICATED replay whenever the token had expired, which 401'd,
          // discarded the message, and tripped the global sign-out handler.
          const options = { retries: 0, auth: 'required' as const };
          if (item.method === 'POST') await api.post(item.path, item.body, options);
          else await api.patch(item.path, item.body, options);
          settled.add(item.id);
          sent += 1;
        } catch (e) {
          const transient =
            isApiError(e) && (e.kind === 'offline' || e.kind === 'network' || e.kind === 'timeout');

          if (transient) {
            // The network went away again. Stop the sweep — hammering the rest
            // drains the battery — and do NOT spend an attempt: nothing is
            // wrong with the payload, so a few wifi flaps must not exhaust it.
            failed += 1;
            stopped = true;
            continue;
          }

          const retryable = isApiError(e) ? e.retryable : true;
          if (!retryable) {
            // A 4xx fails identically forever.
            settled.add(item.id);
            dropped += 1;
            continue;
          }

          const attempts = item.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            settled.add(item.id);
            dropped += 1;
          } else {
            retried.set(item.id, attempts);
            failed += 1;
          }
        }
      }

      // Re-read under the lock and merge: anything enqueued DURING the flush is
      // still in the store and must survive. Writing back a stale snapshot is
      // what silently destroyed messages.
      await withLock(async () => {
        const latest = await read(userId);
        const merged = latest
          .filter((item) => !settled.has(item.id))
          .map((item) =>
            retried.has(item.id) ? { ...item, attempts: retried.get(item.id) as number } : item,
          );
        await write(userId, merged);
      });

      return { sent, failed, dropped };
    } finally {
      flushing = false;
    }
  },

  /** Auto-flush whenever connectivity is restored, for the signed-in user. */
  startAutoFlush(getUserId: () => string | null): () => void {
    return onNetworkChange((state) => {
      const userId = getUserId();
      if (userId && state.isConnected && state.isReachable) void offlineQueue.flush(userId);
    });
  },

  /** Test seam. */
  __resetMemory(): void {
    flushing = false;
    chain = Promise.resolve();
  },
};
