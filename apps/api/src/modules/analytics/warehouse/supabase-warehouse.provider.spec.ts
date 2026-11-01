import { SupabaseWarehouseProvider } from './supabase-warehouse.provider';
import { makeServerEvent } from '../events/catalog';

// Stub Supabase admin client. `selectData` controls what `.upsert().select()`
// resolves to (simulating ON CONFLICT DO NOTHING RETURNING * returning only the
// rows actually inserted). `deleteCount` controls the exact count returned by
// `.delete({ count }).lt()`.
function stubSupabase(opts: { selectData?: any[]; deleteCount?: number } = {}) {
  const calls: any[] = [];
  const admin = {
    from(table: string) {
      return {
        upsert(rows: any[], upsertOpts: any) {
          calls.push({ table, rows, opts: upsertOpts });
          const data = opts.selectData ?? rows;
          return { select: () => Promise.resolve({ data, error: null }) };
        },
        delete(deleteOpts: any) {
          calls.push({ table, delete: true, deleteOpts });
          return {
            lt(col: string, val: any) {
              calls.push({ table, lt: [col, val] });
              return Promise.resolve({
                error: null,
                count: opts.deleteCount ?? 0,
              });
            },
          };
        },
      };
    },
    rpc(fn: string, args: any) {
      calls.push({ rpc: fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { admin, calls } as any;
}

describe('SupabaseWarehouseProvider', () => {
  it('writeEvents upserts with ignoreDuplicates on the dedupe key', async () => {
    const sb = stubSupabase();
    const wh = new SupabaseWarehouseProvider(sb);
    const res = await wh.writeEvents([
      makeServerEvent('user.registered', { user_id: 'u1' }),
    ]);
    const call = sb.calls.find(
      (c: any) => c.table === 'analytics_event_stream',
    );
    expect(call.opts.onConflict).toBe('event_id,occurred_at');
    expect(call.opts.ignoreDuplicates).toBe(true);
    expect(res.inserted).toBe(1);
  });

  it('writeEvents reports inserted from returned data, not batch length (dedupe)', async () => {
    // 3 events sent, but with ignoreDuplicates only 1 row is actually inserted
    // and returned by .select(). inserted must reflect the data, not the batch.
    const sb = stubSupabase({ selectData: [{ event_id: 'x' }] });
    const wh = new SupabaseWarehouseProvider(sb);
    const batch = [
      makeServerEvent('user.registered', { user_id: 'u1' }),
      makeServerEvent('user.registered', { user_id: 'u1' }),
      makeServerEvent('user.registered', { user_id: 'u1' }),
    ];
    const res = await wh.writeEvents(batch);
    expect(res.inserted).toBe(1);
  });

  it('pruneBefore returns 0 dropped partitions when nothing was deleted', async () => {
    const sb = stubSupabase({ deleteCount: 0 });
    const wh = new SupabaseWarehouseProvider(sb);
    const res = await wh.pruneBefore('2026-01-01T00:00:00.000Z');
    expect(res.droppedPartitions).toBe(0);
    const del = sb.calls.find((c: any) => c.delete === true);
    expect(del.deleteOpts).toEqual({ count: 'exact' });
  });

  it('pruneBefore returns 1 dropped partition when rows were deleted', async () => {
    const sb = stubSupabase({ deleteCount: 5 });
    const wh = new SupabaseWarehouseProvider(sb);
    const res = await wh.pruneBefore('2026-01-01T00:00:00.000Z');
    expect(res.droppedPartitions).toBe(1);
  });

  it('ensurePartition calls the ensure_month_partition rpc', async () => {
    const sb = stubSupabase();
    const wh = new SupabaseWarehouseProvider(sb);
    await wh.ensurePartition('2026-07-01');
    expect(sb.calls.some((c: any) => c.rpc === 'ensure_month_partition')).toBe(
      true,
    );
  });
});
