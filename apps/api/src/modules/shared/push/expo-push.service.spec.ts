import { ConfigService } from '@nestjs/config';
import { ExpoPushService } from './expo-push.service';

function config(values: Record<string, unknown> = {}): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

function mockFetch(
  impl: (url: string, init: RequestInit) => Promise<Partial<Response>>,
): jest.Mock {
  const fn = jest.fn(impl as never);
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

const OK = (tickets: unknown[]): Partial<Response> => ({
  ok: true,
  status: 200,
  json: async () => ({ data: tickets }),
});

describe('ExpoPushService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    (global as unknown as { fetch: unknown }).fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('maps ok tickets to ok per token', async () => {
    mockFetch(async () =>
      OK([
        { status: 'ok', id: '1' },
        { status: 'ok', id: '2' },
      ]),
    );
    const svc = new ExpoPushService(config());
    const res = await svc.sendToTokens(['t1', 't2'], { title: 'T', body: 'B' });
    expect(res.get('t1')).toBe('ok');
    expect(res.get('t2')).toBe('ok');
  });

  it("maps DeviceNotRegistered to 'gone' so the caller prunes it", async () => {
    mockFetch(async () =>
      OK([
        {
          status: 'error',
          message: 'gone',
          details: { error: 'DeviceNotRegistered' },
        },
      ]),
    );
    const svc = new ExpoPushService(config());
    const res = await svc.sendToTokens(['dead'], { title: 'T', body: 'B' });
    expect(res.get('dead')).toBe('gone');
  });

  it("maps other ticket errors to 'error' (not pruned)", async () => {
    mockFetch(async () =>
      OK([
        {
          status: 'error',
          message: 'rate',
          details: { error: 'MessageRateExceeded' },
        },
      ]),
    );
    const svc = new ExpoPushService(config());
    const res = await svc.sendToTokens(['t1'], { title: 'T', body: 'B' });
    expect(res.get('t1')).toBe('error');
  });

  it('never throws on transport failure', async () => {
    mockFetch(async () => {
      throw new Error('ECONNRESET');
    });
    const svc = new ExpoPushService(config());
    await expect(
      svc.sendToTokens(['t1'], { title: 'T', body: 'B' }),
    ).resolves.toBeInstanceOf(Map);
  });

  it('marks the whole batch as error on a non-2xx response', async () => {
    mockFetch(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const svc = new ExpoPushService(config());
    const res = await svc.sendToTokens(['t1', 't2'], { title: 'T', body: 'B' });
    expect([...res.values()]).toEqual(['error', 'error']);
  });

  it('sends the access token as a bearer when configured', async () => {
    const fetchMock = mockFetch(async () => OK([{ status: 'ok' }]));
    const svc = new ExpoPushService(
      config({ EXPO_ACCESS_TOKEN: 'secret-token' }),
    );
    await svc.sendToTokens(['t1'], { title: 'T', body: 'B' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-token',
    );
  });

  it('no-ops when MOBILE_PUSH_ENABLED=false', async () => {
    const fetchMock = mockFetch(async () => OK([{ status: 'ok' }]));
    const svc = new ExpoPushService(config({ MOBILE_PUSH_ENABLED: 'false' }));
    const res = await svc.sendToTokens(['t1'], { title: 'T', body: 'B' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.get('t1')).toBe('error');
  });

  it('chunks above the 100-message batch cap', async () => {
    const fetchMock = mockFetch(async (_url, init) => {
      const body = JSON.parse((init.body as string) ?? '[]') as unknown[];
      return OK(body.map(() => ({ status: 'ok' })));
    });
    const svc = new ExpoPushService(config());
    const tokens = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const res = await svc.sendToTokens(tokens, { title: 'T', body: 'B' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.size).toBe(250);
    expect([...res.values()].every((v) => v === 'ok')).toBe(true);
  });

  it('does not call Expo for an empty token list', async () => {
    const fetchMock = mockFetch(async () => OK([]));
    const svc = new ExpoPushService(config());
    await svc.sendToTokens([], { title: 'T', body: 'B' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
