import { MessagingService } from '../src/modules/messaging/messaging.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { IMessagingRepository } from '../src/modules/messaging/messaging.repository';
import type { MessagingPresenceService } from '../src/modules/messaging/messaging-presence.service';
import { fakeScopedClient } from './fakes/scoped-client.fake';

// One shared instance so specs can assert the repo got the SCOPED client.
const scopedClient = fakeScopedClient();

const conv = {
  id: 'c1',
  application_id: 'app-1',
  status: 'open',
  consultant_state: null,
  last_message_at: null,
  created_at: 't',
};
const message = {
  id: 'm1',
  conversation_id: 'c1',
  sender_id: 'owner',
  sender_role: 'user',
  category: 'general',
  body: 'hi',
  parent_message_id: null,
  created_at: '2026-06-14T00:00:00.000Z',
  edited_at: null,
  deleted_at: null,
};

function repoMock(
  over: Partial<IMessagingRepository> = {},
): IMessagingRepository {
  return {
    getConversationByApplication: jest.fn().mockResolvedValue(conv),
    insertConversation: jest.fn().mockResolvedValue(conv),
    insertMessage: jest.fn().mockResolvedValue(message),
    touchLastMessageAt: jest.fn().mockResolvedValue(undefined),
    insertNotifications: jest.fn().mockResolvedValue(undefined),
    upsertParticipant: jest.fn().mockResolvedValue(undefined),
    getApplicationParties: jest
      .fn()
      .mockResolvedValue({ ownerId: 'owner', consultantIds: ['consultant'] }),
    advanceDelivered: jest.fn().mockResolvedValue(undefined),
    advanceDeliveredForUser: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as IMessagingRepository;
}
const admin = {} as never;
const supabase = { forUser: () => scopedClient, admin } as never;
const presenceWith = (online: string[]): MessagingPresenceService =>
  ({
    isOnline: (id: string) => online.includes(id),
  }) as unknown as MessagingPresenceService;

describe('MessagingService delivered', () => {
  it('postMessage advances delivered for ONLINE recipients and emits message.delivered to the sender', async () => {
    const repo = repoMock();
    const bus = new MessagingEventBus();
    const delivered: string[] = [];
    bus.events.subscribe((e) => {
      if (e.type === 'message.delivered')
        delivered.push(e.recipient_ids.join(','));
    });
    const svc = new MessagingService(
      repo,
      bus,
      supabase,
      presenceWith(['consultant']),
    );

    await svc.postMessage('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
      body: 'hi',
      category: 'general',
    });

    expect(repo.advanceDelivered).toHaveBeenCalledWith(
      admin,
      'c1',
      ['consultant'],
      '2026-06-14T00:00:00.000Z',
    );
    expect(delivered).toEqual(['owner']); // sender notified
  });

  it('postMessage with NO online recipients neither advances delivered nor emits message.delivered', async () => {
    const repo = repoMock();
    const bus = new MessagingEventBus();
    const delivered: string[] = [];
    bus.events.subscribe((e) => {
      if (e.type === 'message.delivered') delivered.push('x');
    });
    const svc = new MessagingService(repo, bus, supabase, presenceWith([]));

    await svc.postMessage('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
      body: 'hi',
      category: 'general',
    });

    expect(repo.advanceDelivered).not.toHaveBeenCalled();
    expect(delivered).toEqual([]);
  });

  it('markDeliveredOnConnect advances delivered for the whole user via admin', async () => {
    const repo = repoMock();
    const svc = new MessagingService(
      repo,
      new MessagingEventBus(),
      supabase,
      presenceWith([]),
    );
    await svc.markDeliveredOnConnect('u9');
    expect(repo.advanceDeliveredForUser).toHaveBeenCalledWith(
      admin,
      'u9',
      expect.any(String),
    );
  });
});
