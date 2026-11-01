import { OutboxProcessor } from './outbox.processor';

function fakeRepo(rows: unknown[]) {
  return {
    claimBatch: jest.fn().mockResolvedValue(rows),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    pruneProcessed: jest.fn().mockResolvedValue(undefined),
  };
}

describe('OutboxProcessor.drainOnce', () => {
  const supabase = { admin: { __admin: true } } as never;

  it('emits each claimed row as a NotificationEvent and marks it processed', async () => {
    const repo = fakeRepo([
      {
        id: 'o1',
        event_type: 'application.status_changed',
        payload: {
          userId: 'u',
          applicationId: 'a',
          data: { status: 'submitted' },
        },
        attempts: 1,
      },
    ]);
    const bus = { emit: jest.fn() };
    const proc = new OutboxProcessor(supabase, bus as never, repo);

    const res = await proc.drainOnce();

    expect(bus.emit).toHaveBeenCalledWith({
      type: 'application.status_changed',
      userId: 'u',
      applicationId: 'a',
      data: { status: 'submitted' },
    });
    expect(repo.markProcessed).toHaveBeenCalledWith(
      (supabase as { admin: unknown }).admin,
      'o1',
    );
    expect(res).toEqual({ processed: 1, failed: 0 });
  });

  it('records last_error and does NOT mark processed when emit throws', async () => {
    const repo = fakeRepo([
      {
        id: 'o2',
        event_type: 'application.status_changed',
        payload: {
          userId: 'u',
          applicationId: 'a',
          data: { status: 'decided' },
        },
        attempts: 1,
      },
    ]);
    const bus = {
      emit: jest.fn(() => {
        throw new Error('bus down');
      }),
    };
    const proc = new OutboxProcessor(supabase, bus as never, repo);

    const res = await proc.drainOnce();

    expect(repo.markFailed).toHaveBeenCalledWith(
      (supabase as { admin: unknown }).admin,
      'o2',
      'bus down',
    );
    expect(repo.markProcessed).not.toHaveBeenCalled();
    expect(res).toEqual({ processed: 0, failed: 1 });
  });

  it('marks an unknown event_type failed rather than emitting garbage', async () => {
    const repo = fakeRepo([
      { id: 'o3', event_type: 'mystery.event', payload: {}, attempts: 1 },
    ]);
    const bus = { emit: jest.fn() };
    const proc = new OutboxProcessor(supabase, bus as never, repo);

    const res = await proc.drainOnce();

    expect(bus.emit).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(
      (supabase as { admin: unknown }).admin,
      'o3',
      expect.stringContaining('mystery.event'),
    );
    expect(res.failed).toBe(1);
  });

  it('prunes processed rows older than 30 days on every drain', async () => {
    const repo = fakeRepo([]);
    const proc = new OutboxProcessor(
      supabase,
      { emit: jest.fn() } as never,
      repo,
    );

    await proc.drainOnce();

    expect(repo.pruneProcessed).toHaveBeenCalledWith(
      (supabase as { admin: unknown }).admin,
      30,
    );
  });
});
