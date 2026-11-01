import { MessagingService } from '../src/modules/messaging/messaging.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { IMessagingRepository } from '../src/modules/messaging/messaging.repository';

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
    searchMessages: jest.fn().mockResolvedValue([]),
    searchAllMessages: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as IMessagingRepository;
}
const supabase = { forUser: () => ({}), admin: {} } as never;

describe('MessagingService search query-length cap', () => {
  it('searchInConversation truncates a >200-char query to 200 chars', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    await svc.searchInConversation(
      'tok',
      { id: 'me' },
      'app-1',
      'a'.repeat(500),
    );
    const passed = (repo.searchMessages as jest.Mock).mock
      .calls[0][2] as string;
    expect(passed).toHaveLength(200);
  });

  it('searchAllConversations truncates a >200-char query to 200 chars', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    await svc.searchAllConversations('tok', { id: 'me' }, 'b'.repeat(500));
    const passed = (repo.searchAllMessages as jest.Mock).mock
      .calls[0][1] as string;
    expect(passed).toHaveLength(200);
  });

  it('leaves a normal-length query unchanged', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    await svc.searchInConversation(
      'tok',
      { id: 'me' },
      'app-1',
      '  bank statement ',
    );
    expect(repo.searchMessages).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      'bank statement',
      50,
    );
  });

  it('whitespace-only query returns [] without a repo call', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    expect(
      await svc.searchAllConversations('tok', { id: 'me' }, '   '),
    ).toEqual([]);
    expect(repo.searchAllMessages).not.toHaveBeenCalled();
  });
});
