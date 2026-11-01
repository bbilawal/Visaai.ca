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
  return {
    getConversationByApplication: jest.fn().mockResolvedValue(conv),
    insertConversation: jest.fn().mockResolvedValue(conv),
    listMessagesPage: jest
      .fn()
      .mockResolvedValue([
        { id: 'm1', sender_id: 'other', created_at: '2026-01-01T00:00:01Z' },
      ]),
    getLastRead: jest.fn().mockResolvedValue(null),
    countUnread: jest.fn().mockResolvedValue(0),
    listParticipants: jest.fn().mockResolvedValue([
      {
        conversation_id: 'c1',
        user_id: 'me',
        role: 'user',
        last_read_at: null,
        joined_at: 't',
      },
    ]),
    upsertParticipant: jest.fn(),
    getApplicationParties: jest
      .fn()
      .mockResolvedValue({ ownerId: 'me', consultantIds: [] }),
    ...over,
  } as unknown as IMessagingRepository;
}
const supabase = {
  forUser: () => scopedClient,
  admin: { __admin: true },
} as never;

describe('MessagingService.getThread participants', () => {
  it('includes participants read via the admin client', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const thread = await svc.getThread(
      'tok',
      { id: 'me', appRole: 'user' },
      'app-1',
    );
    expect(thread.participants).toHaveLength(1);
    expect(repo.listParticipants).toHaveBeenCalledWith({ __admin: true }, 'c1');
  });
});
