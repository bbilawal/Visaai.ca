import { NotificationDeliveryRepository } from './notification-delivery.repository.impl';

describe('NotificationDeliveryRepository.markStatus', () => {
  const repo = new NotificationDeliveryRepository();

  it('increments the attempt counter atomically via the RPC (no read-modify-write)', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn();
    const db = { rpc, from } as never;

    await repo.markStatus(db, 'del-1', 'sent');

    expect(rpc).toHaveBeenCalledWith('bump_delivery_attempt', {
      p_delivery_id: 'del-1',
      p_status: 'sent',
      p_error: null,
    });
    // must NOT select attempts first — the whole point is atomicity
    expect(from).not.toHaveBeenCalled();
  });

  it('passes the error message through to the RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const db = { rpc, from: jest.fn() } as never;

    await repo.markStatus(db, 'del-2', 'failed', 'smtp timeout');

    expect(rpc).toHaveBeenCalledWith('bump_delivery_attempt', {
      p_delivery_id: 'del-2',
      p_status: 'failed',
      p_error: 'smtp timeout',
    });
  });

  it('throws when the RPC returns an error', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { message: 'rpc boom' } });
    const db = { rpc, from: jest.fn() } as never;

    await expect(repo.markStatus(db, 'del-3', 'sent')).rejects.toThrow(
      'rpc boom',
    );
  });
});
