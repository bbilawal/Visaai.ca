/**
 * An applicant who skips the interview and types their answers on the Forms
 * page (dry run 2026-10-18, app 9f4e15d8): the form generator names its own
 * keys, and 84 answers there became only 42 IRCC writes. These are the keys
 * that form actually holds.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import {
  applyPrefillOverrides,
  buildMappingInputs,
  childrenFromText,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const mapping = () => resolvePortalFill('ircc')!;

const F: Record<string, string> = {
  family_name: 'AHMAD',
  given_name: 'MUZAFFAR',
  full_name: 'MUZAFFAR AHMAD',
  sex: 'Male',
  date_of_birth: '1961-06-15',
  place_of_birth_city: 'Rawalpindi',
  place_of_birth_country: 'Pakistan',
  citizenship: 'Pakistan',
  nationality: 'Pakistan',
  native_language: 'Urdu',
  can_communicate_in_english: 'Yes',
  can_communicate_in_french: 'No',
  marital_status: 'Married',
  father_family_name: 'Rasheed',
  father_given_name: 'Mian Abdul',
  father_date_of_birth: '1935',
  father_country_of_birth: 'Pakistan',
  father_current_country: 'Pakistan',
  mother_family_name: 'Mother',
  mother_given_name: 'DUMMY',
  mother_date_of_birth: '1940',
  mother_country_of_birth: 'Pakistan',
  mother_current_country: 'Pakistan',
  spouse_family_name: 'Ahmad',
  spouse_given_name: 'Sumera',
  spouse_date_of_birth: '1968-10-09',
  spouse_country_of_birth: 'Pakistan',
  spouse_current_country: 'Pakistan',
  spouse_occupation: 'Homemaker',
  children_details:
    'Mian Muhammad Sajawal (son, born 1989-10-14, Pakistan); Mian Muhammad Bilawal (son, born 1989-10-14, Pakistan)',
  national_identity_document_number: '3740553092097',
  national_identity_document_country: 'Pakistan',
  national_identity_document_issue_date: '2017-04-24',
  passport_type: 'Ordinary',
  passport_number: 'AK1182091',
  passport_country_of_issue: 'Pakistan',
  passport_issue_date: '2023-08-07',
  passport_expiry_date: '2033-08-06',
  email_address: 'applicant@example.com',
  telephone_country_code: '1',
  telephone_number: '9052265664',
  telephone_type: 'Cellular',
  residential_address: '138 Millat Colony, Rawalpindi, Pakistan',
  residential_address_line_1: '138 Millat Colony',
  residential_city: 'Rawalpindi',
  residential_postal_code: '46000',
  residential_country: 'Pakistan',
  residential_address_from_date: '1961-06-15',
  mailing_address_same_as_residential: 'Yes',
  current_country_of_residence: 'Pakistan',
  current_country_status: 'Citizen',
  current_country_status_from_date: '1961-06-15',
  application_country: 'Pakistan',
  application_status_in_country: 'Citizen',
  purpose_of_trip: 'Family visit and tourism',
  destination_country: 'Canada',
  destination_city: 'Milton',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
  duration_of_stay_days: '61',
  funds_available_for_stay: '30000',
  host_name: 'Mian Muhammad Bilawal',
  host_relationship: 'Son',
  host_address: '1202 Stirling Todd Terrace, Milton, ON L9E 2E2',
  host_telephone_number: '9052265664',
  host_status: 'Canadian citizen',
  host_visit_start_date: '2027-03-01',
  host_visit_end_date: '2027-04-30',
  current_occupation: 'Retired',
  retirement_date: '2016-10',
  highest_level_of_education: 'Secondary',
  has_travel_history_last_10_years: 'No',
  previous_canada_visit: 'No',
  previous_canada_application: 'Yes',
  visa_refusal_or_denial: 'Yes',
  visa_refusal_or_denial_details: 'Refused 2025-06-30',
  overstayed_or_unauthorized_work_study: 'No',
  criminal_conviction: 'No',
  medical_condition: 'No',
  tuberculosis_contact_or_diagnosis: 'No',
  military_service: 'No',
  political_organization_membership: 'No',
  witnessed_or_participated_in_abuse: 'No',
};

const form = (source: string) =>
  Object.entries(F).map(([key, value]) => ({
    key,
    label: key,
    value,
    source: source as never,
  }));
const fill = (source: string, profile: Record<string, unknown> = {}) =>
  buildMappingInputs(
    mapping(),
    applyPrefillOverrides(mapping(), profile, form(source)),
  );
const keys = (source: string) => new Set(fill(source).map((m) => m.fieldKey));

describe('answers typed on the Forms page reach the IRCC fill', () => {
  it('most of the application, not just the passport page', () => {
    expect(fill('applicant').length).toBeGreaterThanOrEqual(90);
  });

  it.each([
    'purpose_of_visit',
    'birth_city',
    'birth_country',
    'national_id_number',
    'ircc_residence_row',
    'inviter_phone',
    'available_trip_funds_cad',
    'ircc_work_retired_row',
    'refused_or_ordered_to_leave',
    'refusal_details',
    'official_language_ability',
    'ircc_phone_row',
  ])('%s', (k) => {
    expect(keys('applicant').has(k)).toBe(true);
  });

  it('a combined "No" answers each narrower question; nothing is guessed from a "Yes"', () => {
    expect(keys('applicant').has('tuberculosis')).toBe(true);
    const yes = buildMappingInputs(
      mapping(),
      applyPrefillOverrides(mapping(), {}, [
        {
          key: 'tuberculosis_contact_or_diagnosis',
          label: 'TB',
          value: 'Yes',
          source: 'applicant',
        },
      ]),
    ).map((m) => m.fieldKey);
    expect(yes).not.toContain('tuberculosis');
    expect(yes).not.toContain('tuberculosis_contact');
  });

  it('a funds amount in another currency is not written as CAD (live E2E 2026-10-18)', () => {
    const withCurrency = (currency: string) =>
      buildMappingInputs(
        mapping(),
        applyPrefillOverrides(mapping(), {}, [
          ...form('applicant').filter((x) => x.key !== 'funds_available_for_stay'),
          { key: 'funds_available_for_stay', label: 'Funds', value: '4835403.16', source: 'applicant' as never },
          { key: 'funds_currency', label: 'Currency', value: currency, source: 'applicant' as never },
        ]),
      ).map((m) => m.fieldKey);
    expect(withCurrency('PKR')).not.toContain('available_trip_funds_cad');
    expect(withCurrency('CAD')).toContain('available_trip_funds_cad');
  });

  it('an inferred value or another person’s edit on an unmapped key does not count', () => {
    for (const source of ['inferred', 'consultant']) {
      const k = keys(source);
      expect(k.has('available_trip_funds_cad')).toBe(false);
      expect(k.has('refused_or_ordered_to_leave')).toBe(false);
      expect(k.has('tuberculosis')).toBe(false);
    }
  });

  it('an interview answer wins over the Forms page synonym', () => {
    const merged = applyPrefillOverrides(
      mapping(),
      { purpose_of_visit: 'Tourism', city_of_birth: 'Lahore' },
      form('applicant'),
    );
    expect(merged.purpose_of_visit).toBe('Tourism');
    expect(merged.city_of_birth).toBe('Lahore');
  });

  it("a parent's two name halves make the parent's name", () => {
    const rows = buildMappingInputs(mapping(), {
      ...applyPrefillOverrides(mapping(), {}, form('applicant')),
      father_occupation: 'Retired',
      father_same_address: true,
      father_coming_to_canada: false,
    }).map((m) => String(m.mappedValue));
    expect(rows).toContain('Rasheed');
    expect(rows).toContain('Mian Abdul');
  });

  it('the residential postal code reaches the IRCC address', () => {
    const out = fill('applicant');
    expect(
      out.find((m) => m.fieldKey === 'mailing_postal_code')?.mappedValue,
    ).toBe('46000');
  });

  it('children details name each child; a child row fills once the text says where they live and whether they come', () => {
    const left = fill('applicant').filter((m) =>
      /ircc_child_/.test(m.fieldKey),
    );
    expect(left).toEqual([]);
    const said = buildMappingInputs(
      mapping(),
      applyPrefillOverrides(mapping(), {}, [
        ...form('applicant').filter((f) => f.key !== 'children_details'),
        {
          key: 'children_details',
          label: 'Children',
          value:
            'Mian Muhammad Sajawal (son, born 1989-10-14, Pakistan, lives in Canada, not coming); ' +
            'Mian Muhammad Bilawal (son, born 1989-10-14, Pakistan, lives in Canada, not coming)',
          source: 'applicant' as never,
        },
      ]),
    ).map((m) => String(m.mappedValue));
    // Bilawal is the host, so his address is known and his row is written;
    // Sajawal's address is not, and IRCC will not save a row without it.
    expect(said).toContain('Bilawal');
    expect(said).toContain('Son');
    expect(said).toContain('Stirling Todd Terrace');
    expect(said).not.toContain('Sajawal');
  });
});

describe('childrenFromText', () => {
  it('reads each stated fact and nothing else', () => {
    expect(
      childrenFromText(
        'Ali Khan (son, born 1988-04-01, Pakistan, lives with me, coming to Canada); Sara Khan',
      ),
    ).toEqual([
      {
        name: 'Ali Khan',
        relationship: 'son',
        date_of_birth: '1988-04-01',
        country_of_birth: 'Pakistan',
        same_address: 'Yes',
        coming_to_canada: 'Yes',
      },
      { name: 'Sara Khan' },
    ]);
  });
  it('nothing from a non-string', () => {
    expect(childrenFromText(undefined)).toEqual([]);
  });
});
