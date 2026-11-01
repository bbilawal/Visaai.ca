/**
 * TRV E2E 2026-10-29 (Pakistani tourist, one week of sightseeing, hotel stay,
 * no host in Canada, self-employed partner of a scrap-metal trade and
 * proprietor of a car wash):
 *  1. the hotel was written on /inviter-info as the inviter;
 *  2. "Inviter's address" was noted for an applicant with no inviter;
 *  3. a sightseeing purpose in the applicant's own words was not Tourism;
 *  4. "Proprietor, car wash and auto detailing" placed no occupation, so the
 *     current-job row was never written.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-business-visitor';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { irccOccupationFor } from '../src/modules/automation/portal-fills/ircc-occupations';

const ircc = () => resolvePortalFill('ircc')!;
const TOURIST: Record<string, unknown> = {
  given_name: 'Imran',
  family_name: 'Test',
  date_of_birth: '1985-01-02',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  purpose_of_visit: 'Tourism',
  planned_entry_date: '2027-06-01',
  planned_departure_date: '2027-06-08',
  family_in_destination: 'No',
};
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(
    ircc(),
    applyPrefillOverrides(ircc(), { ...TOURIST, ...p }, []),
  );
const val = (p: Record<string, unknown>, key: string) =>
  mapped(p).find((m) => m.fieldKey === key)?.mappedValue;
const left = (p: Record<string, unknown>, page: string) =>
  (
    portalFillCoverage(ircc(), { ...TOURIST, ...p }).pages.find(
      (x) => x.page === page,
    )?.left ?? []
  ).map((n) => n.label);

describe('1. lodging is never the inviter', () => {
  it.each([
    'Hilton Toronto Airport Hotel',
    'HI Toronto Hostel',
    'Niagara Falls Inn',
    'Days Inn & Suites',
    'Airbnb (Ottawa)',
    'Blue Mountain Resort',
  ])('"%s" writes no inviter name', (hotel) => {
    const p = { accommodation_provider_name: hotel };
    expect(val(p, 'inviter_family_name')).toBeUndefined();
    expect(val(p, 'inviter_given_name')).toBeUndefined();
  });

  it('a person providing accommodation is still the inviter', () => {
    const p = { accommodation_provider_name: 'Ahmed Khan' };
    expect(val(p, 'inviter_family_name')).toBe('Khan');
  });
});

describe("2. the inviter's address note needs an inviter", () => {
  it('no inviter: no note', () => {
    expect(left({}, '/inviter-info')).not.toContain("Inviter's address");
    expect(
      left({ accommodation_provider_name: 'Hilton Toronto Airport Hotel' }, '/inviter-info'),
    ).not.toContain("Inviter's address");
  });

  it('an inviter without a full address: noted', () => {
    expect(left({ inviter_name: 'Ahmed Khan' }, '/inviter-info')).toContain(
      "Inviter's address",
    );
  });
});

describe('3. tourism in the applicant’s words', () => {
  it.each([
    [
      'purpose_of_visit',
      'I want to visit Canada as a tourist for one week (sightseeing: Niagara Falls, Toronto, Ottawa)',
    ],
    ['travel_purpose', 'Tourism'],
    ['purpose', 'leisure trip'],
    ['purpose_of_travel', 'sight-seeing in Toronto'],
    ['trip_purpose', 'A tour of Ontario'],
    ['reason_for_visit', 'To see Niagara Falls'],
  ])('%s "%s" is Tourism', (key, text) => {
    const p = { purpose_of_visit: undefined, [key]: text };
    expect(val(p, 'ircc_visa_purpose')).toBe('Tourism');
  });

  it('a family visit is still not Tourism', () => {
    const p = {
      purpose_of_visit: undefined,
      travel_purpose: 'Visit my son and see Niagara Falls',
      family_in_destination: 'Yes',
      family_member_name: 'Ahmed Khan',
      relationship_to_family_in_destination: 'son',
      inviter_status: 'Canadian citizen',
    };
    expect(val(p, 'ircc_visa_purpose')).not.toBe('Tourism');
  });
});

describe('4. owners of a service business', () => {
  it.each([
    'Proprietor, car wash and auto detailing',
    'Owner of a car wash',
    'Salon owner',
    'Laundry proprietor',
    'Owner, repair shop',
  ])('"%s" is a customer and personal services manager', (t) => {
    expect(irccOccupationFor(t)).toEqual({
      activity: 'Management occupations',
      title: 'Managers in customer and personal services',
    });
  });

  it.each(['Business owner', 'Proprietor', 'Car wash attendant'])(
    '"%s" is still blank',
    (t) => {
      expect(irccOccupationFor(t)).toBeUndefined();
    },
  );
});

// ── review of 4a13b7cb ──────────────────────────────────────────────────────
describe('review: lodging names', () => {
  it.each([
    'Hôtel Le Germain',
    'Chelsea Lodge',
    'Maple Guest House',
    'Maple Guesthouse',
    'Vrbo cottage',
    'Cozy BnB',
    'Fairmont Royal York',
    'Marriott Downtown',
    'Sheraton Centre',
    'Hilton Toronto',
    'Hyatt Regency',
    'Holiday Inn Express',
    'Best Western Plus',
    'Radisson Blu',
    'Delta Ottawa City Centre',
    'Westin Harbour Castle',
    'Novotel Toronto Centre',
    'Ibis Montreal',
    'easyHotel Toronto',
  ])('"%s" writes no inviter name', (hotel) => {
    const p = { accommodation_provider_name: hotel };
    expect(val(p, 'inviter_family_name')).toBeUndefined();
    expect(val(p, 'inviter_given_name')).toBeUndefined();
  });
});

describe("review: the inviter's address note for any inviter the fill writes", () => {
  const leftOn = (
    route: string,
    p: Record<string, unknown>,
    page = '/inviter-info',
  ) =>
    (
      portalFillCoverage(resolvePortalFillFor('ircc', route)!, {
        ...TOURIST,
        ...p,
      }).pages.find((x) => x.page === page)?.left ?? []
    ).map((n) => n.label);
  const NOTE = "Inviter's address";
  const routes = ['ca-visitor-visa-temporary-resident-visa', 'ca-business-visitors'];

  it.each(routes)('%s: a business contact with no address is noted', (r) => {
    expect(
      leftOn(r, {
        business_contact_name: 'Jane Roy',
        accommodation_provider_name: 'Hilton Hotel',
      }),
    ).toContain(NOTE);
  });
  it.each(routes)('%s: an organization-only inviter is noted', (r) => {
    expect(leftOn(r, { inviter_organization: 'Acme Corp' })).toContain(NOTE);
  });
  it.each(routes)('%s: a hotel alone is not noted', (r) => {
    expect(
      leftOn(r, { accommodation_provider_name: 'Hilton Hotel' }),
    ).not.toContain(NOTE);
  });
});

describe('review: tourism is never a visit to family or friends', () => {
  it.each([
    'visit my uncle and take a tour of Toronto',
    'see my friend and a tour of Ottawa',
    'visit my cousin, leisure',
    'visit my aunt and see Niagara Falls',
    'visit my niece, sight-seeing',
    'visit my nephew and see Niagara',
    'visit my fiancé and a tour of Montreal',
    'visit my fiance, leisure',
    'visit my in-laws and see Niagara',
    'visit my grandparents, leisure',
    'visit relatives and see Niagara',
  ])('"%s" is not Tourism', (text) => {
    const p = { purpose_of_visit: undefined, travel_purpose: text };
    expect(val(p, 'ircc_visa_purpose')).not.toBe('Tourism');
  });
});

describe("review: a service-business occupation is the applicant's own role", () => {
  it.each([
    "Mechanic at my father's repair shop, he is the owner",
    'Hair stylist, reports to the salon manager',
    'Project manager, structural steel detailing',
    'Sales manager, car wash chain',
  ])('"%s" is not a customer and personal services manager', (t) => {
    expect(irccOccupationFor(t)?.title).not.toBe(
      'Managers in customer and personal services',
    );
  });
  it.each([
    'Proprietor, Max Care car wash and auto detailing',
    'Owner of Sparkle car wash',
    'Car wash owner',
    'Managing partner, City Laundry',
  ])('"%s" is a customer and personal services manager', (t) => {
    expect(irccOccupationFor(t)?.title).toBe(
      'Managers in customer and personal services',
    );
  });
});

// ── a title that names no trade (live 2026-10-29) ───────────────────────────
// "Managing Partner and 50% shareholder" at "Max Trading" placed no
// occupation from the title alone, so the current-job row was never written.
const allLeft = (p: Record<string, unknown>) =>
  portalFillCoverage(ircc(), { ...TOURIST, ...p })
    .pages.flatMap((x) => x.left ?? [])
    .map((n) => `${n.label} ${n.note ?? ''}`);

describe('occupation from the title and the business name', () => {
  const JOB = {
    employment_status: 'Self-employed',
    job_title: 'Managing Partner and 50% shareholder',
    employer_name: 'Example Trading',
    job_duties: 'Manage purchasing and sales',
    employment_start_date: '2025-06',
    employer_address: 'Plot 1, Main Road, Lahore, Pakistan',
  };

  it('the current job places an occupation from the employer name', () => {
    expect(allLeft(JOB).join('\n')).not.toMatch(/IRCC occupation for/);
  });

  it('an earlier row places an occupation from its employer name', () => {
    const p = {
      ...JOB,
      work_history: [
        {
          from: '2020-01',
          to: '2025-05',
          job_title: 'Proprietor',
          employer: 'Example Car Wash',
          duties: 'Manage staff',
          address: 'Plot 2, Main Road, Lahore, Pakistan',
        },
      ],
    };
    expect(allLeft(p).join('\n')).not.toMatch(
      /IRCC occupation for "Proprietor"/,
    );
  });

  it('a title and employer naming no trade stay blank', () => {
    expect(
      allLeft({ ...JOB, employer_name: 'Example Holdings' }).join('\n'),
    ).toMatch(/IRCC occupation for/);
  });
});
