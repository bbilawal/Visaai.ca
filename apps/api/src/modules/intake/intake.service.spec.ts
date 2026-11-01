import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { REGISTRY_DESTINATION_CODES } from '../../strategies';

/**
 * Minimal Supabase query-builder stub for the createApplication insert chain:
 *   db.from('applications').insert(row).select('id').single()
 *   db.from('application_profiles').insert(row)
 * Records every insert so tests can assert what was (or was NOT) written.
 */
function makeDb() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: { id: 'app-1' },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return { db: db as any, inserts };
}

function makeService(bus: { emit: jest.Mock }) {
  const config = {
    get: jest.fn().mockReturnValue('test-openai-key'),
  } as unknown as ConfigService;
  return new IntakeService(
    {} as SupabaseService,
    {} as CheckpointService,
    config,
    bus as unknown as AssignmentEventBus,
    // AiUsageMeter became a required 5th dependency; it is only forwarded into
    // buildIntakeGraph, which these country-validation tests never reach.
    {} as AiUsageMeter,
  );
}

describe('IntakeService.createApplication — country validation', () => {
  it('rejects an unsupported country and writes nothing (API bypass attempt)', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db, inserts } = makeDb();

    // 'XK' is not a registered strategy (DE is now a Schengen member → supported).
    await expect(
      service.createApplication(db, 'user-1', { country: 'XK' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(inserts).toHaveLength(0);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('accepts every registry-sourced destination (China, Japan, the Middle East…)', async () => {
    // The regression: these had researched, published visa requirements but no
    // strategy, so the ONLY entry point to the product rejected them outright.
    for (const code of REGISTRY_DESTINATION_CODES) {
      const bus = { emit: jest.fn() };
      const service = makeService(bus);
      const { db, inserts } = makeDb();

      const id = await service.createApplication(db, 'user-1', {
        country: code.toLowerCase(),
      });

      expect(id).toBe('app-1');
      expect(
        inserts.find((i) => i.table === 'applications')?.row
          .destination_country,
      ).toBe(code);
    }
  });

  it('rejects a garbage country code', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db, inserts } = makeDb();

    await expect(
      service.createApplication(db, 'user-1', { country: 'ZZ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserts).toHaveLength(0);
  });

  it('accepts a supported country and stores the canonical (upper-cased) code', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db, inserts } = makeDb();

    const id = await service.createApplication(db, 'user-1', { country: 'ca' });

    expect(id).toBe('app-1');
    const appInsert = inserts.find((i) => i.table === 'applications');
    expect(appInsert?.row.destination_country).toBe('CA');
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'APPLICATION_CREATED',
        destination_country: 'CA',
      }),
    );
  });

  it('rejects the Schengen Area bloc on create (non-selectable; members picked instead)', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db } = makeDb();

    // 'SCHENGEN' stays registered/resolvable for legacy rows, but is no longer
    // a selectable destination — creating a new application with it must 400.
    await expect(
      service.createApplication(db, 'user-1', { country: 'SCHENGEN' }),
    ).rejects.toThrow(/no longer selectable/i);
  });

  it('accepts a Schengen member country and stores its ISO-2 code', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db, inserts } = makeDb();

    await service.createApplication(db, 'user-1', { country: 'DE' });

    const appInsert = inserts.find((i) => i.table === 'applications');
    expect(appInsert?.row.destination_country).toBe('DE');
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'APPLICATION_CREATED',
        destination_country: 'DE',
      }),
    );
  });

  it('canonicalizes a lowercase Schengen member code (de → DE)', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db, inserts } = makeDb();

    await service.createApplication(db, 'user-1', { country: 'de' });

    const appInsert = inserts.find((i) => i.table === 'applications');
    expect(appInsert?.row.destination_country).toBe('DE');
  });

  it('allows a framework-only application (no country)', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db, inserts } = makeDb();

    const id = await service.createApplication(db, 'user-1', {
      frameworkId: 'fw-1',
    });

    expect(id).toBe('app-1');
    const appInsert = inserts.find((i) => i.table === 'applications');
    expect(appInsert?.row.destination_country).toBeNull();
    expect(appInsert?.row.framework_id).toBe('fw-1');
  });

  it('rejects when neither country nor framework is supplied', async () => {
    const bus = { emit: jest.fn() };
    const service = makeService(bus);
    const { db, inserts } = makeDb();

    await expect(service.createApplication(db, 'user-1', {})).rejects.toThrow(
      'Either a destination country or a framework is required',
    );
    expect(inserts).toHaveLength(0);
  });
});
