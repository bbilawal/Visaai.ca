import { NotificationDispatchService } from '../src/modules/notifications/notification-dispatch.service';
import type { MessagingBusEvent } from '../src/modules/messaging/messaging.types';

function deps(
  over: {
    online?: boolean;
    push?: boolean;
    email?: boolean;
    subs?: unknown[];
    pushResult?: string;
    devices?: { token: string }[];
    deviceResult?: string;
  } = {},
) {
  const bus = { events: { subscribe: jest.fn() } };
  const presence = {
    isOnline: jest.fn().mockReturnValue(over.online ?? false),
  };
  const pushRepo = {
    listForUser: jest
      .fn()
      .mockResolvedValue(
        over.subs ?? [{ endpoint: 'https://p', p256dh: 'p', auth: 'a' }],
      ),
    deleteByEndpoint: jest.fn().mockResolvedValue(undefined),
  };
  const prefRepo = {
    getForUser: jest.fn().mockResolvedValue({
      user_id: 'r1',
      email_enabled: over.email ?? true,
      push_enabled: over.push ?? true,
      updated_at: 't',
    }),
  };
  const webPush = {
    send: jest.fn().mockResolvedValue(over.pushResult ?? 'ok'),
  };
  const devices = over.devices ?? [{ token: 'ExponentPushToken[dev1]' }];
  const deviceRepo = {
    listForUser: jest.fn().mockResolvedValue(devices),
    deleteByToken: jest.fn().mockResolvedValue(undefined),
  };
  const expoPush = {
    sendToTokens: jest
      .fn()
      .mockImplementation(
        async (tokens: string[]) =>
          new Map(tokens.map((t) => [t, over.deviceResult ?? 'ok'])),
      ),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const supabase = { admin: { __admin: true } };
  const config = { get: () => 300000 };
  return {
    bus,
    presence,
    pushRepo,
    deviceRepo,
    prefRepo,
    webPush,
    expoPush,
    queue,
    supabase,
    config,
  };
}

function evt(type: string): MessagingBusEvent {
  return {
    type,
    conversation_id: 'c1',
    application_id: 'app-1',
    recipient_ids: ['r1'],
    timestamp: 't',
  } as MessagingBusEvent;
}

function make(d: ReturnType<typeof deps>) {
  // Cast at the CONSTRUCTOR BOUNDARY only. Casting the mock literals
  // themselves (`as never`) made every later `d.webPush.send` a property
  // access on `never`, which is what produced 19 of the 82 TS errors — and it
  // meant the assertions below were never type-checked against the mock shape.
  return new NotificationDispatchService(
    d.bus as never,
    d.presence as never,
    d.supabase as never,
    d.pushRepo as never,
    d.deviceRepo as never,
    d.prefRepo as never,
    d.webPush as never,
    d.expoPush as never,
    d.queue as never,
    d.config as never,
  );
}

describe('NotificationDispatchService', () => {
  it('ignores unrelated event types', async () => {
    const d = deps();
    await make(d).handle(evt('typing'));
    expect(d.webPush.send).not.toHaveBeenCalled();
    expect(d.queue.add).not.toHaveBeenCalled();
  });

  it('away → pushes immediately and enqueues a coalescing email job', async () => {
    const d = deps({ online: false });
    await make(d).handle(evt('message.created'));
    expect(d.webPush.send).toHaveBeenCalled();
    expect(d.queue.add).toHaveBeenCalledWith(
      'coalesced-email',
      { conversationId: 'c1', applicationId: 'app-1', recipientId: 'r1' },
      expect.objectContaining({ delay: 300000, jobId: 'notif-email:c1:r1' }),
    );
  });

  it('online → no push, still enqueues email (re-checked at run time)', async () => {
    const d = deps({ online: true });
    await make(d).handle(evt('message.created'));
    expect(d.webPush.send).not.toHaveBeenCalled();
    expect(d.queue.add).toHaveBeenCalled();
  });

  it('push disabled → no push', async () => {
    const d = deps({ online: false, push: false });
    await make(d).handle(evt('message.created'));
    expect(d.webPush.send).not.toHaveBeenCalled();
  });

  it('email disabled → no email job', async () => {
    const d = deps({ email: false });
    await make(d).handle(evt('message.created'));
    expect(d.queue.add).not.toHaveBeenCalled();
  });

  it('prunes a gone subscription', async () => {
    const d = deps({ online: false, pushResult: 'gone' });
    await make(d).handle(evt('document_request.created'));
    expect(d.pushRepo.deleteByEndpoint).toHaveBeenCalledWith(
      d.supabase.admin,
      'https://p',
    );
  });

  // ── Mobile (Task 9): native device fan-out rides the same pref gate ──
  it('away → also pushes to registered devices with a content-free body', async () => {
    const d = deps({ online: false });
    await make(d).handle(evt('message.created'));
    expect(d.expoPush.sendToTokens).toHaveBeenCalledWith(
      ['ExponentPushToken[dev1]'],
      expect.objectContaining({
        collapseId: 'c1',
        data: expect.objectContaining({
          applicationId: 'app-1',
          conversationId: 'c1',
        }),
      }),
    );
    // The lock-screen body must never carry message content or case detail.
    const message = d.expoPush.sendToTokens.mock.calls[0][1];
    expect(message.body).toBe('You have new activity in your application');
  });

  it('push disabled → no device push either', async () => {
    const d = deps({ online: false, push: false });
    await make(d).handle(evt('message.created'));
    expect(d.expoPush.sendToTokens).not.toHaveBeenCalled();
  });

  it('online → no device push', async () => {
    const d = deps({ online: true });
    await make(d).handle(evt('message.created'));
    expect(d.expoPush.sendToTokens).not.toHaveBeenCalled();
  });

  it('prunes a DeviceNotRegistered token', async () => {
    const d = deps({ online: false, deviceResult: 'gone' });
    await make(d).handle(evt('message.created'));
    expect(d.deviceRepo.deleteByToken).toHaveBeenCalledWith(
      d.supabase.admin,
      'ExponentPushToken[dev1]',
    );
  });

  it('device push failure does not block the email leg', async () => {
    const d = deps({ online: false });
    d.deviceRepo.listForUser.mockRejectedValueOnce(new Error('db down'));
    await make(d).handle(evt('message.created'));
    expect(d.queue.add).toHaveBeenCalled();
  });

  it('no registered devices → no Expo call', async () => {
    const d = deps({ online: false, devices: [] });
    await make(d).handle(evt('message.created'));
    expect(d.expoPush.sendToTokens).not.toHaveBeenCalled();
  });
});
