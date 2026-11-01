import { ConsultantRepository } from '../src/modules/consultant/consultant.repository.impl';

function qb(result: { data?: unknown; error?: unknown }) {
  const api: Record<string, unknown> = {
    from: () => api,
    select: () => api,
    upsert: () => api,
    update: () => api,
    insert: () => api,
    eq: () => api,
    order: () => api,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api;
}
function repoWith(result: { data?: unknown; error?: unknown }) {
  // ConsultantRepository ctor takes a single writes: ConsultantWriteClient arg.
  // ConsultantWriteClient has a `client` property we fake here.
  const writes = { client: qb(result) } as never;
  return new ConsultantRepository(writes);
}

describe('ConsultantRepository P3c role methods', () => {
  it('insertAssignment writes role=backup when given', async () => {
    const repo = repoWith({ data: { id: 'a1', role: 'backup' }, error: null });
    const out = await repo.insertAssignment('app', 'c1', 'backup');
    expect(out.role).toBe('backup');
  });
  it('insertAssignment maps 23505 to AssignmentConflictError', async () => {
    const repo = repoWith({
      data: null,
      error: { code: '23505', message: 'dup' },
    });
    await expect(repo.insertAssignment('app', 'c1', 'primary')).rejects.toThrow(
      /active/i,
    );
  });
  it('getActivePrimary returns null when none', async () => {
    const repo = repoWith({ data: null, error: null });
    expect(await repo.getActivePrimary('app')).toBeNull();
  });
  it('listActiveAssignments returns [] when empty', async () => {
    const repo = repoWith({ data: [], error: null });
    expect(await repo.listActiveAssignments('app')).toEqual([]);
  });
});
