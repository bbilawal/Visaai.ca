import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { linkOrphanDocuments } from '../documents/slot-link';

jest.mock('../documents/slot-link', () => ({
  linkOrphanDocuments: jest.fn().mockResolvedValue(0),
}));

/**
 * Opening the documents page fires a checklist rebuild, and a rebuild whose
 * list is newer than the profile returns the stored list without running the
 * update node — so without this, the slot settling in `linkOrphanDocuments`
 * (link a valid file into a slot that holds only an expired one, un-verify a
 * slot whose files all failed expiry) would wait for the next profile change.
 * Prod app 61f16bb5 (2026-10-16): medical_insurance read 'verified' on a
 * policy that expired 2026-05-31 while the covering policy sat unlinked.
 */
function makeDb(rows: Record<string, unknown>) {
  const db = {
    from(table: string) {
      const value = rows[table] ?? null;
      const list = Array.isArray(value) ? value : value ? [value] : [];
      const one = Array.isArray(value) ? (value[0] ?? null) : value;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => Promise.resolve({ data: list, error: null }),
        maybeSingle: () => Promise.resolve({ data: one, error: null }),
        single: () => Promise.resolve({ data: one, error: null }),
      };
      return chain;
    },
  };
  return db;
}

describe('IntakeService.rebuildChecklist — fresh list', () => {
  it('still settles document slots before returning the stored list', async () => {
    const checkpoint = {
      load: jest.fn().mockResolvedValue({
        applicationId: 'app-1',
        checklistBuiltAt: '2026-10-16T21:00:00.000Z',
      }),
      save: jest.fn(),
    };
    const svc = new IntakeService(
      {} as SupabaseService,
      checkpoint as unknown as CheckpointService,
      { get: jest.fn().mockReturnValue('sk-test') } as unknown as ConfigService,
      { emit: jest.fn() } as unknown as AssignmentEventBus,
      {} as AiUsageMeter,
    );
    const db = makeDb({
      applications: { id: 'app-1', user_id: 'user-1', visa_type_id: 'sv' },
      application_profiles: { last_updated_at: '2026-10-16T20:00:00.000Z' },
      checklist_items: [{ id: 'i-ins', document_type: 'medical_insurance' }],
    });

    const items = await svc.rebuildChecklist(db as never, 'app-1', 'user-1');

    expect(linkOrphanDocuments).toHaveBeenCalledWith(db, 'app-1');
    expect(items).toEqual([
      { id: 'i-ins', document_type: 'medical_insurance' },
    ]);
    // Fresh: no rebuild, so nothing re-checkpointed.
    expect(checkpoint.save).not.toHaveBeenCalled();
  });
});
