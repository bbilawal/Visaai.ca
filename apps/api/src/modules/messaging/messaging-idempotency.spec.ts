import { MessagingService } from './messaging.service';
import type { IMessagingRepository } from './messaging.repository';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import type { MessagingEventBus } from './messaging-event-bus';
import type { MessagingPresenceService } from './messaging-presence.service';
import { fakeScopedClient } from '../../../test/fakes/scoped-client.fake';

// One shared instance so specs can assert the repo got the SCOPED client
// (not the admin one) — the property that actually matters for RLS.
const scopedClient = fakeScopedClient();

/**
 * Idempotent message sending.
 *
 * The mobile offline queue replays a send whose response was lost in transit.
 * Without a key, that produced a duplicate message in the consultant's thread.
 * These tests pin the contract: same key → same message id, exactly one insert.
 */
const CONVERSATION = { id: 'conv-1', application_id: 'app-1' };
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function setup(
  over: {
    existing?: unknown;
    insertError?: Error;
    findAfterError?: unknown;
  } = {},
) {
  const findByClientId = jest.fn().mockResolvedValue(over.existing ?? null);
  if (over.findAfterError !== undefined) {
    findByClientId
      .mockResolvedValueOnce(over.existing ?? null)
      .mockResolvedValueOnce(over.findAfterError);
  }

  const repo = {
    getConversationByApplication: jest.fn().mockResolvedValue(CONVERSATION),
    createConversation: jest.fn().mockResolvedValue(CONVERSATION),
    insertMessage: over.insertError
      ? jest.fn().mockRejectedValue(over.insertError)
      : jest.fn().mockResolvedValue({ id: 'msg-new', created_at: 't0' }),
    findByClientId,
    touchLastMessageAt: jest.fn().mockResolvedValue(undefined),
    insertNotifications: jest.fn().mockResolvedValue(undefined),
    advanceDelivered: jest.fn().mockResolvedValue(undefined),
    listParticipants: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<IMessagingRepository>;

  const supabase = {
    forUser: jest.fn().mockReturnValue(scopedClient),
    admin: { __admin: true },
  } as unknown as SupabaseService;

  const bus = {
    emit: jest.fn(),
    events: { subscribe: jest.fn() },
  } as unknown as MessagingEventBus;
  const presence = {
    isOnline: jest.fn().mockReturnValue(false),
  } as unknown as MessagingPresenceService;

  // Constructor order is (repo, bus, supabase, presence?) — see messaging.service.ts.
  const svc = new MessagingService(
    repo,
    bus,
    supabase,
    presence,
  ) as MessagingService & {
    recipientIds?: unknown;
  };
  // Recipient resolution reads other tables; not the subject of these tests.
  (svc as unknown as { recipientIds: () => Promise<string[]> }).recipientIds =
    async () => [];

  return { svc: svc, repo };
}

const caller = { id: 'user-1', appRole: 'user' as const };
const input = {
  body: 'hello',
  category: 'general' as const,
  clientId: CLIENT_ID,
};

describe('MessagingService.postMessage — idempotency', () => {
  it('inserts normally when no key is supplied (existing callers unaffected)', async () => {
    const { svc, repo } = setup();
    const result = await svc.postMessage('jwt', caller, 'app-1', {
      body: 'hello',
      category: 'general',
    });
    expect(result).toEqual({ id: 'msg-new' });
    expect(repo.findByClientId).not.toHaveBeenCalled();
    expect(repo.insertMessage).toHaveBeenCalledTimes(1);
  });

  it('persists the key on insert when supplied', async () => {
    const { svc, repo } = setup();
    await svc.postMessage('jwt', caller, 'app-1', input);
    expect(repo.insertMessage).toHaveBeenCalledWith(
      scopedClient,
      expect.objectContaining({ clientId: CLIENT_ID }),
    );
  });

  it('returns the existing message and does NOT insert on replay', async () => {
    const { svc, repo } = setup({ existing: { id: 'msg-original' } });
    const result = await svc.postMessage('jwt', caller, 'app-1', input);
    expect(result).toEqual({ id: 'msg-original' });
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });

  it('resolves the concurrent-replay race via the unique index, not a duplicate', async () => {
    // Both replays pass the pre-check; the second loses at the database.
    const { svc, repo } = setup({
      insertError: new Error(
        'duplicate key value violates unique constraint "messages_client_id_unique"',
      ),
      findAfterError: { id: 'msg-original' },
    });
    const result = await svc.postMessage('jwt', caller, 'app-1', input);
    expect(result).toEqual({ id: 'msg-original' });
    expect(repo.findByClientId).toHaveBeenCalledTimes(2);
  });

  it('rethrows an unrelated insert failure instead of masking it', async () => {
    const { svc } = setup({ insertError: new Error('connection terminated') });
    await expect(
      svc.postMessage('jwt', caller, 'app-1', input),
    ).rejects.toThrow('connection terminated');
  });

  it('rethrows a duplicate-key error when the row cannot be read back', async () => {
    // A unique violation with nothing to return means the index fired on
    // something else; inventing an id would be worse than surfacing the error.
    const { svc } = setup({
      insertError: new Error(
        'duplicate key value violates unique constraint "other_idx"',
      ),
    });
    await expect(
      svc.postMessage('jwt', caller, 'app-1', input),
    ).rejects.toThrow('duplicate key');
  });

  it('RESUMES the fan-out on replay — a recovered send must still notify', async () => {
    // The original request can die after the INSERT but before notifications
    // are written. If the replay short-circuits, the recipient never learns the
    // message exists — the exact failure the offline queue exists to repair.
    const { svc, repo } = setup({
      existing: { id: 'msg-original', created_at: 't0' },
    });
    await svc.postMessage('jwt', caller, 'app-1', input);
    expect(repo.insertMessage).not.toHaveBeenCalled();
    expect(repo.insertNotifications).toHaveBeenCalled();
    expect(repo.touchLastMessageAt).toHaveBeenCalled();
  });

  it('resumes the fan-out after losing the concurrent-replay race too', async () => {
    const { svc, repo } = setup({
      insertError: new Error(
        'duplicate key value violates unique constraint "messages_client_id_unique"',
      ),
      findAfterError: { id: 'msg-original', created_at: 't0' },
    });
    await svc.postMessage('jwt', caller, 'app-1', input);
    expect(repo.insertNotifications).toHaveBeenCalled();
  });

  it('scopes the lookup to the caller and conversation', async () => {
    const { svc, repo } = setup({ existing: { id: 'msg-original' } });
    await svc.postMessage('jwt', caller, 'app-1', input);
    expect(repo.findByClientId).toHaveBeenCalledWith(
      scopedClient,
      'conv-1',
      'user-1',
      CLIENT_ID,
    );
  });
});
