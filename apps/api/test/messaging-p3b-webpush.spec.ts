const sendNotification = jest.fn();
const setVapidDetails = jest.fn();
jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails, sendNotification },
  setVapidDetails,
  sendNotification,
}));

import { WebPushService } from '../src/modules/shared/push/web-push.service';

function svc(configured: boolean) {
  const config = {
    get: (k: string) => {
      if (!configured) return undefined;
      if (k === 'VAPID_PUBLIC_KEY') return 'pub';
      if (k === 'VAPID_PRIVATE_KEY') return 'priv';
      if (k === 'VAPID_SUBJECT') return 'mailto:x@y.z';
      return undefined;
    },
  } as never;
  return new WebPushService(config);
}

const sub = { endpoint: 'https://push', p256dh: 'p', auth: 'a' };

describe('WebPushService', () => {
  beforeEach(() => {
    sendNotification.mockReset();
    setVapidDetails.mockReset();
  });

  it('skips (error) when VAPID unconfigured', async () => {
    expect(await svc(false).send(sub, { title: 't' })).toBe('error');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends and returns ok when configured', async () => {
    sendNotification.mockResolvedValue({});
    const r = await svc(true).send(sub, { title: 't' });
    expect(r).toBe('ok');
    expect(sendNotification).toHaveBeenCalled();
  });

  it('maps 410 to gone', async () => {
    sendNotification.mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    );
    expect(await svc(true).send(sub, { title: 't' })).toBe('gone');
  });

  it('maps other failures to error', async () => {
    sendNotification.mockRejectedValue(
      Object.assign(new Error('boom'), { statusCode: 500 }),
    );
    expect(await svc(true).send(sub, { title: 't' })).toBe('error');
  });
});
