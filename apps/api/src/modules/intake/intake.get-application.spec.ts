import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

/**
 * `db.from('applications').select(...).eq(...).eq(...).single()` resolving to
 * whatever the test hands it.
 */
function makeDb(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(result),
  };
  return { from: () => chain } as any;
}

function makeService() {
  return new IntakeService(
    {} as SupabaseService,
    {} as CheckpointService,
    { get: jest.fn() } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

describe('IntakeService.getApplication — a fault is not a refusal', () => {
  it('returns null when the row is genuinely absent (PGRST116)', async () => {
    const svc = makeService();
    const db = makeDb({
      data: null,
      error: { code: 'PGRST116', message: 'no rows returned', details: '' },
    });

    await expect(svc.getApplication(db, 'app-1', 'user-1')).resolves.toBeNull();
  });

  it('throws (retryable) rather than returning null when the read itself failed', async () => {
    // The regression: this used to answer null, which every caller reported as
    // ForbiddenException('Access denied') — a permanent-sounding refusal for a
    // transient read failure. Production, 2026-09-03: an intake died on
    // "intake:start failed: Access denied" while the next REST call on the same
    // application and user answered 200.
    const svc = makeService();
    const db = makeDb({
      data: null,
      error: { code: '503', message: 'upstream connect error', details: '' },
    });

    await expect(
      svc.getApplication(db, 'app-1', 'user-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      svc.getApplication(db, 'app-1', 'user-1'),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
  });

  it('returns the row on success', async () => {
    const svc = makeService();
    const db = makeDb({ data: { id: 'app-1' }, error: null });

    await expect(svc.getApplication(db, 'app-1', 'user-1')).resolves.toEqual({
      id: 'app-1',
    });
  });
});
