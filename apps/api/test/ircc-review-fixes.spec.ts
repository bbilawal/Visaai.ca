/** Defects found by the review of the 2026-10-18 IRCC work, each pinned. */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { placePhone } from '../src/modules/automation/portal-fills/phone-numbers';
import { splitPlace } from '../src/modules/automation/portal-fills/ircc-profile';

const mapping = () => resolvePortalFill('ircc')!;
const inputs = (p: Record<string, unknown>) => buildMappingInputs(mapping(), p);
const BASE = {
  given_name: 'Amit',
  family_name: 'Sharma',
  date_of_birth: '1960-01-02',
  nationality: 'India',
  passport_number: 'Z1234567',
  current_country_of_residence: 'India',
};
const purpose = (p: Record<string, unknown>) =>
  inputs({ ...BASE, ...p })
    .find((m) => m.fieldKey === 'ircc_visa_purpose')
    ?.targetField?.match(/(\d+)-input/)?.[1];

describe('visa purpose', () => {
  it("a relative's surgery is a family visit, not medical treatment", () => {
    expect(
      purpose({
        purpose_of_visit: 'Help my daughter after her surgery',
        host_relationship: 'daughter',
        host_status: 'Canadian citizen',
      }),
    ).toBe('688');
    expect(
      purpose({
        purpose_of_visit: 'Scheduled medical treatment at a Toronto hospital',
      }),
    ).toBe('474');
  });
  it.each([
    ['grandmother', 'Canadian citizen', '688'],
    ['grandson', 'Permanent resident', '688'],
    ['mother-in-law', 'Canadian citizen', '471'],
    ['brother-in-law', 'Canadian citizen', '471'],
    ['son-in-law', 'Canadian citizen', '471'],
    ['mother', 'Canadian citizen', '686'],
    ['brother', 'Canadian citizen', '688'],
    ['son', 'Canadian citizen', '688'],
  ])('host %s (%s) → %s', (rel, status, code) => {
    expect(
      purpose({
        purpose_of_visit: 'Family visit',
        host_relationship: rel,
        host_status: status,
      }),
    ).toBe(code);
  });
  it('"contact person" and "business partner" are not family', () => {
    expect(
      purpose({
        purpose_of_visit: 'Visit',
        host_relationship: 'contact person',
        host_status: 'Canadian citizen',
      }),
    ).toBeUndefined();
    expect(
      purpose({
        purpose_of_visit: 'Visit',
        host_relationship: 'business partner',
        host_status: 'Canadian citizen',
      }),
    ).toBeUndefined();
  });
});

describe('address groups do not collide with profile keys', () => {
  it('a Canadian home behind a different mailing address goes to the manual-entry form', () => {
    const t = inputs({
      ...BASE,
      residential_address_street: '12 Main St',
      residential_address_city: 'Toronto',
      residential_address_postal_code: 'M5V 2T6',
      residential_address_country: 'Canada',
      residential_address: '12 Main St, Toronto, ON M5V 2T6, Canada',
      mailing_address: 'PO Box 9, Toronto, ON M5V 1A1, Canada',
      mailing_same_as_residential: 'No',
    })
      .filter((m) => /otherResidentialAddressContactInfo/.test(m.targetField))
      .map((m) => m.targetField);
    expect(t).toContain(
      '#manualEntryaddress_otherResidentialAddressContactInfo-input',
    );
    expect(t).not.toContain(
      '#streetAddress_otherResidentialAddressContactInfo',
    );
  });
});

describe('parents', () => {
  it('a year-only date of death typed on the Forms page is not written; a full one is', () => {
    const form = [
      {
        key: 'father_given_name',
        label: 'x',
        value: 'Abdul',
        source: 'applicant' as const,
      },
      {
        key: 'father_family_name',
        label: 'x',
        value: 'Rasheed',
        source: 'applicant' as const,
      },
      {
        key: 'father_date_of_birth',
        label: 'x',
        value: '1935',
        source: 'applicant' as const,
      },
      {
        key: 'father_country_of_birth',
        label: 'x',
        value: 'Pakistan',
        source: 'applicant' as const,
      },
      {
        key: 'father_deceased',
        label: 'x',
        value: 'Yes',
        source: 'applicant' as const,
      },
      {
        key: 'father_date_of_death',
        label: 'x',
        value: '2015',
        source: 'applicant' as const,
      },
    ];
    const out = buildMappingInputs(
      mapping(),
      applyPrefillOverrides(mapping(), BASE, form),
    );
    // IRCC's date-of-death selects have no "Unknown" (matrix C 46): a year
    // alone is left for the applicant, never written as 2015-Unknown-Unknown.
    expect(
      out.find((m) => m.fieldKey === 'ircc_parent_1_date_of_death'),
    ).toBeUndefined();
    const full = form.map((f) =>
      f.key === 'father_date_of_death' ? { ...f, value: '2015-06-20' } : f,
    );
    const done = buildMappingInputs(
      mapping(),
      applyPrefillOverrides(mapping(), BASE, full),
    );
    expect(
      done
        .filter((m) => m.fieldKey === 'ircc_parent_1_date_of_death')
        .map((m) => m.mappedValue),
    ).toEqual(['2015', '06', '20']);
  });
});

describe('Widowed', () => {
  it("the end date is the spouse's death, not an earlier divorce", () => {
    const out = inputs({
      ...BASE,
      marital_status: 'Widowed',
      spouse_name: 'A B',
      divorce_date: '2010-01-01',
      spouse_date_of_death: '2020-03-04',
    });
    expect(
      out.find((m) => m.targetField === '#endDatePartnerYear_sltDateYear')
        ?.mappedValue,
    ).toBe('2020');
  });
});

describe('phones written with their calling code but no +', () => {
  it.each([
    ['923001234567', { country: 'PAK' }, '92', '3001234567'],
    ['92 300 1234567', { countryCode: '92' }, '92', '3001234567'],
    ['919876543210', { country: 'IND' }, '91', '9876543210'],
    ['9198765432', { country: 'IND' }, '91', '9198765432'],
  ])('%s', (raw, owner, code, number) => {
    const placed = placePhone(raw, owner as never);
    expect(placed).toMatchObject({
      location: 'Other',
      countryCode: code,
      number,
    });
  });
});

describe('places', () => {
  it('a US state or Canadian province code after a city is that country', () => {
    expect(splitPlace('Los Angeles, CA').country).toBe('USA');
    expect(splitPlace('Atlanta, GA').country).toBe('USA');
    expect(splitPlace('Toronto, ON').country).toBe('CAN');
    expect(splitPlace('Rawalpindi, PK').country).toBe('PAK');
  });
});

describe('children addresses typed on the Forms page', () => {
  it('"Name: address" lines reach the child rows', () => {
    const form = [
      {
        key: 'children_details',
        label: 'x',
        value: 'Ali Khan (son, born 1990-01-01, Pakistan, not coming)',
        source: 'applicant' as const,
      },
      {
        key: 'children_addresses',
        label: 'x',
        value: 'Ali Khan: 12 King Street, Toronto, ON M5H 1A1, Canada',
        source: 'applicant' as const,
      },
    ];
    const out = buildMappingInputs(
      mapping(),
      applyPrefillOverrides(mapping(), BASE, form),
    );
    expect(out.map((m) => m.targetField)).toContain(
      '#streetNum_childInfoAddress',
    );
  });
});

describe('a Canadian employer', () => {
  it('uses the manual-entry address form', () => {
    const out = inputs({
      ...BASE,
      current_country_of_residence: 'Canada',
      occupation: 'Registered nurse',
      employer_name: 'Sunnybrook',
      job_duties: 'Patient care',
      employment_start_date: '2019-04',
      employer_address: '2075 Bayview Ave, Toronto, ON M4N 3M5, Canada',
    }).map((m) => m.targetField);
    expect(out).toContain('#manualEntryaddress_workHistoryAddress-input');
    expect(out).not.toContain('#streetAddress_workHistoryAddress');
  });
  it('coverage lists a missing employer address clearly', () => {
    const cov = portalFillCoverage(mapping(), {
      ...BASE,
      occupation: 'Teacher',
      employer_name: 'X',
      job_duties: 'Y',
      employment_start_date: '2019-04',
    });
    const note =
      cov.pages
        .find((p) => p.page === '/activities')
        ?.left.find((l) => l.label === 'Current job')?.note ?? '';
    expect(note).toMatch(/full address/);
  });
});
