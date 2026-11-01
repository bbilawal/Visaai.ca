/**
 * Spousal sponsorship on IRCC's Permanent Residence Portal (prson-srpel),
 * recorded live 2026-10-20 with every branch of the profile and IMM 0008
 * toggled. The principal applicant below is FICTIONAL: the shape of the
 * spousal Forms page (prefilled_form_json keys), no real person's data.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-study-eapp';
import '../src/modules/automation/portal-fills/canada-ircc-pr-family';
import { CA_SPOUSAL_VISAAI_ID, routeHasPortalFill } from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  isProgressivePage,
  portalPageOrder,
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { pageMatches } from '../src/modules/portal-fill/page-groups';
import type { PortalDocument } from '../src/modules/automation/portal-fills/ircc-uploads';
import { portalForRoute } from '../src/strategies';
import {
  PR_FAMILY_MAPPING,
  PR_IMM0008,
  PR_IMM5406,
  PR_IMM5669,
  PR_IMM5562,
  childRelationship,
  siblingRelationship,
  relativeMarital,
  tripLength,
  PR_PROFILE,
  PR_CASE,
  PR_UPLOAD_SLOTS,
  DEPENDANT_ADD,
  DEPENDANT_SAVE,
  MAX_DEPENDANTS,
  dependantRelationship,
  dependentChild,
  dependantsOf,
  PRINCIPAL_5406,
  PRINCIPAL_5669,
  MAX_ROWS,
  diplomaText,
  monthOf,
  shortStatus,
  noneOf,
  backgroundAnswer,
  educationOption,
  marital5406,
  portalPhone,
  provinceAbbr,
  slashDate,
  streetParts,
} from '../src/modules/automation/portal-fills/canada-ircc-pr-family';

const mapping = () => resolvePortalFill('ircc-pr-family')!;

/** Fictional applicant; no real person's data. */
const APPLICANT: Record<string, unknown> = {
  preferred_contact_language: 'English',
  preferred_destination_province: 'Ontario',
  intended_city_of_residence: 'Toronto',
  family_name: 'EXAMPLE',
  given_name: 'TEST APPLICANT',
  has_other_names: 'No',
  sex: 'Male',
  date_of_birth: '1990-01-15',
  city_of_birth: 'Lahore',
  country_of_birth: 'Pakistan',
  nationality: 'Pakistan',
  country_of_residence: 'Pakistan',
  native_language: 'Punjabi',
  official_language_ability: 'English',
  marital_status: 'Married',
  marriage_date: '2023-01-01',
  passport_number: 'AB1234567',
  passport_country: 'Pakistan',
  passport_issue_date: '2024-01-10',
  passport_expiry_date: '2034-01-09',
  has_national_id: 'Yes',
  national_id_number: '35202-1234567-1',
  national_id_country_of_issue: 'Pakistan',
  national_id_issue_date: '2020-05-01',
  national_id_expiry_date: '2035-05-01',
  email_address: 'applicant@example.com',
  phone_number: '+92 300 1234567',
  residential_address: '12 Test Road, Lahore, Punjab 54000, Pakistan',
  residential_city: 'Lahore',
  residential_country: 'Pakistan',
  mailing_same_as_residential: 'Yes',
  current_job_title: 'Accountant',
  highest_education_level: "Bachelor's degree",
  sponsor_family_name: 'SPONSOR',
  sponsor_given_name: 'Test',
  sponsor_date_of_birth: '1992-03-15',
  sponsor_country_of_birth: 'Toronto, Canada',
  sponsor_residential_address: '100 Test Street, Toronto, ON M5V 2T6, Canada',
  sponsor_email_address: 'sponsor@example.com',
  relationship_ceremonies: 'date: 2023-01-01; event: Wedding',
  father_full_name: 'Test Father Example',
  father_date_of_birth: '1960-06-15',
  father_country_of_birth: 'Pakistan',
  father_deceased: 'No',
  father_same_address: 'Yes',
  mother_full_name: 'Test Mother',
  mother_date_of_birth: '1965-10-09',
  mother_country_of_birth: 'Pakistan',
  mother_deceased: 'No',
  mother_same_address: 'Yes',
  previous_canada_application: 'No',
  refused_or_ordered_to_leave: 'No',
  refugee_claim_made: 'No',
  applicant_previous_relationship: 'No',
  ever_charged: 'No',
  ever_convicted: 'No',
  ever_detained: 'No',
  military_service: 'No',
  government_positions: 'none',
  organization_memberships: 'none',
  violent_organization_member: 'No',
  criminal_pattern_organization_member: 'No',
  advocated_violence: 'No',
  war_crimes_involvement: 'No',
  serious_medical_condition: 'No',
};

const inputs = (p: Record<string, unknown>) => buildMappingInputs(mapping(), p);
const byKey = (p: Record<string, unknown>) => {
  const out: Record<string, string> = {};
  for (const i of inputs(p)) out[i.fieldKey] = String(i.mappedValue);
  return out;
};
const selectorOf = (p: Record<string, unknown>, key: string) =>
  inputs(p).find((i) => i.fieldKey === key)?.targetField;

describe('spousal sponsorship: the Permanent Residence Portal', () => {
  it('the route fills the PR portal, signing in at its own login', () => {
    expect(portalForRoute('CA', CA_SPOUSAL_VISAAI_ID)).toMatchObject({
      portalId: 'ircc-pr-family',
      portalUrl: 'https://prson-srpel.apps.cic.gc.ca/en/login',
      assistedFill: true,
    });
    expect(routeHasPortalFill(CA_SPOUSAL_VISAAI_ID)).toBe(true);
    expect(resolvePortalFillFor('ircc-pr-family', CA_SPOUSAL_VISAAI_ID)).toBe(
      PR_FAMILY_MAPPING,
    );
  });

  it('page keys match the live paths, which carry the application id', () => {
    expect(pageMatches('/en/application/profile/4989734', PR_PROFILE)).toBe(
      true,
    );
    expect(pageMatches('/en/application/case/4989734', PR_PROFILE)).toBe(false);
    expect(
      pageMatches('/en/application/case/4989734/imm0008/page3', PR_IMM0008(3)),
    ).toBe(true);
    expect(
      pageMatches('/en/application/case/4989734/imm5406', PR_IMM5406),
    ).toBe(true);
    expect(
      pageMatches('/en/application/case/4989734/imm5669', PR_IMM5669),
    ).toBe(true);
    // One path for every IMM 5406 / 5669 section.
    // French pages: every select is chosen by its English text, so no key matches.
    expect(pageMatches('/fr/application/profile/4989734', PR_PROFILE)).toBe(
      false,
    );
    expect(
      pageMatches('/fr/application/case/4989734/imm0008/page3', PR_IMM0008(3)),
    ).toBe(false);
    expect(
      pageMatches('/fr/application/case/4989734/imm5406', PR_IMM5406),
    ).toBe(false);
    expect(isProgressivePage(PR_IMM5406)).toBe(true);
    expect(isProgressivePage(PR_IMM5669)).toBe(true);
    expect(isProgressivePage(PR_IMM0008(3))).toBe(false);
    expect(portalPageOrder(PR_IMM0008(2))[0]).toBe(PR_PROFILE);
    // The application page itself: its exact path only, never a form page.
    expect(pageMatches('/en/application/case/4989734', PR_CASE)).toBe(true);
    expect(pageMatches('/en/application/case/4989734/', PR_CASE)).toBe(true);
    for (const form of [
      '/en/application/case/4989734/imm5406',
      '/en/application/case/4989734/imm0008/page3',
      '/en/application/profile/4989734',
      '/fr/application/case/4989734',
    ])
      expect(pageMatches(form, PR_CASE)).toBe(false);
    expect(pageMatches('/en/application/case/4989734', PR_IMM5406)).toBe(false);
    expect(isProgressivePage(PR_CASE)).toBe(true);
  });

  it('every field has a page, a category and a label', () => {
    for (const f of mapping()) {
      expect(f.page).toBeTruthy();
      expect(f.category).toBeTruthy();
      expect(f.label).toBeTruthy();
    }
  });

  it('never writes a field the form copies from the profile (disabled there)', () => {
    // Strip the principal-applicant scope: the id is what matters here.
    const selectors = mapping().map(
      (f) => `${f.page} ${f.selector.replace(/^body:has\([^)]*\) /, '')}`,
    );
    // Live 2026-10-21: page 2's correspondence is copied from the profile and
    // disabled; writing it refused the whole page.
    expect(selectors).not.toContain(`${PR_IMM0008(2)} #correspondence`);
    for (const page of [PR_IMM0008(3)])
      for (const id of ['familyName', 'givenName', 'dob'])
        expect(selectors).not.toContain(`${page} #personalDetailsForm-${id}`);
    for (const id of [
      '#mailingPOBox',
      '#MailingStreetNum',
      '#MailingStreetName',
      '#MailingCityTown',
      '#MailingCountry',
      '#MailingProvinceState',
      '#MailingPostalCode',
    ])
      expect(selectors).not.toContain(`${PR_IMM0008(4)} ${id}`);
    for (const id of ['#applicantFullName', '#applicantDOB'])
      expect(selectors).not.toContain(`${PR_IMM5406} ${id}`);
    for (const id of ['#familyName', '#givenName', '#dob'])
      expect(selectors).not.toContain(`${PR_IMM5669} ${id}`);
  });

  it('never presses Save and continue, Complete, Submit or the declaration', () => {
    for (const f of mapping()) {
      expect(f.op === 'dialog_open' || f.op === 'dialog_save').toBe(false);
      // No uploads on the application page until one is recorded live
      // (review B1): no file input is ever written by this mapping.
      expect(f.op).not.toBe('attach_file');
      expect(f.selector + JSON.stringify(f.choices ?? {})).not.toMatch(
        /submit|declar|consent|sign|pay|continue|complete/i,
      );
    }
  });

  it('fills the profile and IMM 0008 for a married applicant living abroad', () => {
    const v = byKey(APPLICANT);
    expect(v).toMatchObject({
      pr_correspondence: 'English',
      pr_family_name: 'EXAMPLE',
      pr_given_name: 'TEST APPLICANT',
      pr_date_of_birth: '1990/01/15',
      pr_mail_street_number: '12',
      pr_mail_street_name: 'Test Road',
      pr_mail_city: 'Lahore',
      pr_mail_country: 'Pakistan',
      pr_mail_postal_code: '54000',
      pr_residential_same: 'Yes',
      pr_interview_language: 'English',
      pr_interpreter: 'No',
      pr_destination_province: 'ON',
      pr_destination_city: 'Toronto',
      pr_used_other_name: 'No',
      pr_sex: 'M Male',
      pr_city_of_birth: 'Lahore',
      pr_country_of_birth: 'Pakistan',
      pr_citizenship: 'Pakistan',
      pr_current_country: 'Pakistan',
      pr_status: 'Citizen',
      pr_marital_status: 'Married',
      pr_partner_since: '2023/01/01',
      pr_partner_family_name: 'SPONSOR',
      pr_partner_given_name: 'Test',
      pr_previously_partnered: 'No',
      pr_primary_phone_location: 'Other',
      pr_primary_phone_code: '92',
      pr_primary_phone_number: '3001234567',
      pr_passport: 'Yes',
      pr_passport_number: 'AB1234567',
      pr_passport_country: 'PAK (Pakistan)',
      pr_passport_issued: '2024/01/10',
      pr_passport_expires: '2034/01/09',
      pr_national_id: 'Yes',
      pr_national_id_number: '3520212345671',
      pr_national_id_country: 'PAK (Pakistan)',
      pr_education_level: 'Bachelor’s Degree',
      pr_current_occupation: 'Accountant',
      pr_native_language: 'Punjabi',
      pr_official_language: 'English',
    });
    // Not in Canada: no last-entry questions; a citizen has no status dates.
    for (const k of [
      'pr_last_entry_date',
      'pr_last_entry_place',
      'pr_status_from',
      'pr_status_to',
    ])
      expect(v[k]).toBeUndefined();
    // Province is only for a Canadian mailing address.
    expect(v.pr_mail_province).toBeUndefined();
    // Nothing guessed for these.
    for (const k of [
      'pr_eye_colour',
      'pr_height_cm',
      'pr_intended_occupation',
      'pr_education_years',
      'pr_contact_by_account_email',
      'pr_language_test',
    ])
      expect(v[k]).toBeUndefined();
  });

  it('radios click the recorded inputs', () => {
    expect(selectorOf(APPLICANT, 'pr_residential_same')).toBe('#yes');
    expect(selectorOf(APPLICANT, 'pr_used_other_name')).toBe(
      '#personalDetailsForm-usedOtherName-no',
    );
    expect(selectorOf(APPLICANT, 'pr_passport')).toBe('#validPassportYes');
    expect(selectorOf(APPLICANT, 'pr_national_id')).toBe('#NICYes');
    expect(selectorOf(APPLICANT, 'pr_primary_phone_location')).toBe(
      '#primaryOther',
    );
  });

  describe('branches', () => {
    it('a resident of Canada: last entry; a permanent resident has no status dates', () => {
      const v = byKey({
        ...APPLICANT,
        country_of_residence: 'Canada',
        status_in_country_of_residence: 'Permanent resident',
        date_of_last_entry: '2021-10-31',
        place_of_last_entry: 'Toronto Pearson',
        phone_number: '905 226 5664',
        residential_address: '1202 Test Terrace, Milton, ON L9E 2E2, Canada',
        residential_city: 'Milton',
        residential_country: 'Canada',
      });
      expect(v).toMatchObject({
        pr_current_country: 'Canada',
        pr_status: 'Permanent resident',
        pr_last_entry_date: '2021/10/31',
        pr_last_entry_place: 'Toronto Pearson',
        pr_mail_province: 'ON',
        pr_mail_postal_code: 'L9E 2E2',
        pr_primary_phone_location: 'Canada/US',
        // Written as the portal shows it, so the readback matches.
        pr_primary_phone_number: '905-226-5664',
      });
      expect(v.pr_primary_phone_code).toBeUndefined();
      expect(v.pr_status_from).toBeUndefined();
    });

    it.each(['Worker', 'Student', 'Visitor', 'Other'])(
      'status %s opens the From/To dates',
      (status) => {
        const v = byKey({
          ...APPLICANT,
          country_of_residence: 'United Arab Emirates',
          status_in_country_of_residence: status,
          status_start_date: '2022-02-01',
          status_end_date: '2027-01-31',
        });
        expect(v.pr_status).toBe(status);
        expect(v.pr_status_from).toBe('2022/02/01');
        expect(v.pr_status_to).toBe('2027/01/31');
        expect(v.pr_last_entry_date).toBeUndefined();
      },
    );

    it.each([
      'Citizen',
      'Refugee claimant',
      'Protected person',
      'Foreign national',
    ])('status %s opens no dates', (status) => {
      const v = byKey({
        ...APPLICANT,
        status_in_country_of_residence: status,
        status_start_date: '2022-02-01',
      });
      expect(v.pr_status_from).toBeUndefined();
    });

    it('other name: Yes with the name, else left', () => {
      const v = byKey({
        ...APPLICANT,
        has_other_names: 'Yes',
        other_names: 'Testa Example',
      });
      expect(v).toMatchObject({
        pr_used_other_name: 'Yes',
        pr_other_family_name: 'Example',
        pr_other_given_name: 'Testa',
      });
      const bare = byKey({ ...APPLICANT, has_other_names: 'Yes' });
      expect(bare.pr_used_other_name).toBeUndefined();
      expect(bare.pr_other_family_name).toBeUndefined();
      const none = byKey({
        ...APPLICANT,
        has_other_names: 'No',
        other_names: 'Testa Example',
      });
      expect(none.pr_used_other_name).toBe('Yes'); // a recorded name wins over a stale "No"
    });

    it('previous countries: one complete row is entered; "none" is No; two are left', () => {
      const row = {
        country: 'United Arab Emirates',
        status: 'Worker',
        from: '2018-01-01',
        to: '2020-12-31',
      };
      const one = byKey({
        ...APPLICANT,
        previous_countries_of_residence: [row],
      });
      expect(one).toMatchObject({
        pr_previous_countries: 'Yes',
        pr_prev_country: 'United Arab Emirates',
        pr_prev_status: 'Worker',
        pr_prev_from: '2018/01/01',
        pr_prev_to: '2020/12/31',
      });
      expect(
        byKey({ ...APPLICANT, previous_countries_of_residence: 'none' })
          .pr_previous_countries,
      ).toBe('No');
      expect(
        byKey({ ...APPLICANT, previous_countries_of_residence: [] })
          .pr_previous_countries,
      ).toBe('No');
      const two = byKey({
        ...APPLICANT,
        previous_countries_of_residence: [row, row],
      });
      expect(two.pr_previous_countries).toBeUndefined();
      expect(two.pr_prev_country).toBeUndefined();
      const notes = portalFillCoverage(mapping(), {
        ...APPLICANT,
        previous_countries_of_residence: [row, row],
      });
      expect(JSON.stringify(notes)).toMatch(/Previous countries of residence/);
    });

    it('a previous marriage: Yes with the partner complete; partial is left', () => {
      const prior = {
        spouse_family_name: 'Former',
        spouse_given_name: 'Test',
        date_of_birth: '1988-02-02',
        type: 'married',
        from: '2010-01-01',
        to: '2015-01-01',
      };
      const v = byKey({
        ...APPLICANT,
        applicant_previous_relationship: 'Yes',
        previous_relationships: [prior],
      });
      expect(v).toMatchObject({
        pr_previously_partnered: 'Yes',
        pr_past_family_name: 'Former',
        pr_past_given_name: 'Test',
        pr_past_dob: '1988/02/02',
        pr_past_type: 'Married',
        pr_past_from: '2010/01/01',
        pr_past_to: '2015/01/01',
      });
      const partial = byKey({
        ...APPLICANT,
        applicant_previous_relationship: 'Yes',
        previous_relationships: [{ spouse_family_name: 'Former' }],
      });
      expect(partial.pr_previously_partnered).toBeUndefined();
      expect(partial.pr_past_family_name).toBeUndefined();
    });

    it.each([
      ['Single', false, false],
      ['Unknown', false, false],
      ['Married', true, true],
      ['Common-law', true, true],
      ['Divorced', false, true],
      ['Widowed', false, true],
      ['Legally separated', false, true],
    ])(
      'marital %s: partner questions %s, previous-relationship question %s',
      (status, partner, past) => {
        const v = byKey({ ...APPLICANT, marital_status: status });
        expect(v.pr_partner_since !== undefined).toBe(partner);
        expect(v.pr_partner_family_name !== undefined).toBe(partner);
        expect(v.pr_previously_partnered !== undefined).toBe(past);
      },
    );

    it('passport and national ID: "Yes" only when complete and unexpired; "No" when said', () => {
      const expired = byKey({
        ...APPLICANT,
        national_id_expiry_date: '2020-10-10',
      });
      expect(expired.pr_national_id).toBeUndefined();
      expect(expired.pr_national_id_number).toBeUndefined();
      expect(
        byKey({ ...APPLICANT, national_id_issue_date: '' }).pr_national_id,
      ).toBeUndefined();
      const none = byKey({
        ...APPLICANT,
        has_national_id: 'No',
        national_id_number: '',
      });
      expect(none.pr_national_id).toBe('No');
      expect(none.pr_national_id_number).toBeUndefined();
      expect(
        byKey({ ...APPLICANT, passport_expiry_date: '2020-01-01' }).pr_passport,
      ).toBeUndefined();
      expect(
        byKey({ ...APPLICANT, has_valid_passport: 'No', passport_number: '' })
          .pr_passport,
      ).toBe('No');
    });

    it('the account email question is the applicant’s; "No" opens the email box', () => {
      const v = byKey({ ...APPLICANT, contact_by_account_email: 'No' });
      expect(v.pr_contact_by_account_email).toBe('No');
      expect(v.pr_contact_email).toBe('applicant@example.com');
      expect(
        byKey({ ...APPLICANT, contact_by_account_email: 'Yes' })
          .pr_contact_email,
      ).toBeUndefined();
    });

    it('an alternate phone, Canadian', () => {
      const v = byKey({
        ...APPLICANT,
        alternate_phone: '+1 416 555 0100',
        alternate_phone_type: 'home',
      });
      expect(v).toMatchObject({
        pr_alternate_phone_location: 'Canada/US',
        pr_alternate_phone_type: 'Residence',
        pr_alternate_phone_number: '416-555-0100',
      });
    });

    // Phase 2b: the residential block reuses the mailing ids; each box is
    // named by its place among the matches.
    it('a residential address other than the mailing one: "No", then the 2nd block', () => {
      const p = {
        ...APPLICANT,
        mailing_same_as_residential: 'No',
        mailing_address: '7 Post Lane, Lahore, Pakistan',
      };
      const v = byKey(p);
      expect(v).toMatchObject({
        pr_mail_street_number: '7',
        pr_mail_street_name: 'Post Lane',
        pr_residential_same: 'No',
        pr_home_street_number: '12',
        pr_home_street_name: 'Test Road',
        pr_home_city: 'Lahore',
        pr_home_country: 'Pakistan',
        pr_home_postal_code: '54000',
      });
      expect(v.pr_home_province).toBeUndefined();
      expect(selectorOf(p, 'pr_residential_same')).toBe('#no');
      expect(selectorOf(p, 'pr_mail_street_name')).toBe(
        '#streetName >> nth=1/2',
      );
      expect(selectorOf(p, 'pr_home_street_name')).toBe(
        '#streetName >> nth=2/2',
      );
      // Every residential box waits for the "No" that reveals it.
      for (const i of inputs(p).filter((x) =>
        x.fieldKey.startsWith('pr_home_'),
      ))
        expect(i).toMatchObject({ reveal: true });
      for (const m of mapping().filter((x) =>
        x.profileKey.startsWith('pr_home_'),
      ))
        expect(m).toMatchObject({
          parent: 'pr_residential_same',
          parentValue: 'No',
        });
      expect(JSON.stringify(portalFillCoverage(mapping(), p))).not.toMatch(
        /"Residential address"/,
      );
      // Same as mailing: "Yes", no residential box.
      const same = byKey(APPLICANT);
      expect(same.pr_residential_same).toBe('Yes');
      expect(Object.keys(same).filter((k) => k.startsWith('pr_home_'))).toEqual(
        [],
      );
    });

    // Review of 04ba82ea: the common case keeps plain ids, so an extension
    // older than 0.1.52 (no `nth`) still fills it.
    it('same as mailing: plain mailing ids, no nth token anywhere', () => {
      for (const i of inputs(APPLICANT).filter((x) => x.page === PR_PROFILE))
        expect(i.targetField).not.toMatch(/nth=/);
      expect(selectorOf(APPLICANT, 'pr_mail_street_name')).toBe('#streetName');
      // One key per box either way (review, lock and coverage see one field).
      const keys = inputs({
        ...APPLICANT,
        mailing_same_as_residential: 'No',
        mailing_address: '7 Post Lane, Lahore, Pakistan',
      }).map((i) => i.fieldKey);
      expect(keys.filter((k) => k === 'pr_mail_street_name')).toHaveLength(1);
    });

    // Re-review of 20189244: a value stored under the shared key (the saved
    // form, a consultant's correction) skips `derive`; the gate does not.
    it('a stored mailing value writes once, through the one set that applies', () => {
      const differs = {
        ...APPLICANT,
        mailing_same_as_residential: 'No',
        mailing_address: '7 Post Lane, Lahore, Pakistan',
      };
      for (const [p, css] of [
        [APPLICANT, '#city'],
        [differs, '#city >> nth=1/2'],
      ] as const) {
        const stored = { ...p, pr_mail_city: 'Lahore Cantt' };
        const writes = inputs(stored).filter(
          (i) => i.fieldKey === 'pr_mail_city',
        );
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({
          targetField: css,
          mappedValue: 'Lahore Cantt',
        });
      }
      // A stored home value without a home address to enter writes nothing.
      expect(
        inputs({ ...APPLICANT, pr_home_city: 'Lahore' }).filter((i) =>
          i.fieldKey.startsWith('pr_home_'),
        ),
      ).toEqual([]);
      // The lock's inputs are stable: storing the derived value changes nothing.
      const shape = (p: Record<string, unknown>) =>
        inputs(p).map((i) => [i.fieldKey, i.targetField, i.mappedValue]);
      for (const p of [APPLICANT, differs]) {
        expect(shape(p)).toEqual(shape(p));
        expect(shape({ ...p, pr_mail_city: byKey(p).pr_mail_city })).toEqual(
          shape(p),
        );
      }
    });

    it('the "No" and the residential boxes are one group; a Canadian home needs its province', () => {
      const p = {
        ...APPLICANT,
        mailing_same_as_residential: 'No',
        mailing_address: '7 Post Lane, Lahore, Pakistan',
      };
      for (const m of mapping().filter(
        (x) =>
          x.profileKey === 'pr_residential_same' ||
          x.profileKey.startsWith('pr_home_'),
      ))
        expect(m.group).toBe('pr_residential');
      const out = buildMappingInputs(mapping(), p, new Set(['pr_home_city']));
      expect(
        out.filter(
          (i) =>
            i.fieldKey === 'pr_residential_same' ||
            i.fieldKey.startsWith('pr_home_'),
        ),
      ).toEqual([]);
      expect(
        JSON.stringify(
          portalFillCoverage(mapping(), p, new Set(['pr_home_city'])),
        ),
      ).toMatch(/Residential address/);
      const canada = {
        ...p,
        residential_address: '100 Test Street, Toronto, Canada',
        residential_country: 'Canada',
        residential_city: 'Toronto',
      };
      expect(byKey(canada).pr_residential_same).toBeUndefined();
      expect(
        byKey({
          ...canada,
          residential_address: '100 Test Street, Toronto, ON M5V 2T6, Canada',
        }),
      ).toMatchObject({ pr_residential_same: 'No', pr_home_province: 'ON' });
    });

    it('a residential address the assistant cannot enter whole is left, and "No" is not answered', () => {
      const p = {
        ...APPLICANT,
        residential_address: 'Lahore, Pakistan',
        mailing_same_as_residential: 'No',
        mailing_address: '7 Post Lane, Lahore, Pakistan',
      };
      const v = byKey(p);
      expect(v.pr_residential_same).toBeUndefined();
      expect(Object.keys(v).filter((k) => k.startsWith('pr_home_'))).toEqual(
        [],
      );
      expect(JSON.stringify(portalFillCoverage(mapping(), p))).toMatch(
        /Residential address/,
      );
    });

    it('eye colour and height when recorded', () => {
      const v = byKey({
        ...APPLICANT,
        eye_color: 'gray',
        height: '173 cm',
        uci: '11-2438-7452',
        years_of_education: '16',
      });
      expect(v).toMatchObject({
        pr_eye_colour: 'Grey',
        pr_height_cm: '173',
        pr_uci: '1124387452',
        pr_education_years: '16',
      });
      expect(
        byKey({ ...APPLICANT, height: 'tall' }).pr_height_cm,
      ).toBeUndefined();
    });
  });

  describe('IMM 5406 Section A', () => {
    it('applicant, spouse (the sponsor) and parents', () => {
      expect(byKey(APPLICANT)).toMatchObject({
        pr5406_birthplace: 'Pakistan',
        pr5406_marital: 'Married - Physically Present',
        pr5406_email: 'applicant@example.com',
        pr5406_address: 'Lahore, Pakistan',
        pr5406_partner_name: 'Test SPONSOR',
        pr5406_partner_dob: '1992/03/15',
        pr5406_partner_birthplace: 'Canada',
        pr5406_partner_marital: 'Married - Physically Present',
        pr5406_partner_email: 'sponsor@example.com',
        pr5406_partner_address: 'Toronto, Canada',
        pr5406_mother_name: 'Test Mother',
        pr5406_mother_dob: '1965/10/09',
        pr5406_mother_birthplace: 'Pakistan',
        pr5406_mother_address: 'Lahore, Pakistan',
        pr5406_father_name: 'Test Father Example',
      });
    });

    it('marital status: proxy and unknown ceremonies', () => {
      expect(
        marital5406({ marital_status: 'Married', marriage_by_proxy: 'Yes' }),
      ).toBe('Married - Not Physically Present');
      expect(marital5406({ marital_status: 'Married' })).toBeUndefined();
      expect(marital5406({ marital_status: 'Separated' })).toBe(
        'Legally Separated',
      );
      expect(marital5406({ marital_status: 'Common-law' })).toBe('Common-Law');
    });

    it('a deceased parent is "Not Applicable - Deceased" and their address is left', () => {
      const v = byKey({ ...APPLICANT, father_deceased: 'Yes' });
      expect(v.pr5406_father_marital).toBe('Not Applicable - Deceased');
      expect(v.pr5406_father_address).toBeUndefined();
    });

    it('a single applicant has no spouse rows', () => {
      const v = byKey({ ...APPLICANT, marital_status: 'Single' });
      expect(v.pr5406_partner_name).toBeUndefined();
      expect(v.pr5406_partner_dob).toBeUndefined();
    });

    it('addresses over 80 characters are not written', () => {
      const long = 'X'.repeat(90);
      const v = byKey({
        ...APPLICANT,
        residential_address: `1 Road, ${long}, Pakistan`,
        residential_city: long,
      });
      expect(v.pr5406_address).toBeUndefined();
    });
  });

  describe('IMM 5669', () => {
    it('Section A: parents, birth family name only when recorded', () => {
      const v = byKey(APPLICANT);
      expect(v).toMatchObject({
        pr5669_father_family: 'Example',
        pr5669_father_given: 'Test Father',
        pr5669_father_dob: '1960/06/15',
        pr5669_father_birth_country: 'Pakistan',
        pr5669_mother_given: 'Test',
        pr5669_mother_dob: '1965/10/09',
      });
      expect(v.pr5669_mother_family).toBeUndefined();
      expect(
        byKey({ ...APPLICANT, mother_maiden_name: 'Birthname' })
          .pr5669_mother_family,
      ).toBe('Birthname');
    });

    it('the questionnaire and the E/F/G "None" boxes fill on the principal’s form only', () => {
      const v = byKey(APPLICANT);
      for (const q of [
        'isDetainedOrJailed',
        'isWarCriminal',
        'isPhysicalOrMentalDisorder',
      ])
        expect(v[`pr5669_${q}`]).toBe('No');
      for (const f of mapping().filter((m) =>
        m.profileKey.startsWith('pr5669_is'),
      )) {
        expect(f.declaration).toBe(true);
        expect(f.principalForm).toBe(true);
      }
      expect(selectorOf(APPLICANT, 'pr5669_isDetainedOrJailed')).toBe(
        '#isDetainedOrJailed_no >> page=/Section B: Questionnaire/i >> principal',
      );
      expect(selectorOf(APPLICANT, 'pr5669_no_memberships')).toBe(
        '#noneSelected >> page=/Section E: Membership/i >> principal',
      );
      expect(v.pr5669_no_government_positions).toBe('Yes');
      expect(v.pr5669_no_military_service).toBe('Yes');
      // Nothing answered: nothing written, and the coverage asks for the answer.
      const blank = byKey({ family_name: 'EXAMPLE' });
      expect(
        Object.keys(blank).filter((k) => k.startsWith('pr5669_is')),
      ).toEqual([]);
      expect(
        JSON.stringify(
          portalFillCoverage(mapping(), { family_name: 'EXAMPLE' }),
        ),
      ).toMatch(/needs_your_answer/);
    });

    it('background answers (phase 2): every part of a two-part question must be "No"', () => {
      expect(backgroundAnswer(APPLICANT, 'isDetainedOrJailed')).toBe('No');
      // Question 4: a refused visa/permit AND refused refugee status.
      expect(
        backgroundAnswer({ refused_visa: 'No' }, 'isRefusedRefugeeOrVisa'),
      ).toBeUndefined();
      expect(
        backgroundAnswer(
          { refused_visa: 'No', refugee_claim_made: 'No' },
          'isRefusedRefugeeOrVisa',
        ),
      ).toBe('No');
      expect(
        backgroundAnswer(
          { refused_or_ordered_to_leave: 'No', refugee_claim_made: 'No' },
          'isRefusedRefugeeOrVisa',
        ),
      ).toBe('No');
      expect(
        backgroundAnswer(
          { refused_visa: 'No', refused_refugee_status: 'Yes' },
          'isRefusedRefugeeOrVisa',
        ),
      ).toBe('Yes');
      // A claim MADE is not a claim refused.
      expect(
        backgroundAnswer(
          { refused_visa: 'No', refugee_claim_made: 'Yes' },
          'isRefusedRefugeeOrVisa',
        ),
      ).toBeUndefined();
      // Question 5: refused admission AND ordered to leave.
      expect(
        backgroundAnswer(
          { refused_admission: 'No' },
          'isOrderedToLeaveCountry',
        ),
      ).toBeUndefined();
      expect(
        backgroundAnswer(
          { refused_admission: 'No', ordered_to_leave: 'No' },
          'isOrderedToLeaveCountry',
        ),
      ).toBe('No');
      expect(
        backgroundAnswer(
          { refused_admission: 'No', deported: 'Yes' },
          'isOrderedToLeaveCountry',
        ),
      ).toBe('Yes');
      expect(
        backgroundAnswer(
          { refused_or_ordered_to_leave: 'No' },
          'isOrderedToLeaveCountry',
        ),
      ).toBe('No');
      // A combined "Yes" answers neither part.
      const p = { ...APPLICANT, refused_or_ordered_to_leave: 'Yes' };
      expect(backgroundAnswer(p, 'isRefusedRefugeeOrVisa')).toBeUndefined();
      expect(backgroundAnswer(p, 'isOrderedToLeaveCountry')).toBeUndefined();
      // Charged but not convicted: where is unknown, so neither conviction question.
      expect(
        backgroundAnswer(
          { ever_charged: 'Yes', ever_convicted: 'No' },
          'isConvictedInCanada',
        ),
      ).toBeUndefined();
      expect(noneOf('organization_memberships')(APPLICANT)).toBe('Yes');
      expect(
        noneOf('organization_memberships')({ organization_memberships: 'Yes' }),
      ).toBeUndefined();
      // Review M1: only an explicit answer ticks "None".
      expect(
        noneOf('organization_memberships')({ organization_memberships: [] }),
      ).toBeUndefined();
      expect(noneOf('organization_memberships')({})).toBeUndefined();
      expect(
        noneOf(
          'organization_memberships',
          'has_organization_memberships',
        )({ has_organization_memberships: 'No' }),
      ).toBe('Yes');
      // Re-review: free text in the first key is a membership; a later "No"
      // never ticks "None" over it.
      expect(
        noneOf(
          'organization_memberships',
          'has_organization_memberships',
        )({
          organization_memberships: 'Rotary Club',
          has_organization_memberships: 'No',
        }),
      ).toBeUndefined();
    });

    // Review M2: the "None" boxes are declarations; unanswered → needs your answer.
    it('the E/F/G "None" boxes are declarations, with a note when ticked', () => {
      for (const k of [
        'pr5669_no_memberships',
        'pr5669_no_government_positions',
        'pr5669_no_military_service',
      ])
        expect(mapping().find((m) => m.profileKey === k)?.declaration).toBe(
          true,
        );
      const unanswered = {
        ...APPLICANT,
        organization_memberships: undefined,
        government_positions: undefined,
      };
      const cov = JSON.stringify(portalFillCoverage(mapping(), unanswered));
      expect(cov).toMatch(
        /Memberships and associations — none[^}]*needs_your_answer|needs_your_answer[^}]*Memberships and associations — none/,
      );
      expect(JSON.stringify(portalFillCoverage(mapping(), APPLICANT))).toMatch(
        /untick it and keep your rows/,
      );
    });
  });

  describe('only the principal applicant’s own IMM 5406 / IMM 5669', () => {
    it('every write on those forms carries the principal scope', () => {
      const forms = mapping().filter(
        (m) => m.page === PR_IMM5406 || m.page === PR_IMM5669,
      );
      expect(forms.length).toBeGreaterThan(100);
      for (const f of forms) expect(f.principalForm).toBe(true);
      for (const i of inputs(APPLICANT).filter(
        (x) => x.page === PR_IMM5406 || x.page === PR_IMM5669,
      ))
        expect(i.targetField).toMatch(
          / >> principal$| >> principal >> option=/,
        );
    });

    it('Section A also keeps the checked-radio guard (it is where the form is recognised)', () => {
      for (const k of ['pr5406_birthplace', 'pr5669_father_dob'])
        expect(selectorOf(APPLICANT, k)).toMatch(
          /^body:has\(#principal(AppYes|Applicant):checked\) /,
        );
      expect(PRINCIPAL_5406).toBe('body:has(#principalAppYes:checked)');
      expect(PRINCIPAL_5669).toBe('body:has(#principalApplicant:checked)');
    });

    it("a dependant's form gets zero writes: no write on those pages is unscoped", () => {
      // The extension resolves `>> principal` to nothing unless Section A of
      // this documentId showed the principal radio checked
      // (apps/extension/test/pr-portal-rows.spec.ts).
      const unscoped = inputs(APPLICANT).filter(
        (i) =>
          (i.page === PR_IMM5406 || i.page === PR_IMM5669) &&
          !/ >> principal\b/.test(i.targetField),
      );
      expect(unscoped).toEqual([]);
    });
  });

  describe('IMM 5669 repeating rows (sections C, D, H)', () => {
    const ROWS: Record<string, unknown> = {
      ...APPLICANT,
      education_history: [
        {
          school: 'Test University',
          city: 'Lahore',
          country: 'Pakistan',
          from: '2008-09',
          to: '2012-06',
          level: "Bachelor's degree",
          field_of_study: 'Accounting',
        },
      ],
      work_history: [
        {
          from: '2016-06',
          to: '2016-09',
          activity: 'unemployed',
          employer: 'unknown',
          city: 'Lahore',
          country: 'Pakistan',
        },
        {
          from: '2016-10',
          to: 'present',
          activity: 'Accountant',
          employer: 'Test Traders',
          city: 'Lahore',
          country: 'Pakistan',
        },
      ],
      address_history: [
        {
          from: '2016-10',
          to: 'present',
          street: '12 Test Road',
          city: 'Lahore',
          province: 'Punjab',
          country: 'Pakistan',
          postal_code: '54000',
        },
        {
          from: '2010-01',
          to: '2016-09',
          street: '5 Old Street',
          city: 'Gujrat',
          province: 'Punjab',
          country: 'Pakistan',
          postal_code: 'unknown',
        },
      ],
    };
    const now = () => new Date().toISOString().slice(0, 7).replace('-', '/');
    const ROWS_CURRENT = (ROWS.address_history as Record<string, unknown>[])[0];

    it('education: one row, the diploma within 17 characters', () => {
      const v = byKey(ROWS);
      expect(v).toMatchObject({
        pr5669_edu_from0: '2008/09',
        pr5669_edu_to0: '2012/06',
        pr5669_edu_nameOfInstitution0: 'Test University',
        pr5669_edu_cityAndCountry0: 'Lahore, Pakistan',
        pr5669_edu_typeOfDiploma0: "Bachelor's Degree",
        pr5669_edu_fieldOfStudy0: 'Accounting',
      });
      expect(v.pr5669_edu_row1).toBeUndefined();
      expect(selectorOf(ROWS, 'pr5669_edu_from0')).toBe(
        '#from0 >> page=/Section C: Education/i >> principal >> keep',
      );
    });

    it('personal history: most recent first, rows added one at a time, short boxes', () => {
      const v = byKey(ROWS);
      expect(v).toMatchObject({
        pr5669_hist_from0: '2016/10',
        pr5669_hist_to0: now(),
        pr5669_hist_activity0: 'Accountant',
        pr5669_hist_status0: 'Citizen',
        pr5669_hist_nameOfEmployerOrSchool0: 'Test Traders',
        pr5669_hist_row1: 'Personal history row 2',
        pr5669_hist_from1: '2016/06',
        pr5669_hist_to1: '2016/09',
        pr5669_hist_activity1: 'Unemployed',
        pr5669_hist_nameOfEmployerOrSchool1: 'N/A',
      });
      expect(v.pr5669_hist_row2).toBeUndefined();
      const add = inputs(ROWS).find((i) => i.fieldKey === 'pr5669_hist_row1')!;
      expect(add.op).toBe('row_add');
      expect(add.targetField).toBe(
        '#from1 >> page=/Section D: Personal history/i >> principal',
      );
      // The row's own fields wait for it (revealed), the add is probed.
      expect(add.reveal).toBeUndefined();
      expect(
        inputs(ROWS).find((i) => i.fieldKey === 'pr5669_hist_from1')?.reveal,
      ).toBe(true);
      // An activity over the box's 21 characters is not written.
      const long = byKey({
        ...ROWS,
        work_history: [
          {
            from: '2016-10',
            to: 'present',
            activity: 'Owner of a scrap metal trading business',
            employer: 'X',
            city: 'Lahore',
            country: 'Pakistan',
          },
        ],
      });
      // …and the section is left whole, listed for the applicant.
      expect(
        Object.keys(long).filter((k) => k.startsWith('pr5669_hist_')),
      ).toEqual([]);
      expect(
        JSON.stringify(
          portalFillCoverage(mapping(), {
            ...ROWS,
            work_history: [
              {
                from: '2016-10',
                to: 'present',
                activity: 'Owner of a scrap metal trading business',
                employer: 'X',
                city: 'Lahore',
                country: 'Pakistan',
              },
            ],
          }),
        ),
      ).toMatch(/Section D: personal history/);
      // A status that cannot be told (abroad, not stated) leaves it too.
      const abroad = byKey({
        ...ROWS,
        work_history: [
          {
            from: '2016-10',
            to: 'present',
            activity: 'Accountant',
            employer: 'X',
            city: 'Dubai',
            country: 'United Arab Emirates',
          },
        ],
      });
      expect(abroad.pr5669_hist_from0).toBeUndefined();
    });

    // Live 2026-10-21: row 0 is the current address IRCC copies from the
    // profile and locks; only its "from" is the applicant's.
    it('addresses: row 0 is only "from"; later rows every box, unknown postal code left empty', () => {
      const v = byKey(ROWS);
      for (const k of [
        'to',
        'street',
        'city',
        'provinceOrState',
        'country',
        'postalCode',
      ]) {
        expect(v[`pr5669_addr_${k}0`]).toBeUndefined();
        expect(
          mapping().some((m) => m.profileKey === `pr5669_addr_${k}0`),
        ).toBe(false);
      }
      expect(v).toMatchObject({
        pr5669_addr_from0: '2016/10',
        pr5669_addr_row1: 'Address row 2',
        pr5669_addr_from1: '2010/01',
        pr5669_addr_to1: '2016/09',
        pr5669_addr_street1: '5 Old Street',
      });
      expect(v.pr5669_addr_postalCode1).toBeUndefined();
    });

    it('an incomplete row leaves the whole section to the applicant (no half-saved rows)', () => {
      const p = {
        ...ROWS,
        address_history: [
          ROWS_CURRENT,
          {
            from: '2010-01',
            to: '2016-09',
            city: 'Gujrat',
            country: 'Pakistan',
          },
        ],
      };
      const v = byKey(p);
      expect(
        Object.keys(v).filter((k) => k.startsWith('pr5669_addr_')),
      ).toEqual([]);
      expect(JSON.stringify(portalFillCoverage(mapping(), p))).toMatch(
        /Section H: addresses/,
      );
      // The current address alone needs only its "from".
      expect(
        byKey({ ...ROWS, address_history: [{ from: '2016-10' }] })
          .pr5669_addr_from0,
      ).toBe('2016/10');
      expect(JSON.stringify(portalFillCoverage(mapping(), ROWS))).toMatch(
        /IRCC copies your current address[^"]*My Profile/,
      );
      // Review of b196f0c0: the newest address must still be current to be
      // IRCC's locked row 0; one that ended leaves the section whole.
      const ended = byKey({
        ...ROWS,
        address_history: [
          { ...ROWS_CURRENT, to: '2025-12' },
          {
            from: '2010-01',
            to: '2016-09',
            street: '5 Old Street',
            city: 'Gujrat',
            country: 'Pakistan',
          },
        ],
      });
      expect(
        Object.keys(ended).filter((k) => k.startsWith('pr5669_addr_')),
      ).toEqual([]);
      expect(
        byKey({ ...ROWS, address_history: [{ ...ROWS_CURRENT, to: '' }] })
          .pr5669_addr_from0,
      ).toBe('2016/10');
    });

    it('never more rows than the data, and never more than MAX_ROWS', () => {
      const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({
        from: `20${String(10 + i).padStart(2, '0')}-01`,
        to: `20${String(10 + i).padStart(2, '0')}-12`,
        street: `${i} Road`,
        city: 'Lahore',
        country: 'Pakistan',
      }));
      expect(
        Object.keys(byKey({ ...ROWS, address_history: many })).filter((k) =>
          k.startsWith('pr5669_addr_'),
        ),
      ).toEqual([]);
      const adds = mapping().filter(
        (m) => m.op === 'row_add' && m.page === PR_IMM5669,
      );
      // Per section: the row guard plus one add per row after the first.
      expect(adds.length).toBe(3 * MAX_ROWS);
      for (const a of adds) {
        expect(a.principalForm).toBe(true);
        expect(a.pageMatch).toBeDefined();
      }
    });

    // Review L5: the section guard runs first and says how many rows the
    // data has; the page may not hold more.
    it('each section starts with a guard: no more rows on the page than the data', () => {
      const ins = inputs(ROWS);
      const guard = ins.find((i) => i.fieldKey === 'pr5669_hist_rows')!;
      expect(guard).toMatchObject({
        op: 'row_add',
        mappedValue: 'Personal history: 2 rows',
      });
      expect(guard.targetField).toBe(
        '#from0 >> rows=2 >> page=/Section D: Personal history/i >> principal',
      );
      const order = ins
        .map((i) => i.fieldKey)
        .filter((k) => k.startsWith('pr5669_hist_'));
      expect(order[0]).toBe('pr5669_hist_rows');
      expect(
        inputs(ROWS).find((i) => i.fieldKey === 'pr5669_addr_rows')
          ?.mappedValue,
      ).toBe('Address: 2 rows');
      expect(
        inputs(ROWS).find((i) => i.fieldKey === 'pr5669_edu_rows')?.mappedValue,
      ).toBe('Education: 1 row');
      // Every row box keeps a different value it already holds.
      for (const i of ins.filter((x) =>
        /^pr5669_(edu|hist|addr)_(?!row)/.test(x.fieldKey),
      ))
        expect(i.targetField).toMatch(/ >> keep$/);
    });

    // Review L6: one excluded box excludes its whole section.
    it('excluding one row box (the consultant’s "not applicable") excludes its section', () => {
      const out = buildMappingInputs(
        mapping(),
        ROWS,
        new Set(['pr5669_addr_street1']),
      );
      expect(out.filter((i) => i.fieldKey.startsWith('pr5669_addr_'))).toEqual(
        [],
      );
      expect(out.some((i) => i.fieldKey.startsWith('pr5669_hist_'))).toBe(true);
    });

    // Review L7: the first whole number, never digits run together.
    it('years of schooling: the first whole number', () => {
      const v = byKey({
        ...ROWS,
        secondary_school_years: '12 years (10 + 2)',
        university_years: '4',
      });
      expect(v.pr5669_years_secondarySchoolYears).toBe('12');
      expect(v.pr5669_years_universityAndCollegeYears).toBe('4');
      expect(
        byKey({ ...ROWS, secondary_school_years: 'about twelve' })
          .pr5669_years_secondarySchoolYears,
      ).toBeUndefined();
    });

    it('diploma, status and month shaping', () => {
      expect(diplomaText('Master of Science')).toBe("Master's Degree");
      expect(diplomaText('PhD')).toBe('Doctorate');
      expect(diplomaText('High school diploma')).toBe('High School');
      expect(diplomaText('Post-secondary diploma')).toBe('Diploma');
      expect(
        diplomaText('Advanced professional qualification'),
      ).toBeUndefined();
      expect(shortStatus({ status: 'Permanent resident' }, APPLICANT)).toBe(
        'Perm. resident',
      );
      expect(shortStatus({ country: 'Pakistan' }, APPLICANT)).toBe('Citizen');
      expect(
        shortStatus({ country: 'United Arab Emirates' }, APPLICANT),
      ).toBeUndefined();
      expect(monthOf('2016-10-03')).toBe('2016/10');
      expect(monthOf('present')).toBeUndefined();
      expect(monthOf('present', true)).toBe(now());
      expect(monthOf('unknown', true)).toBeUndefined();
    });
  });

  // Live 2026-10-20: the Forms page's city was inferred, so it never reached
  // the fill, and the province alone left IMM 0008 page 2's city blank.
  describe('IMM 5406 sections B and C (phase 2b)', () => {
    const FAMILY: Record<string, unknown> = {
      ...APPLICANT,
      has_children: 'Yes',
      children: [
        {
          name: 'Test Child Example',
          relationship: 'daughter',
          date_of_birth: '2020-01-15',
          country_of_birth: 'Pakistan',
          marital_status: 'single',
          lives_with_applicant: 'Yes',
        },
      ],
      siblings: [
        {
          name: 'Test Brother Example',
          sex: 'Male',
          date_of_birth: '1992-04-02',
          country_of_birth: 'Pakistan',
          marital_status: 'divorced',
          address: 'Karachi, Pakistan',
          email: 'brother@example.com',
        },
        {
          name: 'Test Sister Example',
          relationship: 'half-sister',
          date_of_birth: '1995-08-20',
          country_of_birth: 'Pakistan',
          marital_status: 'single',
          address: '3 Some Street, Toronto, ON M5V 1A1, Canada',
        },
      ],
    };

    it('children in Section B, brothers and sisters in Section C', () => {
      const v = byKey(FAMILY);
      expect(v).toMatchObject({
        pr5406_child_rows: 'Child: 1 row',
        pr5406_child_relationship0: 'Daughter',
        pr5406_child_fullName0: 'Test Child Example',
        pr5406_child_dob0: '2020/01/15',
        pr5406_child_countryOfBirth0: 'Pakistan',
        pr5406_child_address0: 'Lahore, Pakistan',
        pr5406_child_maritalStatus0: 'Single',
        pr5406_sibling_rows: 'Brother or sister: 2 rows',
        pr5406_sibling_relationship0: 'Brother',
        pr5406_sibling_maritalStatus0: 'Divorced',
        pr5406_sibling_emailAddress0: 'brother@example.com',
        pr5406_sibling_address0: 'Karachi, Pakistan',
        pr5406_sibling_row1: 'Brother or sister row 2',
        pr5406_sibling_relationship1: 'Half-sister',
        pr5406_sibling_address1: 'Toronto, Canada',
      });
      expect(v.pr5406_child_emailAddress0).toBeUndefined();
      expect(v.pr5406_child_row1).toBeUndefined();
    });

    it('the same ids in both sections: each scoped to its first row’s heading and the principal’s form', () => {
      expect(selectorOf(FAMILY, 'pr5406_child_fullName0')).toBe(
        '#fullName0 >> page=/\\bChild 1\\b/i >> principal >> keep',
      );
      expect(selectorOf(FAMILY, 'pr5406_sibling_fullName1')).toBe(
        '#fullName1 >> page=/\\bSiblings? 1\\b/i >> principal >> keep',
      );
      expect(selectorOf(FAMILY, 'pr5406_sibling_rows')).toBe(
        '#relationship0 >> rows=2 >> page=/\\bSiblings? 1\\b/i >> principal',
      );
      // The select is written last in its row (after the kept boxes).
      const keys = inputs(FAMILY)
        .map((i) => i.fieldKey)
        .filter((k) => /^pr5406_sibling_\w+0$/.test(k));
      expect(keys[keys.length - 1]).toBe('pr5406_sibling_maritalStatus0');
      expect(selectorOf(FAMILY, 'pr5406_sibling_maritalStatus0')).toBe(
        '#maritalStatus0 >> page=/\\bSiblings? 1\\b/i >> principal >> option=text:Divorced',
      );
      // The headings tell the sections apart; the side navigation names both.
      const childPage = new RegExp('\\bChild 1\\b', 'i');
      const siblingPage = new RegExp('\\bSiblings? 1\\b', 'i');
      const nav = 'Section A Section B: Children Section C: Siblings';
      expect(childPage.test(`${nav} Child 1 Relationship`)).toBe(true);
      expect(siblingPage.test(`${nav} Child 1 Relationship`)).toBe(false);
      expect(childPage.test(`${nav} Siblings 1 Relationship`)).toBe(false);
      expect(siblingPage.test(`${nav} Siblings 1 Relationship`)).toBe(true);
    });

    it('rows only from complete data; a married relative (present or not?) is not guessed', () => {
      const married = byKey({
        ...FAMILY,
        siblings: [
          {
            ...(FAMILY.siblings as Record<string, unknown>[])[0],
            marital_status: 'married',
          },
        ],
      });
      expect(
        Object.keys(married).filter((k) => k.startsWith('pr5406_sibling_')),
      ).toEqual([]);
      // A birth year alone, or no relationship: the section is left whole.
      const vague = {
        ...FAMILY,
        children: [
          { name: 'Test Child', relationship: 'son', birth_year: 2020 },
        ],
        siblings: [
          {
            ...(FAMILY.siblings as Record<string, unknown>[])[0],
            sex: undefined,
          },
        ],
      };
      const v = byKey(vague);
      expect(
        Object.keys(v).filter((k) => /^pr5406_(child|sibling)_/.test(k)),
      ).toEqual([]);
      const cov = JSON.stringify(portalFillCoverage(mapping(), vague));
      expect(cov).toMatch(/Section B: children[^}]*List every child yourself/);
      expect(cov).toMatch(
        /Section C: brothers and sisters[^}]*List every brother and sister/,
      );
    });

    it('"none" writes nothing: the applicant marks the section "Not Applicable"', () => {
      const p = { ...APPLICANT, has_children: 'No', siblings: 'none' };
      const v = byKey(p);
      expect(
        Object.keys(v).filter((k) => /^pr5406_(child|sibling)_/.test(k)),
      ).toEqual([]);
      const cov = JSON.stringify(portalFillCoverage(mapping(), p));
      expect(cov).toMatch(/Section B: children[^}]*Not Applicable/);
      expect(cov).toMatch(/Section C: brothers and sisters[^}]*Not Applicable/);
    });

    it('relationship and marital shaping', () => {
      expect(childRelationship({ relationship: 'step-son' })).toBe('Step-son');
      expect(childRelationship({ relationship: 'brother' })).toBeUndefined();
      expect(siblingRelationship({ relationship: 'half-brother' })).toBe(
        'Half-brother',
      );
      expect(siblingRelationship({ gender: 'female' })).toBe('Sister');
      expect(siblingRelationship({ relationship: 'cousin' })).toBeUndefined();
      // Review of 04ba82ea: whole words only, no in-laws or grandchildren.
      expect(childRelationship({ relationship: ' Adopted son ' })).toBe(
        'Adopted son',
      );
      expect(childRelationship({ relationship: 'stepdaughter' })).toBe(
        'Stepdaughter',
      );
      for (const r of ['son-in-law', 'grandson', 'godson', 'grandchild'])
        expect(childRelationship({ relationship: r })).toBeUndefined();
      for (const r of ['brother-in-law', 'sister in law', 'godsister'])
        expect(siblingRelationship({ relationship: r })).toBeUndefined();
      expect(siblingRelationship({ relationship: 'step-sister' })).toBe(
        'Step-sister',
      );
      expect(relativeMarital('separated')).toBe('Legally Separated');
      expect(relativeMarital('never married')).toBe('Single');
      expect(relativeMarital('married')).toBeUndefined();
      expect(relativeMarital('unknown')).toBeUndefined();
    });
  });

  describe('IMM 5562 your travels (phase 2b)', () => {
    const TRAVEL: Record<string, unknown> = {
      ...APPLICANT,
      has_travel_history_last_10_years: 'Yes',
      travel_history_10_years: [
        {
          from: '2019-03-01',
          to: '2019-03-06',
          city: 'Dubai',
          country: 'United Arab Emirates',
          purpose: 'Tourism',
        },
        {
          from: '2023-12',
          to: '2024-01',
          country: 'Saudi Arabia',
          length: '2 weeks',
          purpose: 'Umrah',
        },
      ],
    };

    it('Section A: name, then trips most recent first, scoped by the section’s own destination id', () => {
      const v = byKey(TRAVEL);
      expect(v).toMatchObject({
        pr5562_family_name: 'EXAMPLE',
        pr5562_given_name: 'TEST APPLICANT',
        pr5562_trip_rows: 'Your trip: 2 rows',
        'pr5562_trip_trip-from-0': '2023/12',
        'pr5562_trip_trip-to-0': '2024/01',
        'pr5562_trip_trip-destination-0': 'Saudi Arabia',
        'pr5562_trip_trip-length-0': '2 weeks',
        'pr5562_trip_trip-purpose-0': 'Umrah',
        pr5562_trip_row1: 'Your trip row 2',
        'pr5562_trip_trip-destination-1': 'Dubai, United Arab Emirates',
        'pr5562_trip_trip-length-1': '6 days',
      });
      expect(v.pr5562_not_travelled).toBeUndefined();
      expect(selectorOf(TRAVEL, 'pr5562_trip_trip-from-1')).toBe(
        'body:has(#trip-destination-0) #trip-from-1 >> keep',
      );
      expect(selectorOf(TRAVEL, 'pr5562_trip_rows')).toBe(
        'body:has(#trip-destination-0) #trip-from-0 >> rows=2',
      );
      expect(selectorOf(TRAVEL, 'pr5562_family_name')).toBe(
        'body:has(#trip-destination-0) #familyName >> keep',
      );
      const add = inputs(TRAVEL).find(
        (i) => i.fieldKey === 'pr5562_trip_row1',
      )!;
      expect(add).toMatchObject({ op: 'row_add', page: PR_IMM5562 });
      expect(
        pageMatches('/en/application/case/4989734/imm5562', PR_IMM5562),
      ).toBe(true);
      expect(isProgressivePage(PR_IMM5562)).toBe(true);
    });

    it('sections B and C reuse the trip ids: each names its own destination id', () => {
      for (const m of mapping().filter((x) => x.page === PR_IMM5562)) {
        const sel = [m.selector, ...Object.values(m.choices ?? {})];
        for (const css of sel) {
          if (/^pr5562_spouse_trip/.test(m.profileKey))
            expect(css).toMatch(/^body:has\(#sectionB-destination-0\) /);
          else if (/^pr5562_child_trip/.test(m.profileKey))
            expect(css).toMatch(/^body:has\(#sectionC-destination-0\) /);
          else expect(css).toMatch(/^body:has\(#trip-destination-0\) /);
        }
        // One form per application: no principal marker to look for.
        expect(m.principalForm).toBeUndefined();
      }
      const kids = byKey({
        ...TRAVEL,
        children: [
          {
            name: 'Adult Child Example',
            given_name: 'Adult',
            date_of_birth: '2000-01-01',
            travel_history_10_years: [
              {
                from: '2022-05-01',
                to: '2022-05-03',
                city: 'Doha',
                country: 'Qatar',
                purpose: 'Visit',
              },
            ],
          },
          {
            name: 'Young Child',
            date_of_birth: '2020-01-15',
            travel_history_10_years: [],
          },
        ],
      });
      expect(kids).toMatchObject({
        'pr5562_child_trip_trip-givenName-0': 'Adult',
        'pr5562_child_trip_sectionC-destination-0': 'Doha, Qatar',
        'pr5562_child_trip_trip-length-0': '3 days',
      });
      expect(kids.pr5562_child_trip_row1).toBeUndefined();
    });

    it('"Did not travel" only from an explicit "No"; the 5-year list is never written as 10 years', () => {
      const none = byKey({
        ...APPLICANT,
        has_travel_history_last_10_years: 'No',
      });
      expect(none.pr5562_not_travelled).toBe('Yes');
      expect(
        mapping().find((m) => m.profileKey === 'pr5562_not_travelled'),
      ).toMatchObject({ declaration: true, op: 'check' });
      const fiveYears = byKey({
        ...APPLICANT,
        travelled_last_5_years: 'No',
        travel_history: [
          {
            from: '2023-01',
            to: '2023-02',
            country: 'Qatar',
            city: 'Doha',
            purpose: 'Visit',
            length: '1 week',
          },
        ],
      });
      expect(fiveYears.pr5562_not_travelled).toBeUndefined();
      expect(
        Object.keys(fiveYears).filter((k) => k.startsWith('pr5562_trip')),
      ).toEqual([]);
      expect(JSON.stringify(portalFillCoverage(mapping(), APPLICANT))).toMatch(
        /Section A: your trips in the past 10 years/,
      );
    });

    it('an incomplete trip (no length, no exact dates) leaves the section whole', () => {
      const p = {
        ...TRAVEL,
        travel_history_10_years: [
          {
            from: '2023-12',
            to: '2024-01',
            country: 'Saudi Arabia',
            purpose: 'Umrah',
          },
        ],
      };
      expect(
        Object.keys(byKey(p)).filter((k) => k.startsWith('pr5562_trip')),
      ).toEqual([]);
      expect(tripLength({ from: '2024-02-28', to: '2024-03-01' })).toBe(
        '3 days',
      );
      expect(tripLength({ from: '2024-03-01', to: '2024-03-01' })).toBe(
        '1 day',
      );
      expect(
        tripLength({ from: '2024-03-05', to: '2024-03-01' }),
      ).toBeUndefined();
    });
  });

  it('a province without a city takes the sponsor’s city in that province', () => {
    const noCity = { ...APPLICANT, intended_city_of_residence: undefined };
    expect(byKey(noCity)).toMatchObject({
      pr_destination_province: 'ON',
      pr_destination_city: 'Toronto',
    });
    const elsewhere = {
      ...noCity,
      preferred_destination_province: 'British Columbia',
    };
    expect(byKey(elsewhere).pr_destination_province).toBe('BC');
    expect(byKey(elsewhere).pr_destination_city).toBeUndefined();
  });

  // Live 2026-10-21: page 4's country code is disabled until "Other" is
  // chosen; probed up front it refused the whole page.
  it('page 4 phone fields wait for their Canada/US-or-other radio instead of being probed', () => {
    for (const f of mapping().filter((m) =>
      /#(Primary|Alternate)(Type|CountryCode|Number)$/.test(m.selector),
    ))
      expect(f.reveal).toBe(true);
  });

  describe('value shaping', () => {
    it('dates, streets, provinces, phones, education', () => {
      expect(slashDate('1989-10-14')).toBe('1989/10/14');
      expect(slashDate('1989-10')).toBeUndefined();
      expect(streetParts({ street: '1202 Stirling Test Terrace' })).toEqual({
        number: '1202',
        name: 'Stirling Test Terrace',
      });
      expect(streetParts({ street: 'House 138, Test Colony' })).toEqual({
        name: 'House 138, Test Colony',
      });
      expect(provinceAbbr('Ontario')).toBe('ON');
      expect(provinceAbbr('on')).toBe('ON');
      expect(provinceAbbr(['British Columbia'])).toBe('BC');
      expect(provinceAbbr('Punjab')).toBeUndefined();
      expect(
        portalPhone('(905) 226-5664', { country_of_residence: 'Canada' }),
      ).toEqual({ location: 'Canada/US', number: '905-226-5664' });
      expect(portalPhone('+1 416 555 0100; sponsor@example.com', {})).toEqual({
        location: 'Canada/US',
        number: '416-555-0100',
      });
      expect(portalPhone('0300 1234567', {})).toBeUndefined(); // no country: not guessed
      for (const [raw, want] of [
        ['secondary', 'Secondary or less'],
        ['High school', 'Secondary or less'],
        ['High school diploma', 'Secondary or less'],
        ['Post-secondary diploma', 'Non-University Certificate/Diploma'],
        ['Graphic design diploma', 'Non-University Certificate/Diploma'],
        ['Photography certificate', 'Non-University Certificate/Diploma'],
        ['Ph.D.', 'Doctorate - Ph D'],
        ["Master's", 'Master’s Degree'],
        ['PhD', 'Doctorate - Ph D'],
        ['College diploma', 'Non-University Certificate/Diploma'],
        ['Trade certificate', 'Trade/Apprenticeship Certificate/Diploma'],
      ])
        expect(educationOption({ highest_education_level: raw })).toBe(want);
    });
  });

  it('lists what the applicant does themselves', () => {
    const cov = JSON.stringify(portalFillCoverage(mapping(), APPLICANT));
    for (const s of [
      'Section B: children',
      'Section C: brothers and sisters',
      'Section A: your trips',
      'Open Section A first',
      'Section C: education',
      'Section D: personal history',
      'declaration',
      'Add dependant',
    ])
      expect(cov).toContain(s);
  });
});

// ── the application page: uploads (live 2026-10-20) ────────────────────────

const pdoc = (
  n: number,
  documentType: string,
  over: Partial<PortalDocument> = {},
): PortalDocument => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  documentType,
  fileName: `${documentType}.pdf`,
  mimeType: 'application/pdf',
  approved: false,
  createdAt: '2026-10-15T00:00:00Z',
  ...over,
});

/** The test application's document types (no real files). */
const DOCS: PortalDocument[] = [
  pdoc(1, 'applicant_photo', { fileName: 'photo.jpg', mimeType: 'image/jpeg' }),
  pdoc(2, 'birth_certificate'),
  pdoc(3, 'marriage_certificate'),
  pdoc(4, 'passport'),
  pdoc(5, 'police_clearance'),
  pdoc(6, 'processing_fee_receipt'),
  pdoc(7, 'proof_of_status'),
];

describe('PR application page: uploads (disabled, review B1)', () => {
  const withDocs = (docs: PortalDocument[]) => ({
    ...APPLICANT,
    _portal_documents: docs,
  });

  it('attaches nothing, even with every document approved', () => {
    const docs = [
      ...DOCS.map((d) => ({ ...d, approved: true })),
      pdoc(11, 'imm1344', { approved: true }),
    ];
    const ins = inputs(withDocs(docs));
    expect(ins.some((i) => i.op === 'attach_file')).toBe(false);
    expect(ins.some((i) => i.page === PR_CASE)).toBe(false);
    expect(ins.some((i) => i.fieldKey.startsWith('pr_upload_'))).toBe(false);
  });

  it('each row is listed as the applicant’s, with the VisaAI documents they have for it', () => {
    const p = withDocs([...DOCS, pdoc(11, 'imm1344', { approved: true })]);
    const left = portalFillCoverage(mapping(), p).pages.find(
      (x) => x.page === PR_CASE,
    )!.left;
    const note = (label: RegExp) => left.find((l) => label.test(l.label))?.note;
    expect(note(/Travel documents/)).toMatch(/yourself.*passport\.pdf/);
    expect(note(/Proof of payment/)).toMatch(/processing_fee_receipt\.pdf/);
    expect(note(/Photo/)).toMatch(/photo\.jpg/);
    expect(note(/IMM 1344/)).toMatch(/sign it first.*imm1344\.pdf/);
    expect(note(/IMM 5532/)).toMatch(/^Upload it on IRCC yourself\. .*sign/);
    expect(note(/IMM 5532/)).not.toMatch(/In VisaAI you have/);
    const all = JSON.stringify(left);
    expect(all).toContain('Pay your fees');
    expect(all).toContain('Additional supporting documents');
    expect(all).toMatch(/does not upload files there yet/);
    expect(all).toMatch(/never signs, pays or submits/);
    for (const l of left) expect(l.reason).toBe('fill_yourself');
  });

  it('the slots stay defined: each row pattern names exactly one recorded row', () => {
    const rows = [
      '* IMM 1344 (required) Download Application to Sponsor, Sponsorship Agreement and Undertaking',
      'IMM 5532 (required) Download Relationship Information and Sponsorship Evaluation Form',
      'IMM 5533 (required) Download Document Checklist: Spousal Sponsorship (Including Dependent Children)',
      'Travel documents and passports (required)',
      'Police certificates and clearances (required)',
      'Photo(s) (required)',
      'Birth Certificates (required)',
      'Proof of Status (required)',
      '* Proof of payment (required) Visit the link below and follow these instructions to pay your fees.',
    ];
    for (const slot of PR_UPLOAD_SLOTS) {
      const re = new RegExp(slot.rowPattern, 'i');
      expect([slot.key, rows.filter((r) => re.test(r)).length]).toEqual([
        slot.key,
        1,
      ]);
    }
  });

  it('the old "uploads are yours" note is gone from the forms', () => {
    const cov = portalFillCoverage(mapping(), APPLICANT);
    const page3 = cov.pages.find((x) => x.page === PR_IMM0008(3))!;
    expect(JSON.stringify(page3)).not.toMatch(/PDF forms, uploads/);
  });
});

// ── the profile: "Add dependant" (live 2026-10-20) ─────────────────────────

describe('PR profile: dependants', () => {
  const NOW = Date.UTC(2026, 9, 21);
  const CHILD = {
    family_name: 'EXAMPLE',
    given_name: 'TEST CHILD',
    relationship: 'daughter',
    date_of_birth: '2024-07-06',
    accompanying: 'Yes',
  };
  const withChildren = (children: unknown[]) => ({
    ...APPLICANT,
    has_children: 'Yes',
    children,
  });
  const SUMMARY =
    'Name: TEST CHILD EXAMPLE; Family name: EXAMPLE; Date of birth: 2024/07/06; Relationship: Child; Accompanying: Yes';

  it('adds a dependent child: open, accompanying, relationship, names, DOB, save', () => {
    const p = withChildren([CHILD]);
    const ins = inputs(p).filter((i) => i.fieldKey.startsWith('pr_dependant0'));
    expect(ins.map((i) => [i.fieldKey, i.mappedValue, i.op ?? null])).toEqual([
      ['pr_dependant0', SUMMARY, 'dependant_open'],
      ['pr_dependant0_accompanying', 'Yes', 'radio'],
      ['pr_dependant0_relationship', 'Child', 'select_text'],
      ['pr_dependant0_family_name', 'EXAMPLE', null],
      ['pr_dependant0_given_name', 'TEST CHILD', null],
      ['pr_dependant0_date_of_birth', '2024/07/06', null],
      ['pr_dependant0_save', SUMMARY, 'dependant_save'],
    ]);
    for (const i of ins) {
      expect(i.page).toBe(PR_PROFILE);
      expect(i.reveal).toBe(true);
    }
    expect(ins[0].targetField).toBe(DEPENDANT_ADD);
    expect(ins[6].targetField).toBe(DEPENDANT_SAVE);
    // Every field of the inline form is scoped to it.
    expect(ins[1].targetField).toBe('#dependantYes >> dependant');
    expect(ins[2].targetField).toBe(
      '#dependantForm-relationship >> dependant >> option=text:Child',
    );
    expect(ins[5].targetField).toBe('#personalDetailsForm-dob >> dependant');
  });

  it("the principal's own date of birth keeps its plain selector, before any dependant step", () => {
    const p = withChildren([CHILD]);
    const all = inputs(p);
    const principal = all.findIndex((i) => i.fieldKey === 'pr_date_of_birth');
    expect(all[principal].targetField).toBe('#personalDetailsForm-dob');
    expect(all[principal].mappedValue).toBe('1990/01/15');
    const firstDependant = all.findIndex((i) => i.fieldKey === 'pr_dependant0');
    expect(principal).toBeLessThan(firstDependant);
    // No unscoped write ever targets the shared DOB id with a dependant's value.
    for (const i of all.filter((x) =>
      x.targetField.startsWith('#personalDetailsForm-dob'),
    ))
      if (i.fieldKey !== 'pr_date_of_birth')
        expect(i.targetField).toBe('#personalDetailsForm-dob >> dependant');
    // Every profile write after the first dependant step is a dependant step.
    for (const i of all
      .slice(firstDependant)
      .filter((x) => x.page === PR_PROFILE))
      expect(i.fieldKey.startsWith('pr_dependant')).toBe(true);
  });

  it('a single full-name string is not split; missing facts are explained, not guessed', () => {
    const p = withChildren([
      {
        ...CHILD,
        family_name: undefined,
        given_name: undefined,
        name: 'Test Child Example',
      },
      { ...CHILD, given_name: 'TEST SECOND', accompanying: undefined },
      { ...CHILD, given_name: 'TEST THIRD', relationship: undefined },
    ]);
    const v = byKey(p);
    expect(Object.keys(v).some((k) => k.startsWith('pr_dependant'))).toBe(
      false,
    );
    const notes = portalFillCoverage(mapping(), p)
      .pages.find((x) => x.page === PR_PROFILE)!
      .left.filter((l) => l.label === 'Dependant not added')
      .map((l) => l.note);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/family name and given name\(s\) separately/);
    expect(notes[1]).toMatch(/whether they are accompanying you/);
    expect(notes[2]).toMatch(/relationship/);
  });

  it('"accompanying" only from an explicit answer: a list of other names is not "No"', () => {
    const p = {
      ...withChildren([
        { ...CHILD, accompanying: undefined },
        { ...CHILD, given_name: 'TEST OTHER', accompanying: undefined },
      ]),
      children_accompanying: ['TEST CHILD EXAMPLE'],
    };
    const v = byKey(p);
    expect(v.pr_dependant0_accompanying).toBe('Yes');
    // Not named: undecided, so not added — and said so.
    expect(v.pr_dependant1).toBeUndefined();
    const notes = JSON.stringify(portalFillCoverage(mapping(), p));
    expect(notes).toMatch(
      /Child 2 in your VisaAI data: missing whether they are accompanying you/,
    );
    // "none" / false / [] say nobody comes: an explicit "No".
    for (const none of ['none', false, []])
      expect(
        byKey({
          ...withChildren([{ ...CHILD, accompanying: undefined }]),
          children_accompanying: none,
        }).pr_dependant0_accompanying,
      ).toBe('No');
    // The child's own answer wins.
    expect(
      byKey({
        ...withChildren([{ ...CHILD, accompanying: 'No' }]),
        children_accompanying: ['TEST CHILD EXAMPLE'],
      }).pr_dependant0_accompanying,
    ).toBe('No');
  });

  it('first + middle names are the given names', () => {
    const v = byKey(
      withChildren([
        {
          ...CHILD,
          given_name: undefined,
          first_name: 'TEST',
          middle_name: 'MIDDLE',
        },
      ]),
    );
    expect(v.pr_dependant0_given_name).toBe('TEST MIDDLE');
  });

  it('age decides first; marital status by whole word, negations included', () => {
    const at = (dob: string, marital?: string) =>
      dependentChild({ date_of_birth: dob, marital_status: marital }, NOW);
    // Under 18: a dependent child unless recorded as a spouse or partner
    // (IRCC: under 22 AND not a spouse or common-law partner).
    expect(at('2015-01-01')).toBe('Yes');
    expect(at('2015-01-01', 'Unmarried')).toBe('Yes');
    expect(at('2015-01-01', 'married')).toBeUndefined();
    // 18 to 21.
    for (const single of [
      'single',
      'Unmarried',
      'never married',
      'Not married',
      'divorced',
    ])
      expect([single, at('2007-01-01', single)]).toEqual([single, 'Yes']);
    for (const partnered of ['married', 'Common-Law', 'common law'])
      expect([partnered, at('2007-01-01', partnered)]).toEqual([
        partnered,
        'No',
      ]);
    expect(at('2007-01-01', 'separated')).toBeUndefined();
    expect(at('2007-01-01')).toBeUndefined();
  });

  it('no child is dropped silently', () => {
    const p = withChildren([
      {
        ...CHILD,
        given_name: 'TEST MARRIED',
        date_of_birth: '2007-01-01',
        marital_status: 'married',
      },
      { ...CHILD, given_name: 'TEST ADULT', date_of_birth: '1999-01-01' },
      { ...CHILD, given_name: 'TEST GONE', deceased: 'Yes' },
      { ...CHILD, given_name: 'TEST NODATE', date_of_birth: undefined },
    ]);
    const notes = portalFillCoverage(mapping(), p)
      .pages.find((x) => x.page === PR_PROFILE)!
      .left.filter((l) => l.label === 'Dependant not added')
      .map((l) => l.note);
    expect(notes).toHaveLength(4);
    expect(notes[0]).toMatch(/^Child 1 .*not a dependent child/);
    expect(notes[1]).toMatch(/^Child 2 .*cannot tell/);
    expect(notes[2]).toMatch(/^Child 3 .*deceased/);
    expect(notes[3]).toMatch(/^Child 4 /);
  });

  it('only dependent children: an adult or a married child is not added', () => {
    expect(dependentChild({ date_of_birth: '2024-07-06' }, NOW)).toBe('Yes');
    expect(
      dependentChild({ date_of_birth: '2000-01-01' }, NOW),
    ).toBeUndefined();
    expect(
      dependentChild(
        { date_of_birth: '2007-01-01', marital_status: 'single' },
        NOW,
      ),
    ).toBe('Yes');
    expect(
      dependentChild({ date_of_birth: '2007-01-01' }, NOW),
    ).toBeUndefined();
    expect(
      dependentChild(
        { date_of_birth: '2007-01-01', marital_status: 'married' },
        NOW,
      ),
    ).toBe('No');
    expect(
      dependentChild({ date_of_birth: '2000-01-01', dependent: 'Yes' }, NOW),
    ).toBe('Yes');
    expect(
      dependantsOf(
        withChildren([
          CHILD,
          { ...CHILD, given_name: 'TEST ADULT', date_of_birth: '1999-01-01' },
        ]),
        NOW,
      ).map((d) => d.given),
    ).toEqual(['TEST CHILD']);
  });

  it('relationship options', () => {
    expect(dependantRelationship({ relationship: 'son' })).toBe('Child');
    expect(dependantRelationship({ relationship: 'step-daughter' })).toBe(
      'Step-Child',
    );
    expect(dependantRelationship({ relationship: 'adopted son' })).toBe(
      'Adopted Child',
    );
    expect(dependantRelationship({ relationship: 'nephew' })).toBeUndefined();
    expect(dependantRelationship({})).toBeUndefined();
  });

  it('excluding one dependant step excludes that dependant only', () => {
    const p = withChildren([CHILD, { ...CHILD, given_name: 'TEST SECOND' }]);
    const keys = buildMappingInputs(
      mapping(),
      p,
      new Set(['pr_dependant0_given_name']),
    ).map((i) => i.fieldKey);
    expect(keys.some((k) => k.startsWith('pr_dependant0'))).toBe(false);
    expect(keys).toContain('pr_dependant1_save');
  });

  it('at most MAX_DEPENDANTS; the rest are explained', () => {
    const many = Array.from({ length: MAX_DEPENDANTS + 1 }, (_, k) => ({
      ...CHILD,
      given_name: `TEST CHILD ${k}`,
    }));
    const p = withChildren(many);
    expect(byKey(p)[`pr_dependant${MAX_DEPENDANTS - 1}_save`]).toBeDefined();
    const cov = JSON.stringify(portalFillCoverage(mapping(), p));
    expect(cov).toContain(`at most ${MAX_DEPENDANTS} dependants`);
  });

  it('the profile note says the assistant adds dependants now', () => {
    const cov = JSON.stringify(portalFillCoverage(mapping(), APPLICANT));
    expect(cov).not.toContain('with \\"Add dependant\\" yourself.\\"');
    expect(cov).toContain('The assistant adds your dependent children');
  });
});
