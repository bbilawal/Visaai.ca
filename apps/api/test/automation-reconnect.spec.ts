import { AutomationGateway } from '../src/modules/automation/automation.gateway';
import {
  RESUME_WINDOW_MS,
  SessionTokenService,
} from '../src/modules/automation/session-token.service';

/**
 * REVIEW_HANDOFF item 60 — the automation connect token is single-use (Redis
 * GETDEL), and socket.io's automatic reconnect replays the same handshake
 * `auth`. So every transient blip ended the session: the reconnect presented a
 * token that no longer existed, and the panel had no recovery path short of
 * re-launching from the web app.
 *
 * A successful connection is now handed a rotating, single-use resume token,
 * bounded by an absolute window fixed at first connect.
 */

class FakeRedis {
  store = new Map<string, string>();
  async set(k: string, v: string) {
    this.store.set(k, v);
    return 'OK';
  }
  async getdel(k: string) {
    const v = this.store.get(k) ?? null;
    this.store.delete(k);
    return v;
  }
}

function tokenService() {
  const svc = new SessionTokenService({} as never);
  const redis = new FakeRedis();
  (svc as unknown as { redis: FakeRedis }).redis = redis;
  return { svc, redis };
}

const PAYLOAD = { sessionId: 's1', applicationId: 'a1', userId: 'u1' };

function client(auth: Record<string, unknown>) {
  const emitted: { event: string; payload: any }[] = [];
  return {
    handshake: { auth },
    data: {} as Record<string, string>,
    emitted,
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  };
}

function gateway(svc: SessionTokenService, resumable = true) {
  const automation = {
    getSessionPortalUrl: jest.fn().mockResolvedValue('https://x.canada.ca'),
    isSessionResumable: jest.fn().mockResolvedValue(resumable),
  };
  const g = new AutomationGateway(
    svc,
    automation as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { g, automation };
}

const ready = (c: ReturnType<typeof client>) =>
  c.emitted.find((e) => e.event === 'automation:ready')?.payload;

describe('automation reconnect (item 60)', () => {
  beforeEach(() => jest.useFakeTimers({ now: Date.UTC(2026, 8, 27) }));
  afterEach(() => jest.useRealTimers());

  it('the connect token is still single-use', async () => {
    const { svc } = tokenService();
    const t = await svc.mint(PAYLOAD);
    expect(await svc.redeem(t)).toEqual(PAYLOAD);
    expect(await svc.redeem(t)).toBeNull();
  });

  it('a connection is handed a resume token and a reconnect with it is re-authenticated', async () => {
    const { svc } = tokenService();
    const { g } = gateway(svc);
    const first = client({ token: await svc.mint(PAYLOAD) });
    await g.handleConnection(first as never);
    const r1 = ready(first);
    expect(r1).toMatchObject({ sessionId: 's1', resumed: false });
    expect(typeof r1.resumeToken).toBe('string');

    const second = client({ resumeToken: r1.resumeToken });
    await g.handleConnection(second as never);
    const r2 = ready(second);
    expect(r2).toMatchObject({ sessionId: 's1', resumed: true });
    expect(second.data).toEqual(PAYLOAD);
    // Rotated: a new token each connection.
    expect(r2.resumeToken).not.toBe(r1.resumeToken);
  });

  it('a resume token is single-use: replaying it fails closed', async () => {
    const { svc } = tokenService();
    const { g } = gateway(svc);
    const first = client({ token: await svc.mint(PAYLOAD) });
    await g.handleConnection(first as never);
    const rt = ready(first).resumeToken;

    await g.handleConnection(client({ resumeToken: rt }) as never);
    const replay = client({ resumeToken: rt });
    await g.handleConnection(replay as never);
    expect(ready(replay)).toBeUndefined();
    expect(replay.data).toEqual({});
    expect(replay.emitted[0].event).toBe('automation:error');
    jest.advanceTimersByTime(60);
    expect(replay.disconnect).toHaveBeenCalled();
  });

  it('a resume token is never accepted as a connect token, nor vice versa', async () => {
    const { svc } = tokenService();
    const { g } = gateway(svc);
    const first = client({ token: await svc.mint(PAYLOAD) });
    await g.handleConnection(first as never);
    const rt = ready(first).resumeToken;
    const asConnect = client({ token: rt });
    await g.handleConnection(asConnect as never);
    expect(ready(asConnect)).toBeUndefined();

    const connectToken = await svc.mint(PAYLOAD);
    const asResume = client({ resumeToken: connectToken });
    await g.handleConnection(asResume as never);
    expect(ready(asResume)).toBeUndefined();
  });

  it('resuming never extends the absolute window fixed at first connect', async () => {
    const { svc } = tokenService();
    const { g } = gateway(svc);
    const first = client({ token: await svc.mint(PAYLOAD) });
    await g.handleConnection(first as never);
    let rt = ready(first).resumeToken;

    // Keep reconnecting every 4 minutes (inside each token's own TTL).
    let elapsed = 0;
    let last: ReturnType<typeof client> | null = null;
    while (elapsed < RESUME_WINDOW_MS + 4 * 60_000) {
      jest.advanceTimersByTime(4 * 60_000);
      elapsed += 4 * 60_000;
      last = client({ resumeToken: rt });
      await g.handleConnection(last as never);
      const r = ready(last);
      if (!r) break;
      rt = r.resumeToken;
    }
    expect(ready(last!)).toBeUndefined();
    expect(elapsed).toBeGreaterThan(RESUME_WINDOW_MS - 4 * 60_000);
    expect(elapsed).toBeLessThanOrEqual(RESUME_WINDOW_MS + 4 * 60_000);
  });

  it('a finished (or unreadable) session cannot be resumed', async () => {
    const { svc } = tokenService();
    const { g, automation } = gateway(svc, false);
    const first = client({ token: await svc.mint(PAYLOAD) });
    await g.handleConnection(first as never);
    const again = client({ resumeToken: ready(first).resumeToken });
    await g.handleConnection(again as never);
    expect(automation.isSessionResumable).toHaveBeenCalledWith('s1');
    expect(ready(again)).toBeUndefined();
    expect(again.emitted[0].payload.message).toMatch(/no longer be resumed/);
  });

  it('a Redis failure minting the resume token does not break the connection', async () => {
    const { svc } = tokenService();
    const { g } = gateway(svc);
    const t = await svc.mint(PAYLOAD);
    jest.spyOn(svc, 'mintResume').mockRejectedValue(new Error('redis down'));
    const c = client({ token: t });
    await g.handleConnection(c as never);
    expect(ready(c)).toMatchObject({ sessionId: 's1', resumeToken: null });
  });

  it('a handshake with neither token is dropped', async () => {
    const { svc } = tokenService();
    const { g } = gateway(svc);
    const c = client({ token: 42 });
    await g.handleConnection(c as never);
    expect(c.disconnect).toHaveBeenCalled();
    expect(c.emitted).toEqual([]);
  });
});
