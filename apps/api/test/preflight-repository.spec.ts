import { ConflictException } from '@nestjs/common';
import { PreflightRepository } from '../src/modules/preflight/preflight.repository.impl';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';

function repoReturning(error: { code?: string; message: string }) {
  const chain: Record<string, unknown> = {};
  chain.insert = () => chain;
  chain.select = () => chain;
  chain.single = () => Promise.resolve({ data: null, error });
  return new PreflightRepository({
    admin: { from: () => chain },
  } as unknown as SupabaseService);
}

describe('PreflightRepository.insert', () => {
  it('maps the one-in-review unique index (23505) to a 409, not a 500', async () => {
    const repo = repoReturning({ code: '23505', message: 'duplicate key' });
    await expect(
      repo.insert('app-1', { id: 'c1', role: 'consultant' }, null),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('still surfaces any other insert failure as an error', async () => {
    const repo = repoReturning({ code: '42501', message: 'denied' });
    await expect(
      repo.insert('app-1', { id: 'c1', role: 'consultant' }, null),
    ).rejects.toThrow(/insert preflight failed: denied/);
  });
});
