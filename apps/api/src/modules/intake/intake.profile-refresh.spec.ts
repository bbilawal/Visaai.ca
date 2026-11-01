import { ConfigService } from '@nestjs/config';
import { IntakeService, withRowProfile } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import type { IntakeState } from './graphs/intake.state';

/**
 * A turn starts from the profile ROW, not only the checkpoint.
 *
 * The checkpoint is a snapshot from when the session opened; documents
 * processed since then write into the row (marriage_date from the nikah nama,
 * children from birth certificates). Dry run 2026-10-15: the applicant went
 * back to correct the marriage date a document had filled, and the extractor
 * — shown only the checkpoint — could not see there was a marriage_date to
 * correct.
 */
describe('withRowProfile', () => {
  it('the row wins: it holds what documents wrote since the session opened', () => {
    expect(
      withRowProfile(
        { purpose_of_visit: 'family', marriage_date: null },
        { marriage_date: '1999-09-16', purpose_of_visit: 'family' },
      ),
    ).toEqual({ purpose_of_visit: 'family', marriage_date: '1999-09-16' });
  });

  it('keeps checkpoint facts the row is missing', () => {
    expect(withRowProfile({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('falls back to the checkpoint when there is no row', () => {
    expect(withRowProfile({ a: 1 }, null)).toEqual({ a: 1 });
  });
});

describe('IntakeService.sendMessage — reads the row before the graph runs', () => {
  function makeDb(row: { data: unknown; error: unknown }) {
    const tables: string[] = [];
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({ data: [], error: null }),
      insert: () => Promise.resolve({ error: null }),
      single: () => Promise.resolve({ data: { id: 'app-1' }, error: null }),
      maybeSingle: () => Promise.resolve(row),
    };
    return {
      tables,
      client: {
        from: (t: string) => {
          tables.push(t);
          return chain;
        },
      } as any,
    };
  }

  function service(saved: Partial<IntakeState>) {
    return new IntakeService(
      {} as SupabaseService,
      {
        load: jest.fn().mockResolvedValue(saved),
        save: jest.fn(),
        acquireMessageLock: jest.fn().mockResolvedValue(true),
        releaseMessageLock: jest.fn().mockResolvedValue(undefined),
      } as unknown as CheckpointService,
      { get: jest.fn() } as unknown as ConfigService,
      { emit: jest.fn() } as unknown as AssignmentEventBus,
      {} as AiUsageMeter,
    );
  }

  it('hands the graph the row profile', async () => {
    const svc = service({
      applicationId: 'app-1',
      profileJson: { purpose_of_visit: 'family' },
      messages: [],
      currentQuestion: 'Q?',
    });
    const db = makeDb({
      data: { profile_json: { marriage_date: '1999-09-16' } },
      error: null,
    });
    const seen = await (svc as any).turnProfile(db.client, 'app-1', {
      purpose_of_visit: 'family',
    });
    expect(seen).toEqual({
      purpose_of_visit: 'family',
      marriage_date: '1999-09-16',
    });
    expect(db.tables).toContain('application_profiles');
  });

  it('a failed read does not fail the turn: the checkpoint is used', async () => {
    const svc = service({});
    const db = makeDb({ data: null, error: { message: 'boom' } });
    const seen = await (svc as any).turnProfile(db.client, 'app-1', { a: 1 });
    expect(seen).toEqual({ a: 1 });
  });
});
