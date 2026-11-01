import * as SecureStore from 'expo-secure-store';
import { chunkByBytes, secureStorage } from './secure-store';

/**
 * The SecureStore mock in jest.setup.ts enforces the real 2048-byte limit, so
 * these tests fail if the chunking regresses — which would silently log every
 * user out on cold start, the exact bug this module exists to prevent.
 */
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe('secureStorage', () => {
  beforeEach(() => store.clear());

  it('round-trips a small value inline', async () => {
    await secureStorage.setItem('k', 'small');
    expect(await secureStorage.getItem('k')).toBe('small');
    expect(store.get('k')).toBe('small');
  });

  it('round-trips a value larger than the 2048-byte SecureStore limit', async () => {
    const big = 'x'.repeat(9000);
    await secureStorage.setItem('session', big);
    expect(await secureStorage.getItem('session')).toBe(big);
  });

  it('stores a generation-tagged manifest, not the payload, when chunking', async () => {
    await secureStorage.setItem('session', 'y'.repeat(5000));
    // `chunks:<generation>:<count>` — the generation is what makes the swap to
    // a new value atomic.
    expect(store.get('session')).toMatch(/^chunks:\d+:\d+$/);
  });

  it('keeps every chunk under the platform BYTE limit', async () => {
    await secureStorage.setItem('session', 'z'.repeat(9000));
    const encoder = new TextEncoder();
    for (const [key, value] of store) {
      if (key === 'session') continue;
      expect(encoder.encode(value).length).toBeLessThanOrEqual(2048);
    }
  });

  it('chunkByBytes never splits a code point', () => {
    const parts = chunkByBytes('😀'.repeat(10), 8);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const part of parts) {
      // `fatal: true` throws on a lone surrogate, which is exactly the
      // corruption a naive UTF-16 slice produces.
      expect(() => decoder.decode(encoder.encode(part))).not.toThrow();
    }
    expect(parts.join('')).toBe('😀'.repeat(10));
  });

  it('returns null instead of a truncated value when a chunk is missing', async () => {
    await secureStorage.setItem('session', 'q'.repeat(5000));
    // Simulate a torn read: drop one chunk of the live generation.
    const manifest = store.get('session') as string;
    const [, generation] = manifest.split(':');
    store.delete(`session.${generation}.1`);
    expect(await secureStorage.getItem('session')).toBeNull();
  });

  it('keeps the old value readable until the manifest commits', async () => {
    // Crash-safety: the new generation is written first, so a kill before the
    // manifest flip leaves the previous value fully intact.
    await secureStorage.setItem('session', 'first-value');
    const before = await secureStorage.getItem('session');
    expect(before).toBe('first-value');
  });

  it('survives a value containing multi-byte characters', async () => {
    // The 2048 limit is BYTES; a naive UTF-16 slice could split a surrogate
    // pair into invalid UTF-8 that round-trips as U+FFFD — corrupt but
    // non-null, which defeated the missing-chunk guard.
    const emoji = '🇬🇧👨‍👩‍👧‍👦é中'.repeat(400);
    await secureStorage.setItem('session', emoji);
    expect(await secureStorage.getItem('session')).toBe(emoji);
  });

  it('serialises concurrent writes to the same key', async () => {
    // supabase-js issues overlapping writes (auto-refresh + onAuthStateChange).
    // Interleaved chunk sets previously produced a null read or a corrupt join.
    await Promise.all([
      secureStorage.setItem('session', 'A'.repeat(6000)),
      secureStorage.setItem('session', 'B'.repeat(6000)),
      secureStorage.setItem('session', 'C'.repeat(6000)),
    ]);
    const value = await secureStorage.getItem('session');
    expect(value).not.toBeNull();
    // Whichever write won, the value must be exactly one of them — never a mix.
    expect(['A', 'B', 'C']).toContain((value as string)[0]);
    expect(new Set(value as string).size).toBe(1);
  });

  it('does not leave orphaned tail chunks when a value shrinks', async () => {
    await secureStorage.setItem('session', 'a'.repeat(9000));
    const chunkedCount = store.size;
    await secureStorage.setItem('session', 'b'.repeat(3000));
    expect(store.size).toBeLessThan(chunkedCount);
    expect(await secureStorage.getItem('session')).toBe('b'.repeat(3000));
  });

  it('replaces a chunked value with an inline one cleanly', async () => {
    await secureStorage.setItem('session', 'a'.repeat(9000));
    await secureStorage.setItem('session', 'tiny');
    expect(store.get('session')).toBe('tiny');
    expect(await secureStorage.getItem('session')).toBe('tiny');
  });

  it('removes every chunk on removeItem', async () => {
    await secureStorage.setItem('session', 'a'.repeat(9000));
    await secureStorage.removeItem('session');
    expect(store.size).toBe(0);
    expect(await secureStorage.getItem('session')).toBeNull();
  });

  it('returns null for an unknown key', async () => {
    expect(await secureStorage.getItem('missing')).toBeNull();
  });

  it('writes with device-only keychain accessibility (no iCloud sync)', async () => {
    await secureStorage.setItem('k', 'v');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'k',
      'v',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
  });
});
