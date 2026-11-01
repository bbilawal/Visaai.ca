import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '@/storage/secure-store';

/**
 * Draft persistence — the answer to "I typed my whole application on the train
 * and the app was killed".
 *
 * Storage tier is chosen by the caller and it matters:
 *
 *  - `sensitive: true` → SecureStore (hardware-backed keychain). Anything
 *    derived from an immigration form: passport numbers, dates of birth,
 *    addresses, travel history, family details. This is the default.
 *  - `sensitive: false` → AsyncStorage (plain, unencrypted, readable on a
 *    rooted/jailbroken device and included in some backups). Only for
 *    non-identifying UI state such as "which step was I on".
 *
 * Drafts are namespaced per user id. Without that, signing out and signing in
 * as someone else on a shared device would surface the previous person's
 * half-written application.
 */
export interface DraftEnvelope<T> {
  data: T;
  updatedAt: string;
  /** Bumped on every local save; used for conflict detection against the server. */
  revision: number;
}

const PREFIX = 'visaai.draft';

function key(userId: string, name: string): string {
  return `${PREFIX}.${userId}.${name}`;
}

export interface DraftOptions {
  /** Default true — assume anything a user types about their case is sensitive. */
  sensitive?: boolean;
}

function store(options?: DraftOptions): {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem: (k: string) => Promise<void>;
} {
  return options?.sensitive === false ? AsyncStorage : secureStorage;
}

export const drafts = {
  async save<T>(
    userId: string,
    name: string,
    data: T,
    options?: DraftOptions,
  ): Promise<DraftEnvelope<T>> {
    const existing = await drafts.load<T>(userId, name, options);
    const envelope: DraftEnvelope<T> = {
      data,
      updatedAt: new Date().toISOString(),
      revision: (existing?.revision ?? 0) + 1,
    };
    await store(options).setItem(key(userId, name), JSON.stringify(envelope));
    return envelope;
  },

  async load<T>(
    userId: string,
    name: string,
    options?: DraftOptions,
  ): Promise<DraftEnvelope<T> | null> {
    const raw = await store(options).getItem(key(userId, name));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DraftEnvelope<T>;
    } catch {
      // Corrupt entry (interrupted write): drop it rather than crash the screen
      // on every mount.
      await store(options).removeItem(key(userId, name));
      return null;
    }
  },

  async clear(userId: string, name: string, options?: DraftOptions): Promise<void> {
    await store(options).removeItem(key(userId, name));
  },

  /**
   * Wipe every non-sensitive draft for a user. Called on sign-out so a shared
   * device does not leak the previous session's work.
   *
   * SecureStore has no key enumeration API, so sensitive drafts must be cleared
   * by name via `clear()` — the caller passes the list it owns.
   */
  async clearAllForUser(userId: string, sensitiveNames: string[] = []): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(`${PREFIX}.${userId}.`));
    if (mine.length) await AsyncStorage.multiRemove(mine);
    await Promise.all(sensitiveNames.map((name) => secureStorage.removeItem(key(userId, name))));
  },
};

/**
 * Conflict resolution for a draft that was also changed server-side.
 *
 * We never silently overwrite: immigration answers are not reconstructable from
 * memory, so a losing write is real data loss. `local-newer` and `remote-newer`
 * are reported to the UI, which asks the user which to keep.
 */
export type ConflictResolution = 'no-conflict' | 'local-newer' | 'remote-newer' | 'identical';

export function detectConflict(
  local: { updatedAt: string } | null,
  remote: { updatedAt: string } | null,
): ConflictResolution {
  if (!local || !remote) return 'no-conflict';
  const l = Date.parse(local.updatedAt);
  const r = Date.parse(remote.updatedAt);
  if (!Number.isFinite(l) || !Number.isFinite(r)) return 'no-conflict';
  if (l === r) return 'identical';
  return l > r ? 'local-newer' : 'remote-newer';
}
