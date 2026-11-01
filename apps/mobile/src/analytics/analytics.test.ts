import AsyncStorage from '@react-native-async-storage/async-storage';
import { analytics, flush, loadAnonymousId, EVENTS } from './analytics';
import { api } from '@/api/client';

jest.mock('@/api/client', () => ({ api: { post: jest.fn() } }));

const post = api.post as jest.Mock;
const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;

describe('analytics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    store.clear();
    post.mockReset();
    post.mockResolvedValue({});
    analytics.__reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists a stable anonymous id across calls', async () => {
    const first = await loadAnonymousId();
    const second = await loadAnonymousId();
    expect(first).toBe(second);
    expect(store.get('visaai.anonymousId')).toBe(first);
  });

  it('buffers events and flushes them as one batch', async () => {
    analytics.track('a');
    analytics.track('b');
    expect(post).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, { events: unknown[] }];
    expect(path).toBe('/analytics/collect');
    expect(body.events).toHaveLength(2);
  });

  it('posts to the same ingest route as the web SDK', async () => {
    analytics.track('x');
    await flush();
    expect(post).toHaveBeenCalledWith(
      '/analytics/collect',
      expect.anything(),
      expect.objectContaining({ auth: 'optional', retries: 0 }),
    );
  });

  it('never throws when the ingest call fails', async () => {
    post.mockRejectedValue(new Error('network'));
    analytics.track('x');
    await expect(flush()).resolves.toBeUndefined();
  });

  it('drops the oldest events when the buffer overflows', () => {
    for (let i = 0; i < 80; i++) analytics.track(`e${i}`);
    expect(analytics.__queueSize()).toBeLessThanOrEqual(50);
  });

  it('attaches a session id between startSession and endSession', async () => {
    analytics.startSession();
    analytics.track('mid');
    await flush();
    const body = post.mock.calls[0]![1] as { events: { session_id: string | null }[] };
    expect(body.events.every((e) => e.session_id !== null)).toBe(true);
  });

  it('identifies a user only once', async () => {
    analytics.identify('user-1');
    analytics.identify('user-1');
    await flush();
    const body = post.mock.calls[0]![1] as { events: { name: string }[] };
    expect(body.events.filter((e) => e.name === 'user.identified')).toHaveLength(1);
  });

  it('records screen views as route patterns', async () => {
    analytics.screen('/(app)/dashboard');
    await flush();
    const body = post.mock.calls[0]![1] as { events: { name: string; props: unknown }[] };
    expect(body.events[0]).toMatchObject({
      name: 'screen.viewed',
      props: { path: '/(app)/dashboard' },
    });
  });

  it('exposes a frozen event-name catalogue so funnels cannot drift on a typo', () => {
    expect(EVENTS.applicationSubmitted).toBe('application.submitted');
    expect(Object.values(EVENTS).every((v) => typeof v === 'string')).toBe(true);
  });

  it('sends no personally identifying fields in the envelope', async () => {
    analytics.identify('user-1');
    analytics.track(EVENTS.documentUploadSucceeded, { mime: 'application/pdf' });
    await flush();
    const raw = JSON.stringify(post.mock.calls[0]![1]);
    // The envelope carries ids and enums only — no email, name, or free text.
    expect(raw).not.toMatch(/@/);
    expect(raw).not.toMatch(/passport/i);
  });
});
