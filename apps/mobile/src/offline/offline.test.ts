import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { detectConflict, drafts } from './drafts';
import { offlineQueue } from './queue';
import { __setNetworkState, isOnline } from './network';
import { secureStorage } from '@/storage/secure-store';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';

jest.mock('@/api/client', () => ({
  api: { post: jest.fn(), patch: jest.fn() },
}));

const asyncStore = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe('drafts', () => {
  beforeEach(() => {
    asyncStore.clear();
    secureStore.clear();
  });

  it('defaults to the encrypted store — case data must not sit in plaintext', async () => {
    await drafts.save('user-1', 'application', { passport: 'X1234567' });
    expect(secureStore.size).toBeGreaterThan(0);
    expect(asyncStore.size).toBe(0);
  });

  it('uses plain storage only when explicitly marked non-sensitive', async () => {
    await drafts.save('user-1', 'ui-step', { step: 2 }, { sensitive: false });
    expect(asyncStore.size).toBe(1);
    expect(secureStore.size).toBe(0);
  });

  it('round-trips a draft and increments the revision', async () => {
    const first = await drafts.save('user-1', 'application', { a: 1 });
    const second = await drafts.save('user-1', 'application', { a: 2 });
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect((await drafts.load<{ a: number }>('user-1', 'application'))?.data).toEqual({ a: 2 });
  });

  it('namespaces per user so a shared device cannot leak between accounts', async () => {
    await drafts.save('user-1', 'application', { owner: 1 });
    await drafts.save('user-2', 'application', { owner: 2 });
    expect((await drafts.load<{ owner: number }>('user-2', 'application'))?.data).toEqual({
      owner: 2,
    });
  });

  it('drops a corrupt entry instead of throwing on every mount', async () => {
    await drafts.save('user-1', 'x', { a: 1 }, { sensitive: false });
    const key = [...asyncStore.keys()][0] as string;
    asyncStore.set(key, '{not json');
    expect(await drafts.load('user-1', 'x', { sensitive: false })).toBeNull();
    expect(asyncStore.has(key)).toBe(false);
  });

  it('clears every draft for a user on sign-out', async () => {
    await drafts.save('user-1', 'ui', { a: 1 }, { sensitive: false });
    await drafts.save('user-1', 'application', { b: 2 });
    await drafts.clearAllForUser('user-1', ['application']);
    expect(asyncStore.size).toBe(0);
    expect(secureStore.size).toBe(0);
  });
});

describe('detectConflict', () => {
  it('reports which side is newer rather than silently picking one', () => {
    expect(
      detectConflict({ updatedAt: '2026-08-05T10:00:00Z' }, { updatedAt: '2026-08-05T09:00:00Z' }),
    ).toBe('local-newer');
    expect(
      detectConflict({ updatedAt: '2026-08-05T08:00:00Z' }, { updatedAt: '2026-08-05T09:00:00Z' }),
    ).toBe('remote-newer');
  });

  it('recognises identical timestamps', () => {
    const t = '2026-08-05T10:00:00Z';
    expect(detectConflict({ updatedAt: t }, { updatedAt: t })).toBe('identical');
  });

  it('reports no conflict when one side is absent', () => {
    expect(detectConflict(null, { updatedAt: '2026-08-05T10:00:00Z' })).toBe('no-conflict');
    expect(detectConflict({ updatedAt: '2026-08-05T10:00:00Z' }, null)).toBe('no-conflict');
  });
});

describe('offlineQueue', () => {
  const post = api.post as jest.Mock;
  const patch = api.patch as jest.Mock;
  const USER = 'user-1';
  const OTHER = 'user-2';

  beforeEach(async () => {
    asyncStore.clear();
    secureStore.clear();
    offlineQueue.__resetMemory();
    post.mockReset();
    patch.mockReset();
    __setNetworkState({ isConnected: true, isReachable: true, type: 'wifi' });
  });

  it('enqueues and reports its size', async () => {
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/m', method: 'POST' });
    expect(await offlineQueue.size(USER)).toBe(1);
  });

  it('stores queued payloads in the ENCRYPTED store, not plaintext', async () => {
    // Queued message bodies are immigration correspondence.
    await offlineQueue.enqueue({
      userId: USER,
      op: 'message.send',
      path: '/m',
      method: 'POST',
      body: { body: 'my passport number is X1234567' },
    });
    expect(secureStore.size).toBeGreaterThan(0);
    expect(JSON.stringify([...asyncStore.values()])).not.toContain('X1234567');
  });

  it('namespaces per user so a shared device cannot replay across accounts', async () => {
    await offlineQueue.enqueue({ userId: USER, op: 'profile.update', path: '/me', method: 'PATCH' });
    expect(await offlineQueue.size(OTHER)).toBe(0);
    await offlineQueue.flush(OTHER);
    expect(patch).not.toHaveBeenCalled();
  });

  it('does nothing while offline', async () => {
    __setNetworkState({ isConnected: false, isReachable: false, type: 'none' });
    expect(isOnline()).toBe(false);
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/m', method: 'POST' });
    const result = await offlineQueue.flush(USER);
    expect(result.sent).toBe(0);
    expect(post).not.toHaveBeenCalled();
    expect(await offlineQueue.size(USER)).toBe(1);
  });

  it('replays queued items when back online and empties the queue', async () => {
    post.mockResolvedValue({});
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/m1', method: 'POST' });
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/m2', method: 'POST' });

    const result = await offlineQueue.flush(USER);

    expect(result.sent).toBe(2);
    expect(await offlineQueue.size(USER)).toBe(0);
  });

  it('replays with auth REQUIRED so an expired token cannot silently drop a message', async () => {
    post.mockResolvedValue({});
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/m', method: 'POST' });
    await offlineQueue.flush(USER);
    expect(post).toHaveBeenCalledWith('/m', undefined, { retries: 0, auth: 'required' });
  });

  it('does NOT lose an item enqueued while a flush is in flight', async () => {
    // The flush used to write back a stale snapshot, destroying anything added
    // during the in-flight requests.
    let release: () => void = () => undefined;
    post.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/first', method: 'POST' });

    const flushing = offlineQueue.flush(USER);
    await new Promise((r) => setTimeout(r, 0));
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/second', method: 'POST' });
    release();
    await flushing;

    const remaining = await offlineQueue.list(USER);
    expect(remaining.map((i) => i.path)).toEqual(['/second']);
  });

  it('routes PATCH items through the patch verb', async () => {
    patch.mockResolvedValue({});
    await offlineQueue.enqueue({
      userId: USER,
      op: 'profile.update',
      path: '/me/profile',
      method: 'PATCH',
    });
    await offlineQueue.flush(USER);
    expect(patch).toHaveBeenCalledWith('/me/profile', undefined, {
      retries: 0,
      auth: 'required',
    });
  });

  it('drops a permanently-failing 4xx instead of retrying it forever', async () => {
    post.mockRejectedValue(
      new ApiError({ kind: 'validation', status: 400, message: 'bad', retryable: false }),
    );
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/m', method: 'POST' });

    const result = await offlineQueue.flush(USER);

    expect(result.dropped).toBe(1);
    expect(await offlineQueue.size(USER)).toBe(0);
  });

  it('does not spend an attempt on a transient network failure', async () => {
    // Wifi flapping in a lift must not exhaust the retry budget of a message
    // whose payload is perfectly fine.
    post.mockRejectedValue(new ApiError({ kind: 'network', status: 0, message: 'offline' }));
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/m', method: 'POST' });

    for (let i = 0; i < 6; i++) await offlineQueue.flush(USER);

    const remaining = await offlineQueue.list(USER);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.attempts).toBe(0);
  });

  it('stops the sweep on the first network failure rather than draining the battery', async () => {
    post.mockRejectedValue(new ApiError({ kind: 'network', status: 0, message: 'offline' }));
    for (const path of ['/m1', '/m2', '/m3']) {
      await offlineQueue.enqueue({ userId: USER, op: 'message.send', path, method: 'POST' });
    }

    await offlineQueue.flush(USER);

    expect(post).toHaveBeenCalledTimes(1);
    expect(await offlineQueue.size(USER)).toBe(3);
  });

  it('drops an item older than the replay window', async () => {
    await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: '/old', method: 'POST' });
    const key = `visaai.offlineQueue.${USER}`;
    const raw = JSON.parse((await secureStorage.getItem(key)) as string) as {
      createdAt: string;
    }[];
    raw[0]!.createdAt = new Date(Date.now() - 48 * 3600_000).toISOString();
    await secureStorage.setItem(key, JSON.stringify(raw));

    const result = await offlineQueue.flush(USER);

    expect(result.dropped).toBe(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('caps the queue so a long offline stretch cannot grow unbounded', async () => {
    for (let i = 0; i < 120; i++) {
      await offlineQueue.enqueue({ userId: USER, op: 'message.send', path: `/m${i}`, method: 'POST' });
    }
    expect(await offlineQueue.size(USER)).toBe(100);
    const items = await offlineQueue.list(USER);
    expect(items[items.length - 1]?.path).toBe('/m119');
  });
});
