import { ProgressService } from './progress.service';

/**
 * The letters a route requires come from the route (dry run 2026-10-16).
 *
 * REQUIRED_GEN_TYPES was ['loe', 'cover_letter'] for every application, so an
 * eTA — which takes no letters — could never complete its Generate stage, and
 * the applicant was nudged to write a letter of explanation for a CAD 7 online
 * form.
 */
function q(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const b: any = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => result,
    single: () => result,
    then: (f: any, r: any) => result.then(f, r),
  };
  return b;
}

function db(visaaiId: string, gens: unknown[]) {
  let genCalls = 0;
  return {
    from(table: string) {
      switch (table) {
        case 'applications':
          return q({
            id: 'app-1',
            status: 'draft',
            visa_type_id: 'vt-1',
            destination_country: 'CA',
            visa_types: { visaai_id: visaaiId },
          });
        case 'generated_documents':
          genCalls += 1;
          return q(genCalls === 1 ? gens : null);
        case 'checklist_items':
          return q([]);
        default:
          return q(null);
      }
    },
  } as any;
}

describe('ProgressService — route letters', () => {
  it('an eTA needs no letters: Generate is complete with none written', async () => {
    const p = await new ProgressService().forApplication(
      db('ca-electronic-travel-authorization-eta', []),
      'app-1',
      'u',
    );
    expect(p!.stages.find((s) => s.slug === 'narrative')!.state).toBe(
      'complete',
    );
  });

  it('a visitor visa still needs the LOE and the cover letter', async () => {
    const p = await new ProgressService().forApplication(
      db('ca-visitor-visa-temporary-resident-visa', []),
      'app-1',
      'u',
    );
    expect(p!.stages.find((s) => s.slug === 'narrative')!.state).not.toBe(
      'complete',
    );
  });
});
