import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

/**
 * `setVisaType` deletes the checkpoint on purpose — it holds requirements for
 * the route the applicant just left. `rebuildChecklist` used to treat a missing
 * checkpoint as "no interview has run, nothing to derive from" and return the
 * stored list unchanged.
 *
 * Those two behaviours meet in the flow every new applicant takes: choose a
 * visa type, open the documents page, and the rebuild that page fires on
 * arrival finds no checkpoint and builds nothing. The vault stays empty however
 * many times it is opened.
 *
 * Observed on production 2026-09-04: an Express Entry application with a route
 * chosen, 17 active requirements in the registry, and 0 checklist_items.
 */

interface Row {
  [key: string]: unknown;
}

/**
 * A Supabase stub that answers per table, so the rehydration path can be
 * observed: it has to read `applications` for the route and country, and
 * `application_profiles` for the answers so far.
 */
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

describe('IntakeService.rebuildChecklist — no checkpoint', () => {
  it('rehydrates from the application instead of giving up', async () => {
    const checkpoint = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const svc = makeService(checkpoint);

    const db = makeDb({
      applications: {
        id: 'app-1',
        user_id: 'user-1',
        destination_country: 'CA',
        destination_state: null,
        visa_type_id: 'visa-express-entry',
        framework_id: null,
      },
      application_profiles: { profile_json: { purpose: 'work' } },
      checklist_items: [],
      visa_countries: null,
    });

    await svc.rebuildChecklist(db as never, 'app-1', 'user-1');

    // The point of the fix: the route and the answers are read from Postgres,
    // which is where they live once the checkpoint is gone.
    expect(db.touched).toContain('applications');
    expect(db.touched).toContain('application_profiles');
  });

  it('does not short-circuit on the freshness check when rehydrating', async () => {
    // A rehydrated state has checklistBuiltAt = null, so `isFresh` must be
    // false and the build must be attempted. If this regresses, a route change
    // silently stops producing a checklist again — the exact production
    // symptom, and one no error is ever logged for.
    const checkpoint = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const svc = makeService(checkpoint);

    const db = makeDb({
      applications: {
        id: 'app-1',
        user_id: 'user-1',
        destination_country: 'CA',
        destination_state: null,
        visa_type_id: 'visa-express-entry',
        framework_id: null,
      },
      // A profile updated long ago, and an existing item: the combination that
      // would read as "fresh" if builtAt were ever treated as satisfied.
      application_profiles: { last_updated_at: '2020-01-01T00:00:00.000Z' },
      checklist_items: [{ id: 'item-1', application_id: 'app-1' }],
      visa_countries: null,
    });

    await svc.rebuildChecklist(db as never, 'app-1', 'user-1');

    // Reaching application_profiles for rehydration proves the missing
    // checkpoint no longer ends the call before any work happens.
    expect(db.touched).toContain('application_profiles');
    expect(checkpoint.load).toHaveBeenCalledWith('app-1');
  });
});
