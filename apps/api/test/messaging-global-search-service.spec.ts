import { MessagingService } from '../src/modules/messaging/messaging.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { IMessagingRepository } from '../src/modules/messaging/messaging.repository';

function repoMock(
  over: Partial<IMessagingRepository> = {},
): IMessagingRepository {
  return {
    searchAllMessages: jest
      .fn()
      .mockResolvedValue([{ id: 'm1', application_id: 'app-1' }]),
    ...over,
  } as unknown as IMessagingRepository;
}
const supabase = { forUser: () => ({ __forUser: true }) } as never;

describe('MessagingService.searchAllConversations', () => {
  it('blank query returns [] without touching the repo', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    expect(
      await svc.searchAllConversations('tok', { id: 'me' }, '   '),
    ).toEqual([]);
    expect(repo.searchAllMessages).not.toHaveBeenCalled();
  });

  it('non-blank delegates with the trimmed query + forUser client + limit 50', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const out = await svc.searchAllConversations(
      'tok',
      { id: 'me' },
      '  bank statement ',
    );
    expect(out).toHaveLength(1);
    expect(repo.searchAllMessages).toHaveBeenCalledWith(
      { __forUser: true },
      'bank statement',
      50,
    );
  });
});
