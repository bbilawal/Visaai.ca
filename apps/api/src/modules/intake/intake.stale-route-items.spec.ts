import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

/**
 * Changing the visa route re-derives the checklist, but `update-checklist` only
 * ever ADDS. The previous route's registry-derived rows stayed on the list, so
 * the applicant was shown documents for a visa they are not applying for.
 *
 * Observed on production 2026-09-04: a Study permit vault listing "A valid
 * email address", "An accepted credit or debit card to pay the eTA fee" and "A
 * valid passport from a visa-exempt country or territory" — all three
 * Electronic travel authorization requirements, left behind by an earlier route.
 */

interface Item {
  id: string;
  added_reason: string;
}

/** Records what was deleted so the policy can be asserted, not just the calls. */
function makeDb(opts: {
  items: Item[];
  linkedItemIds: Array<string | null>;
  visaTypeRow?: Record<string, unknown>;
}) {
  const deleted: string[][] = [];
  const db = {
    deleted,
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => chain,
        delete: () => ({
          in: (_col: string, ids: string[]) => {
            deleted.push(ids);
            return Promise.resolve({ data: null, error: null });
          },
        }),
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'visa_types'
                ? (opts.visaTypeRow ?? null)
                : { id: 'app-1' },
            error: null,
          }),
        single: () =>
          Promise.resolve({
            data: {
              id: 'app-1',
              user_id: 'user-1',
              destination_country: 'CA',
              visa_type_id: 'old-route',
            },
            error: null,
          }),
        then: undefined,
      };

      if (table === 'checklist_items') {
        Object.assign(chain, {
          select: () => ({
            eq: () => Promise.resolve({ data: opts.items, error: null }),
          }),
        });
      }
      if (table === 'documents') {
        Object.assign(chain, {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: opts.linkedItemIds.map((checklist_item_id) => ({
                  checklist_item_id,
                })),
                error: null,
              }),
          }),
        });
      }
      if (table === 'applications') {
        Object.assign(chain, {
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        });
      }
      return chain;
    },
  };
  return db;
}

function makeService() {
  return new IntakeService(
    {} as SupabaseService,
    {
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as CheckpointService,
    { get: jest.fn().mockReturnValue('sk-test') } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

describe('IntakeService.setVisaType — the previous route leaves no documents behind', () => {
  it('removes registry-derived items when the route changes', async () => {
    const db = makeDb({
      items: [
        { id: 'eta-email', added_reason: 'base_requirement' },
        { id: 'eta-card', added_reason: 'base_requirement' },
        { id: 'eta-form', added_reason: 'base_form' },
      ],
      linkedItemIds: [],
    });
    const svc = makeService();

    await svc.setVisaType(db as never, 'app-1', 'user-1', null);

    expect(db.deleted.flat().sort()).toEqual([
      'eta-card',
      'eta-email',
      'eta-form',
    ]);
  });

  it('keeps an item the applicant has already uploaded against', async () => {
    // Deleting it would cascade the document away. Losing an uploaded passport
    // to a dropdown change is far worse than one stale row.
    const db = makeDb({
      items: [
        { id: 'has-upload', added_reason: 'base_requirement' },
        { id: 'no-upload', added_reason: 'base_requirement' },
      ],
      linkedItemIds: ['has-upload'],
    });
    const svc = makeService();

    await svc.setVisaType(db as never, 'app-1', 'user-1', null);

    expect(db.deleted.flat()).toEqual(['no-upload']);
  });

  it('leaves discovery items alone — they came from the applicant, not the route', async () => {
    const db = makeDb({
      items: [
        { id: 'derived', added_reason: 'base_requirement' },
        { id: 'asked', added_reason: 'discovery:Confirms identity' },
        { id: 'asked-form', added_reason: 'discovery_form' },
      ],
      linkedItemIds: [],
    });
    const svc = makeService();

    await svc.setVisaType(db as never, 'app-1', 'user-1', null);

    expect(db.deleted.flat()).toEqual(['derived']);
  });
});
