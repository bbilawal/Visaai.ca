import { ConsultantRepository } from './consultant.repository.impl';
import type { ConsultantWriteClient } from './consultant-write-client';

/**
 * #37 (dry run 2026-10-14): the consultant queue showed "visa TBD" for an
 * application whose visa type (TRV) was set. The label was read from
 * `country_frameworks.visa_type`, reached via `applications.framework_id` —
 * which registry-era applications never set. Their route is
 * `applications.visa_type_id` → `visa_types`.
 */
function makeWrites(tables: Record<string, unknown[]>) {
  const selects: Array<{ table: string; columns: string }> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const op of ['order', 'eq', 'in', 'is']) chain[op] = () => chain;
      chain.select = (columns: string) => {
        selects.push({ table, columns });
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: tables[table] ?? [], error: null });
      return chain;
    },
  };
  return { writes: { client } as unknown as ConsultantWriteClient, selects };
}

const REGISTRY_APP = {
  id: 'app-trv',
  destination_country: 'CA',
  status: 'draft',
  created_at: '2026-10-14T00:00:00Z',
  country_frameworks: null,
  visa_types: { official_name: 'Visitor visa (temporary resident visa)' },
};

const LEGACY_APP = {
  id: 'app-legacy',
  destination_country: 'CA',
  status: 'draft',
  created_at: '2026-10-13T00:00:00Z',
  country_frameworks: { visa_type: 'Super Visa' },
  visa_types: null,
};

describe('consultant queue — visa type label (#37)', () => {
  it('the available queue reads the registry visa type', async () => {
    const { writes, selects } = makeWrites({
      applications: [REGISTRY_APP, LEGACY_APP],
      consultant_assignments: [],
    });
    const items = await new ConsultantRepository(
      writes,
    ).listUnassignedByCountries(['CA']);
    expect(items.find((i) => i.id === 'app-trv')?.visa_type).toBe(
      'Visitor visa (temporary resident visa)',
    );
    expect(items.find((i) => i.id === 'app-legacy')?.visa_type).toBe(
      'Super Visa',
    );
    expect(selects.find((s) => s.table === 'applications')?.columns).toContain(
      'visa_types(',
    );
  });

  it('"my applications" reads the registry visa type too', async () => {
    const { writes } = makeWrites({
      consultant_assignments: [
        { due_at: null, completed_at: null, applications: REGISTRY_APP },
      ],
    });
    const items = await new ConsultantRepository(
      writes,
    ).listMyAssignedApplications('c-1');
    expect(items[0].visa_type).toBe('Visitor visa (temporary resident visa)');
  });

  it('the assigned list used by the dashboard reads it as well', async () => {
    const { writes } = makeWrites({
      consultant_assignments: [{ applications: REGISTRY_APP }],
    });
    const items = await new ConsultantRepository(
      writes,
    ).listAssignedApplications('c-1');
    expect(items[0].visa_type).toBe('Visitor visa (temporary resident visa)');
  });
});
