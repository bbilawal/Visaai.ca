import * as SecureStore from 'expo-secure-store';

/**
 * Chunked SecureStore adapter (hardware-backed keychain / EncryptedSharedPrefs).
 *
 * Why chunking: a Supabase session blob is a JSON envelope containing the
 * access token, refresh token, and the decoded user object — routinely well
 * over 2 KB. expo-secure-store warns above 2048 bytes and Android's backing
 * store can reject the write outright, which would silently drop the session
 * and log the user out on every cold start.
 *
 * Three correctness properties this file has to guarantee, each of which was
 * violated by the obvious implementation:
 *
 *  1. BYTE-correct sizing. The 2048 limit is bytes; JS string length is UTF-16
 *     code units. One emoji or CJK name made a "1800-char" chunk up to 5.4 KB,
 *     and a naive slice could split a surrogate pair into invalid UTF-8 that
 *     round-trips as U+FFFD — corrupt but non-null, so the null guard missed it.
 *  2. CRASH-safe ordering. Deleting the old chunks before writing the new ones
 *     leaves a window where the live manifest points at deleted keys. A kill
 *     mid-write there destroys the session. New data is written to a shadow
 *     generation first; the manifest flip is the commit point.
 *  3. SERIALIZED writes. supabase-js issues overlapping writes (auto-refresh,
 *     onAuthStateChange, explicit setSession). Interleaved chunk sets produced
 *     either a null read or a half-A/half-B join that threw inside supabase-js.
 *
 * Everything written here is a credential: WHEN_UNLOCKED_THIS_DEVICE_ONLY keeps
 * it off iCloud Keychain sync and out of backups restored onto another phone.
 */
const CHUNK_BYTES = 1500; // headroom under 2048 for the key name + metadata
const MANIFEST_PREFIX = 'chunks:';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** `<key>.<generation>.<index>` — generation makes the swap atomic. */
function chunkKey(key: string, generation: number, index: number): string {
  return `${key}.${generation}.${index}`;
}

interface Manifest {
  generation: number;
  count: number;
}

function parseManifest(raw: string | null): Manifest | null {
  if (!raw?.startsWith(MANIFEST_PREFIX)) return null;
  const [generation, count] = raw.slice(MANIFEST_PREFIX.length).split(':').map(Number);
  if (!Number.isInteger(generation) || !Number.isInteger(count) || (count ?? 0) <= 0) return null;
  return { generation: generation as number, count: count as number };
}

function formatManifest(m: Manifest): string {
  return `${MANIFEST_PREFIX}${m.generation}:${m.count}`;
}

/**
 * Split on BYTE budget without ever cutting a code point. Iterating by code
 * point (for..of) rather than index is what keeps surrogate pairs intact.
 */
export function chunkByBytes(value: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of value) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > maxBytes && current !== '') {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/** Per-key promise chain. Concurrent writes to one key run in submission order. */
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  // Keep the chain alive even if this operation rejects.
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

async function deleteGeneration(key: string, m: Manifest): Promise<void> {
  for (let i = 0; i < m.count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, m.generation, i), OPTS);
  }
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key, OPTS);
    const manifest = parseManifest(head);
    if (!manifest) return head; // small value stored inline

    const parts: string[] = [];
    for (let i = 0; i < manifest.count; i++) {
      const part = await SecureStore.getItemAsync(
        chunkKey(key, manifest.generation, i),
        OPTS,
      );
      // A missing chunk means a torn write. Returning a truncated blob would
      // make supabase-js throw on parse forever; absent is recoverable.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  setItem(key: string, value: string): Promise<void> {
    return withLock(key, async () => {
      const previous = parseManifest(await SecureStore.getItemAsync(key, OPTS));

      if (new TextEncoder().encode(value).length <= CHUNK_BYTES) {
        await SecureStore.setItemAsync(key, value, OPTS);
        if (previous) await deleteGeneration(key, previous);
        return;
      }

      const generation = ((previous?.generation ?? 0) + 1) % 1024;
      const parts = chunkByBytes(value, CHUNK_BYTES);

      // Write the new generation FIRST. The old one is still intact and the
      // manifest still points at it, so a crash here loses nothing.
      for (let i = 0; i < parts.length; i++) {
        await SecureStore.setItemAsync(chunkKey(key, generation, i), parts[i] as string, OPTS);
      }

      // Commit point: one atomic write flips which generation is live.
      await SecureStore.setItemAsync(key, formatManifest({ generation, count: parts.length }), OPTS);

      // Only now is the old generation unreachable and safe to reclaim.
      if (previous) await deleteGeneration(key, previous);
    });
  },

  removeItem(key: string): Promise<void> {
    return withLock(key, async () => {
      const manifest = parseManifest(await SecureStore.getItemAsync(key, OPTS));
      await SecureStore.deleteItemAsync(key, OPTS);
      if (manifest) await deleteGeneration(key, manifest);
    });
  },
};

export type SecureStorage = typeof secureStorage;
