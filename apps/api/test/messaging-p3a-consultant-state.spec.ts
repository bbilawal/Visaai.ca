import { ForbiddenException } from '@nestjs/common';
import { MessagingService } from '../src/modules/messaging/messaging.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { IMessagingRepository } from '../src/modules/messaging/messaging.repository';
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

function repoMock(
  over: Partial<IMessagingRepository> = {},
): IMessagingRepository {
  const base: IMessagingRepository = {
    listMessagesPage: jest.fn(),
    findByClientId: jest.fn(),
    countUnread: jest.fn(),
    listParticipants: jest.fn(),
    advanceDelivered: jest.fn(),
    advanceDeliveredForUser: jest.fn(),
    searchMessages: jest.fn(),
    searchAllMessages: jest.fn(),
    getConversationByApplication: jest.fn().mockResolvedValue(conv),
    insertConversation: jest.fn().mockResolvedValue(conv),
    listMessages: jest.fn().mockResolvedValue([]),
    insertMessage: jest.fn(),
    touchLastMessageAt: jest.fn(),
    setStatus: jest.fn(),
    advanceLastRead: jest.fn(),
    getLastRead: jest.fn().mockResolvedValue(null),
    listNotifications: jest.fn(),
    markNotificationsRead: jest.fn(),
    upsertParticipant: jest.fn(),
    insertNotifications: jest.fn(),
    getApplicationParties: jest
      .fn()
      .mockResolvedValue({ ownerId: 'owner', consultantIds: ['consultant'] }),
    setConsultantState: jest.fn().mockResolvedValue(undefined),
  };
  return Object.assign(base, over);
}

const adminClient = { __admin: true };
const supabase = { forUser: () => scopedClient, admin: adminClient } as never;

describe('MessagingService.setConsultantState', () => {
  it('rejects non-staff', async () => {
    const svc = new MessagingService(
      repoMock(),
      new MessagingEventBus(),
      supabase,
    );
    await expect(
      svc.setConsultantState(
        'tok',
        { id: 'owner', appRole: 'user' },
        'app-1',
        'under_review',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('staff sets state via the admin client and emits conversation.status', async () => {
    const repo = repoMock();
    const bus = new MessagingEventBus();
    const events: string[] = [];
    bus.events.subscribe((e) => events.push(e.type));
    const svc = new MessagingService(repo, bus, supabase);
    await svc.setConsultantState(
      'tok',
      { id: 'consultant', appRole: 'consultant' },
      'app-1',
      'under_review',
    );
    expect(repo.setConsultantState).toHaveBeenCalledWith(
      adminClient,
      'c1',
      'under_review',
    );
    expect(events).toContain('conversation.status');
  });
});
