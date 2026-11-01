import { SmsService } from './sms.service';
import type { ConfigService } from '@nestjs/config';

function cfg(values: Record<string, string | undefined>): ConfigService<any> {
  return { get: (k: string) => values[k] } as unknown as ConfigService<any>;
}

describe('SmsService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('no-ops (returns unconfigured) and never calls fetch when unconfigured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never);
    const svc = new SmsService(cfg({}));
    expect(await svc.send('+15551234567', 'hi')).toBe('unconfigured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to Twilio and returns ok when configured', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValue({ ok: true, status: 201 } as never);
    const svc = new SmsService(
      cfg({
        TWILIO_ACCOUNT_SID: 'AC123',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_FROM_NUMBER: '+15550000000',
      }),
    );
    expect(await svc.send('+15551234567', 'hello')).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown[] as [
      string,
      RequestInit,
    ];
    expect(String(init.body)).toContain('To=%2B15551234567');
  });

  it('truncates a long body to <= 160 chars', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValue({ ok: true, status: 201 } as never);
    const svc = new SmsService(
      cfg({
        TWILIO_ACCOUNT_SID: 'AC',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_FROM_NUMBER: '+1',
      }),
    );
    await svc.send('+15551234567', 'x'.repeat(500));
    const [, init] = fetchSpy.mock.calls[0] as unknown[] as [
      string,
      RequestInit,
    ];
    const body = new URLSearchParams(String(init.body)).get('Body') ?? '';
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body.endsWith('...')).toBe(true);
  });

  it('returns error (does not throw) when the API responds non-ok', async () => {
    jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValue({ ok: false, status: 400 } as never);
    const svc = new SmsService(
      cfg({
        TWILIO_ACCOUNT_SID: 'AC',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_FROM_NUMBER: '+1',
      }),
    );
    expect(await svc.send('+1555', 'hi')).toBe('error');
  });

  it('returns error (does not throw) when fetch rejects', async () => {
    jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValue(new Error('network') as never);
    const svc = new SmsService(
      cfg({
        TWILIO_ACCOUNT_SID: 'AC',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_FROM_NUMBER: '+1',
      }),
    );
    await expect(svc.send('+1555', 'hi')).resolves.toBe('error');
  });
});
