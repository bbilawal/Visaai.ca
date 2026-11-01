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
    searchMessages: jest
      .fn()
      .mockResolvedValue([{ id: 'm1', body: 'bank statement' }]),
    ...over,
  } as unknown as IMessagingRepository;
}
const supabase = { forUser: () => ({ __forUser: true }) } as never;

describe('MessagingService.searchInConversation', () => {
  it('empty query returns [] without touching the repo', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    expect(
      await svc.searchInConversation('tok', { id: 'me' }, 'app-1', '   '),
    ).toEqual([]);
    expect(repo.searchMessages).not.toHaveBeenCalled();
  });

  it('returns [] when no conversation exists', async () => {
    const repo = repoMock({
      getConversationByApplication: jest.fn().mockResolvedValue(null),
    });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    expect(
      await svc.searchInConversation('tok', { id: 'me' }, 'app-1', 'bank'),
    ).toEqual([]);
  });

  it('searches with the trimmed query, conversation id, and limit', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const out = await svc.searchInConversation(
      'tok',
      { id: 'me' },
      'app-1',
      '  bank statement ',
    );
    expect(out).toHaveLength(1);
    expect(repo.searchMessages).toHaveBeenCalledWith(
      { __forUser: true },
      'c1',
      'bank statement',
      50,
    );
  });
});
