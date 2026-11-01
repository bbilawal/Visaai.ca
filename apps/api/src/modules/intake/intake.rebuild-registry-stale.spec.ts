import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

jest.mock('../documents/slot-link', () => ({
  linkOrphanDocuments: jest.fn().mockResolvedValue(0),
}));

/**
 * A checklist was "fresh" whenever the profile had not moved since the last
 * build. Prod 2026-10-20: spousal sponsorship's registry gained 15 documents
 * and forms; an application whose answers had not changed kept its old four
 * slots however often the documents page was opened.
 */
function makeDb(rows: Record<string, unknown>) {
  const touched: string[] = [];
  const db = {
    touched,
    from(table: string) {
      touched.push(table);
      const value = rows[table] ?? null;
      const list = Array.isArray(value) ? value : value ? [value] : [];
      const one = Array.isArray(value) ? (value[0] ?? null) : value;
      const listResult = Promise.resolve({ data: list, error: null });
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => Object.assign(listResult, { limit: () => listResult }),
        limit: () => listResult,
        maybeSingle: () => Promise.resolve({ data: one, error: null }),
        single: () => Promise.resolve({ data: one, error: null }),
      };
      return chain;
    },
  };
  return db;
}

function setup(registryUpdatedAt: string, admin?: ReturnType<typeof makeDb>) {
  const checkpoint = {
    load: jest.fn().mockResolvedValue({
      applicationId: 'app-1',
      checklistBuiltAt: '2026-10-19T21:00:00.000Z',
    }),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new IntakeService(
    (admin ? { admin } : {}) as unknown as SupabaseService,
    checkpoint as unknown as CheckpointService,
    { get: jest.fn().mockReturnValue('sk-test') } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
  const db = makeDb({
    applications: { id: 'app-1', user_id: 'user-1', visa_type_id: 'spousal', destination_country: 'CA' },
    application_profiles: { last_updated_at: '2026-10-19T20:00:00.000Z' },
    checklist_items: [{ id: 'i-photo', document_type: 'applicant_photo' }],
    visa_requirements: [{ updated_at: registryUpdatedAt }],
  });
  return { svc, db };
}

describe('IntakeService.rebuildChecklist — registry changed since the last build', () => {
  it('keeps the stored list when neither the profile nor the registry moved', async () => {
    const { svc, db } = setup('2026-10-19T19:00:00.000Z');
    const items = await svc.rebuildChecklist(db as never, 'app-1', 'user-1');
    expect(items).toEqual([{ id: 'i-photo', document_type: 'applicant_photo' }]);
    // Only the freshness read touched the registry; no framework load.
    expect(db.touched.filter((t) => t === 'visa_requirements')).toHaveLength(1);
    expect(db.touched).not.toContain('visa_types');
  });

  it('rebuilds when the route\'s requirements changed after the build', async () => {
    const { svc, db } = setup('2026-10-20T02:15:05.000Z');
    await svc.rebuildChecklist(db as never, 'app-1', 'user-1').catch(() => undefined);
    // Past the freshness check: the framework loader ran.
    expect(db.touched).toContain('visa_types');
  });

  it('reads the registry with the service client, so a retirement (hidden from the user) counts', async () => {
    const admin = makeDb({ visa_requirements: [{ updated_at: '2026-10-20T03:00:00.000+00:00' }] });
    const { svc, db } = setup('2026-10-19T19:00:00.000Z', admin);
    await svc.rebuildChecklist(db as never, 'app-1', 'user-1').catch(() => undefined);
    expect(admin.touched).toContain('visa_requirements');
    expect(db.touched).not.toContain('visa_requirements');
    expect(db.touched).toContain('visa_types');
  });
});
