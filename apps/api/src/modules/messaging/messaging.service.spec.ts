import { MessagingService, type MessagingCaller } from './messaging.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import type { MessagingEventBus } from './messaging-event-bus';
import type { ConversationParticipant } from '@visaai/types';
import { fakeScopedClient } from '../../../test/fakes/scoped-client.fake';

const CONV = { id: 'conv-1', application_id: 'app-1' };

function participant(
  userId: string,
  role: 'user' | 'consultant' | 'admin',
): ConversationParticipant {
  return {
    conversation_id: CONV.id,
    user_id: userId,
    role,
    last_read_at: null,
    delivered_at: null,
    joined_at: '2026-06-15T00:00:00Z',
  };
}

/**
 * Repo double covering the getThread read path. `listParticipants` is a
 * jest.fn so tests can script the pre-seed vs post-seed snapshots.
 */
function makeRepo(participants: ConversationParticipant[]) {
  return {
    getConversationByApplication: jest.fn().mockResolvedValue(CONV),
    insertConversation: jest.fn(),
    listMessagesPage: jest.fn().mockResolvedValue([]),
    getLastRead: jest.fn().mockResolvedValue(null),
    countUnread: jest.fn().mockResolvedValue(0),
    listParticipants: jest.fn().mockResolvedValue(participants),
    upsertParticipant: jest.fn().mockResolvedValue(undefined),
    getApplicationParties: jest.fn(),
  };
}

function makeService(repo: ReturnType<typeof makeRepo>) {
  const supabase = {
    admin: { __admin: true },
    forUser: jest.fn().mockReturnValue(fakeScopedClient()),
  } as unknown as SupabaseService;
  const bus = { emit: jest.fn() } as unknown as MessagingEventBus;

  return new MessagingService(repo as any, bus, supabase);
}

describe('MessagingService.getThread — caller participant self-heal', () => {
  it('seeds a late-assigned consultant who has no participant row yet', async () => {
    const caller: MessagingCaller = {
      id: 'consultant-9',
      appRole: 'consultant',
    };
    const repo = makeRepo([]); // applicant only — consultant claimed AFTER creation
    // pre-seed snapshot empty of the caller, post-seed includes them
    repo.listParticipants
      .mockResolvedValueOnce([participant('owner-1', 'user')])
      .mockResolvedValueOnce([
        participant('owner-1', 'user'),
        participant('consultant-9', 'consultant'),
      ]);
    const svc = makeService(repo);

    const thread = await svc.getThread('tok', caller, 'app-1');

    expect(repo.upsertParticipant).toHaveBeenCalledWith(
      { __admin: true },
      'conv-1',
      'consultant-9',
      'consultant',
    );
    expect(thread.participants.map((p) => p.user_id)).toContain('consultant-9');
  });

  it('does NOT re-seed when the caller already has a participant row', async () => {
    const caller: MessagingCaller = {
      id: 'consultant-9',
      appRole: 'consultant',
    };
    const repo = makeRepo([
      participant('owner-1', 'user'),
      participant('consultant-9', 'consultant'),
    ]);
    const svc = makeService(repo);

    await svc.getThread('tok', caller, 'app-1');

    expect(repo.upsertParticipant).not.toHaveBeenCalled();
    expect(repo.listParticipants).toHaveBeenCalledTimes(1); // no re-read
  });

  it('never seeds an admin (oversight, not a conversation party)', async () => {
    const caller: MessagingCaller = { id: 'admin-1', appRole: 'admin' };
    const repo = makeRepo([participant('owner-1', 'user')]);
    const svc = makeService(repo);

    await svc.getThread('tok', caller, 'app-1');

    expect(repo.upsertParticipant).not.toHaveBeenCalled();
  });
});
