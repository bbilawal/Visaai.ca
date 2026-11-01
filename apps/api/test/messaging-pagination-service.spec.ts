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
const msg = (id: string, ts: string) => ({
  id,
  sender_id: 'other',
  created_at: ts,
});

function repoMock(
  over: Partial<IMessagingRepository> = {},
): IMessagingRepository {
  return {
    getConversationByApplication: jest.fn().mockResolvedValue(conv),
    insertConversation: jest.fn().mockResolvedValue(conv),
    upsertParticipant: jest.fn(),
    getApplicationParties: jest
      .fn()
      .mockResolvedValue({ ownerId: 'me', consultantIds: [] }),
    listParticipants: jest.fn().mockResolvedValue([]),
    getLastRead: jest.fn().mockResolvedValue('2026-01-01T00:00:00Z'),
    countUnread: jest.fn().mockResolvedValue(7),
    listMessagesPage: jest.fn(),
    ...over,
  } as unknown as IMessagingRepository;
}
const supabase = {
  forUser: () => scopedClient,
  admin: { __admin: true },
} as never;

describe('MessagingService.getThread pagination', () => {
  it('returns the newest PAGE messages ascending with has_more=true when a PAGE+1th exists, unread via countUnread', async () => {
    // 51 rows newest-first (descending) → has_more true, 50 returned ascending.
    const desc = Array.from({ length: 51 }, (_, i) =>
      msg(`m${i}`, `2026-01-01T00:00:${String(51 - i).padStart(2, '0')}Z`),
    );
    const repo = repoMock({
      listMessagesPage: jest.fn().mockResolvedValue(desc),
    });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const t = await svc.getThread(
      'tok',
      { id: 'me', appRole: 'user' },
      'app-1',
    );
    expect(repo.listMessagesPage).toHaveBeenCalledWith(
      scopedClient,
      'c1',
      51,
      null,
    );
    expect(t.messages).toHaveLength(50);
    expect(t.has_more).toBe(true);
    // ascending: first message older than last
    expect(t.messages[0].created_at < t.messages[49].created_at).toBe(true);
    expect(t.unread_count).toBe(7);
    expect(repo.countUnread).toHaveBeenCalledWith(
      scopedClient,
      'c1',
      'me',
      '2026-01-01T00:00:00Z',
    );
  });

  it('has_more=false when fewer than PAGE+1 returned', async () => {
    const repo = repoMock({
      listMessagesPage: jest
        .fn()
        .mockResolvedValue([msg('m1', 't1'), msg('m2', 't2')]),
    });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const t = await svc.getThread(
      'tok',
      { id: 'me', appRole: 'user' },
      'app-1',
    );
    expect(t.has_more).toBe(false);
    expect(t.messages).toHaveLength(2);
  });
});

describe('MessagingService.listOlderMessages', () => {
  it('returns an ascending page + has_more, querying before the cursor', async () => {
    const desc = Array.from({ length: 51 }, (_, i) =>
      msg(`o${i}`, `2025-12-31T00:00:${String(51 - i).padStart(2, '0')}Z`),
    );
    const repo = repoMock({
      listMessagesPage: jest.fn().mockResolvedValue(desc),
    });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const out = await svc.listOlderMessages(
      'tok',
      { id: 'me' },
      'app-1',
      '2026-01-01T00:00:01Z',
      50,
    );
    expect(repo.listMessagesPage).toHaveBeenCalledWith(
      scopedClient,
      'c1',
      51,
      '2026-01-01T00:00:01Z',
    );
    expect(out.messages).toHaveLength(50);
    expect(out.has_more).toBe(true);
    expect(out.messages[0].created_at < out.messages[49].created_at).toBe(true);
  });

  it('blank before → empty without a query', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    expect(
      await svc.listOlderMessages('tok', { id: 'me' }, 'app-1', '', 50),
    ).toEqual({ messages: [], has_more: false });
    expect(repo.listMessagesPage).not.toHaveBeenCalled();
  });

  it('clamps limit to <=100 and defaults a non-finite limit to PAGE', async () => {
    const repo = repoMock({
      listMessagesPage: jest.fn().mockResolvedValue([]),
    });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    await svc.listOlderMessages('tok', { id: 'me' }, 'app-1', 'b', 9999);
    expect(repo.listMessagesPage).toHaveBeenCalledWith(
      scopedClient,
      'c1',
      101,
      'b',
    ); // 100 + 1
    await svc.listOlderMessages('tok', { id: 'me' }, 'app-1', 'b', Number.NaN);
    expect(repo.listMessagesPage).toHaveBeenCalledWith(
      scopedClient,
      'c1',
      51,
      'b',
    ); // 50 + 1
  });
});
