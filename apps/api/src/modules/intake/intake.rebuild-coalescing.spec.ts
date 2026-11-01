import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

/**
 * PERF-002: the rebuild is a structured model generation measured at 9-21s, and
 * nothing stopped two of them running at once for the same application. The
 * freshness guard cannot: it reads `checklistBuiltAt`, written only when a build
 * FINISHES, so every request arriving inside the window sails past it and starts
 * its own generation.
 *
 * Observed on production 2026-09-06: two rebuilds of application 85b16b26
 * started 1.9s apart and took 12.6s and 11.8s — the same list, derived twice
 * from the same profile, at twice the model spend, while the applicant watched
 * an empty vault. Opening the documents page twice in twelve seconds does it.
 */

interface Row {
  [key: string]: unknown;
}

/** Supabase stub answering per table; `touched` records the read order so a
 *  second, coalesced call can be shown to do no work of its own. */
function makeDb(rows: Record<string, Row | Row[] | null>) {
  const touched: string[] = [];
  const db = {
    touched,
    from(table: string) {
      touched.push(table);
      const value = rows[table] ?? null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () =>
          Promise.resolve({
            data: Array.isArray(value) ? value : value ? [value] : [],
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({
            data: Array.isArray(value) ? (value[0] ?? null) : value,
            error: null,
          }),
        single: () =>
          Promise.resolve({
            data: Array.isArray(value) ? (value[0] ?? null) : value,
            error: null,
          }),
      };
      return chain;
    },
  };
  return db;
}

function makeService(checkpoint: Partial<CheckpointService>) {
  return new IntakeService(
    {} as SupabaseService,
    checkpoint as CheckpointService,
    { get: jest.fn().mockReturnValue('sk-test') } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

const APPLICATION: Row = {
  id: 'app-1',
  user_id: 'user-1',
  destination_country: 'CA',
  destination_state: null,
  visa_type_id: 'visa-express-entry',
  framework_id: null,
};

function makeRows(): Record<string, Row | Row[] | null> {
  return {
    applications: APPLICATION,
    application_profiles: { profile_json: { purpose: 'work' } },
    checklist_items: [],
    visa_countries: null,
  };
}

describe('IntakeService.rebuildChecklist — concurrent calls', () => {
  it('runs ONE build when two callers arrive while it is still running', async () => {
    // `load` is the first thing the build does after authorization, so gating it
    // holds both callers inside the build window — exactly the production race.
    let releaseLoad: () => void = () => {};
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const load = jest.fn().mockImplementation(async () => {
      await loadGate;
      return null;
    });
    const checkpoint = { load, save: jest.fn().mockResolvedValue(undefined) };
    const svc = makeService(checkpoint);

    const first = svc.rebuildChecklist(
      makeDb(makeRows()) as never,
      'app-1',
      'user-1',
    );
    const second = svc.rebuildChecklist(
      makeDb(makeRows()) as never,
      'app-1',
      'user-1',
    );

    releaseLoad();
    await Promise.all([first, second]);

    // Before the fix this was 2: two full generations of the same list.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('still authorizes the second caller rather than letting them join blind', async () => {
    // Coalescing must not become a way to read someone else's application: the
    // ownership check runs per caller, outside the shared work.
    const checkpoint = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const svc = makeService(checkpoint);

    // `applications` scoped to user-1 returns nothing for a different user.
    const strangerDb = makeDb({ ...makeRows(), applications: null });

    await expect(
      svc.rebuildChecklist(strangerDb as never, 'app-1', 'stranger'),
    ).rejects.toThrow('Access denied');
  });

  it('does not pin later callers to a failed build', async () => {
    // The in-flight entry is cleared in a `finally`, so a build that throws does
    // not become a permanently cached rejection for that application.
    const checkpoint = {
      load: jest
        .fn()
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const svc = makeService(checkpoint);

    await expect(
      svc.rebuildChecklist(makeDb(makeRows()) as never, 'app-1', 'user-1'),
    ).rejects.toThrow('redis down');

    // A fresh call gets a fresh build.
    await expect(
      svc.rebuildChecklist(makeDb(makeRows()) as never, 'app-1', 'user-1'),
    ).resolves.toBeDefined();
    expect(checkpoint.load).toHaveBeenCalledTimes(2);
  });
});
