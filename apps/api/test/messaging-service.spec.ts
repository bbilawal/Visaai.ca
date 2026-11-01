import { MessagingService } from '../src/modules/messaging/messaging.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { IMessagingRepository } from '../src/modules/messaging/messaging.repository';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeScopedClient } from './fakes/scoped-client.fake';

const conv = {
  id: 'c1',
  application_id: 'app-1',
  status: 'open' as const,
  last_message_at: null,
  created_at: 't',
};

function repoMock(
  over: Partial<IMessagingRepository> = {},
): IMessagingRepository {
  const base: IMessagingRepository = {
    findByClientId: jest.fn(),
    setConsultantState: jest.fn(),
    advanceDelivered: jest.fn(),
    advanceDeliveredForUser: jest.fn(),
    searchMessages: jest.fn(),
    searchAllMessages: jest.fn(),
    getConversationByApplication: jest.fn().mockResolvedValue(conv),
    insertConversation: jest.fn().mockResolvedValue(conv),
    listMessages: jest.fn().mockResolvedValue([]),
    listMessagesPage: jest.fn().mockResolvedValue([]),
    countUnread: jest.fn().mockResolvedValue(0),
    insertMessage: jest.fn().mockResolvedValue({
      id: 'm1',
      conversation_id: 'c1',
      sender_id: 'owner',
      sender_role: 'user',
      category: 'general',
      body: 'hi',
      parent_message_id: null,
      created_at: '2026-06-12T00:00:00.000Z',
      edited_at: null,
      deleted_at: null,
    }),
    touchLastMessageAt: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue({ ...conv, status: 'resolved' }),
    advanceLastRead: jest.fn().mockResolvedValue(undefined),
    getLastRead: jest.fn().mockResolvedValue(null),
    listParticipants: jest.fn().mockResolvedValue([]),
    listNotifications: jest.fn().mockResolvedValue([]),
    markNotificationsRead: jest.fn().mockResolvedValue(undefined),
    upsertParticipant: jest.fn().mockResolvedValue(undefined),
    insertNotifications: jest.fn().mockResolvedValue(undefined),
    getApplicationParties: jest
      .fn()
      .mockResolvedValue({ ownerId: 'owner', consultantIds: ['consultant'] }),
  };
  return Object.assign(base, over);
}

const db = fakeScopedClient();
const admin = {} as SupabaseClient;
const supabase = { forUser: () => db, admin } as never;

describe('MessagingService', () => {
  it('postMessage notifies the OTHER party and emits a bus event', async () => {
    const repo = repoMock();
    const bus = new MessagingEventBus();
    const events: string[] = [];
    bus.events.subscribe((e) => events.push(e.recipient_ids.join(',')));
    const svc = new MessagingService(repo, bus, supabase);

    await svc.postMessage('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
      body: 'hi',
      category: 'general',
    });

    // sender is owner -> recipient is the consultant only
    expect(repo.insertNotifications).toHaveBeenCalledWith(admin, [
      expect.objectContaining({
        userId: 'consultant',
        type: 'message.received',
      }),
    ]);
    expect(events).toEqual(['consultant']);
  });

  it('getThread returns the page + has_more and delegates unread to countUnread', async () => {
    // The unread filter logic now lives in repo.countUnread (covered by messaging-perf-*).
    const repo = repoMock({
      listMessagesPage: jest.fn().mockResolvedValue([
        {
          id: 'a',
          sender_id: 'consultant',
          created_at: '2026-06-13T00:00:00.000Z',
        },
      ]),
      getLastRead: jest.fn().mockResolvedValue(null),
      countUnread: jest.fn().mockResolvedValue(3),
    });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const out = await svc.getThread(
      'tok',
      { id: 'owner', appRole: 'user' },
      'app-1',
    );
    expect(out.messages).toHaveLength(1);
    expect(out.has_more).toBe(false);
    expect(out.unread_count).toBe(3);
    expect(repo.countUnread).toHaveBeenCalled();
  });
});
