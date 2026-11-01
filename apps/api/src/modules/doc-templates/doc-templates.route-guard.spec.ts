import '../../strategies';
import { DocTemplatesService } from './doc-templates.service';
import type { DocumentTemplateStore } from './doc-template.store';

/**
 * A chosen route with no framework gets no country-wide artifacts.
 *
 * Same guard as forms.service: the country fallback answers "every artifact
 * this country uses across all its programs", which is the wrong answer once
 * the applicant has named their route. Dry run 2026-10-16: an eTA applicant was
 * handed visitor-visa artifacts.
 */
function db(app: Record<string, unknown>) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    single: () => Promise.resolve({ data: app, error: null }),
  };
  return { from: () => builder } as any;
}

describe('DocTemplatesService.listForApplication — route guard', () => {
  const store = {
    find: jest.fn().mockResolvedValue(null),
  } as unknown as DocumentTemplateStore;
  const service = new DocTemplatesService(store);

  it('returns nothing when a program-claimed route (eTA) is chosen and no framework names artifacts', async () => {
    const out = await service.listForApplication(
      db({
        id: 'a',
        destination_country: 'CA',
        visa_type_id: 'eta-type',
        visa_types: { visaai_id: 'ca-electronic-travel-authorization-eta' },
        country_frameworks: null,
      }),
      'a',
      'u',
    );
    expect(out).toEqual([]);
  });

  it('still falls back to the country when no route is chosen', async () => {
    const out = await service.listForApplication(
      db({
        id: 'a',
        destination_country: 'CA',
        visa_type_id: null,
        country_frameworks: null,
      }),
      'a',
      'u',
    );
    expect(out.length).toBeGreaterThan(0);
  });

  const codesFor = async (country: string, visaaiId: string) =>
    (
      await service.listForApplication(
        db({
          id: 'a',
          destination_country: country,
          visa_type_id: 'some-type',
          visa_types: { visaai_id: visaaiId },
          country_frameworks: null,
        }),
        'a',
        'u',
      )
    ).map((t) => t.templateCode);

  // Review 2026-10-16: the intake never sets framework_id, so a guard keyed on
  // "visa_type_id set" emptied the official-documents section for EVERY
  // registry application (TRV, super visa, US/UK/AU...). These routes now claim
  // their program, so they get that program's artifacts, still non-empty.
  //
  // 2026-11-01: as unclaimed routes they got the union of every Canada
  // program, so a TRV applicant saw the study and work permit checklists.
  it("serves the visitor-visa route its own checklist, not other programs'", async () => {
    const codes = await codesFor(
      'CA',
      'ca-visitor-visa-temporary-resident-visa',
    );
    expect(codes.sort()).toEqual(['IMM 5476', 'IMM 5484']);
  });

  it('serves the super visa route the family-sponsorship artifacts only', async () => {
    const codes = await codesFor('CA', 'ca-super-visa');
    expect(codes.sort()).toEqual(['IMM 5476', 'IMM 5484']);
    // IMM 5409 is the common-law declaration, a spousal form (2026-11-01).
    expect(codes).not.toContain('IMM 5409');
    expect(codes).not.toContain('IMM 5483');
    expect(codes).not.toContain('IMM 5488');
  });

  it.each([
    ['US', 'us-visitor-visa-b-1-business-b-2-tourism', ['DS-160-DOCS']],
    ['US', 'us-business-visitor', ['DS-160-DOCS']],
    [
      'US',
      'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas',
      ['I-130A', 'I-130INSTR', 'I-864', 'I-864INSTR'],
    ],
    ['GB', 'gb-standard-visitor-visa', ['UKV-DOCS', 'UKV-VISIT-GUIDANCE']],
    ['GB', 'gb-student-visa', ['UKV-DOCS', 'UKV-STUDENT-GUIDANCE']],
    ['AU', 'au-visitor-visa-subclass-600', ['1229', '80', '956']],
    ['AU', 'au-student-visa-subclass-500', ['1229', '80', '956']],
  ])(
    'a claimed %s route (%s) gets its program list',
    async (country, id, expected) => {
      expect((await codesFor(country, id)).sort()).toEqual(expected);
    },
  );

  // A known route no program claims gets only what applies to every program in
  // the country — never another program's checklist or guidance.
  it.each([
    ['GB', 'gb-skilled-worker-visa', ['UKV-DOCS']],
    [
      'AU',
      'au-partner-visa-apply-in-australia-subclass-820-and-801',
      ['80', '956'],
    ],
    ['US', 'us-student-visa-academic-f-vocational-m', []],
    ['FR', 'fr-carte-sejour-salarie', ['ICAO-PHOTO']],
  ])(
    'an unclaimed %s route (%s) gets only the country-wide artifacts',
    async (country, id, expected) => {
      expect((await codesFor(country, id)).sort()).toEqual(expected);
    },
  );

  it("looks an unclaimed route's artifacts up under a cached program row", async () => {
    (store.find as jest.Mock).mockClear();
    await codesFor('GB', 'gb-skilled-worker-visa');
    expect(store.find).toHaveBeenCalledWith({
      countryCode: 'GB',
      program: 'visitor_visa',
      templateCode: 'UKV-DOCS',
    });
  });
});
