/**
 * IRCC tr-rt address groups (bundle 2026-10-19): Canada, the United States
 * and Mexico take the manual-entry form — #manualEntryaddress_<g>-input,
 * #streetNum_, #street_, #apartmentNumber_, #city_, then #province_ /
 * #postalcode_ (Canada), #state_ / #zipcode_ (U.S.), #mexicoState_ /
 * #postalcodeMexico_ (Mexico). #streetAddress_ and #postalcodeother_ are
 * hidden for those three countries and shown for every other.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const trv = () => resolvePortalFill('ircc')!;

const BASE: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
};

const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), values(p));
const at = (p: Record<string, unknown>, target: string) =>
  mapped(p).find((x) => x.targetField === target)?.mappedValue;
const targets = (p: Record<string, unknown>) =>
  mapped(p).map((x) => x.targetField);
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)
    ?.left ?? [];

const spouseAt = (address: unknown) => ({
  marital_status: 'Married',
  spouse_same_address: false,
  spouse_address: address,
});

describe('a U.S. address takes the manual-entry form', () => {
  const p = spouseAt('350 Fifth Avenue, Apt 4B, New York, NY 10118, USA');

  it('ticks manual entry and writes number, street, city, state and ZIP', () => {
    expect(at(p, '#country_partnerInfoAddress')).toBeDefined();
    expect(at(p, '#manualEntryaddress_partnerInfoAddress-input')).toBe('Yes');
    expect(at(p, '#streetNum_partnerInfoAddress')).toBe('350');
    expect(at(p, '#street_partnerInfoAddress')).toBe('Fifth Avenue');
    expect(at(p, '#apartmentNumber_partnerInfoAddress')).toBe('4B');
    expect(at(p, '#city_partnerInfoAddress')).toBe('New York');
    expect(at(p, '#state_partnerInfoAddress')).toBe('New York');
    expect(at(p, '#zipcode_partnerInfoAddress')).toBe('10118');
  });

  it('never writes the street line or other-country postal code IRCC hides', () => {
    const t = targets(p);
    expect(t).not.toContain('#streetAddress_partnerInfoAddress');
    expect(t).not.toContain('#postalcodeother_partnerInfoAddress');
    expect(t).not.toContain('#province_partnerInfoAddress');
    expect(t).not.toContain('#postalcode_partnerInfoAddress');
  });

  it('a state given by name, and a ZIP+4, are accepted', () => {
    const q = spouseAt({
      street: '1600 Amphitheatre Parkway',
      city: 'Mountain View',
      state: 'california',
      zip: '94043-1351',
      country: 'United States',
    });
    expect(at(q, '#state_partnerInfoAddress')).toBe('California');
    expect(at(q, '#zipcode_partnerInfoAddress')).toBe('94043-1351');
  });

  it('without a state or a valid ZIP nothing of the address is written', () => {
    for (const a of [
      '350 Fifth Avenue, New York, USA',
      '350 Fifth Avenue, New York, NY 1011, USA',
    ]) {
      const t = targets(spouseAt(a));
      expect(t).not.toContain('#manualEntryaddress_partnerInfoAddress-input');
      expect(t).not.toContain('#streetAddress_partnerInfoAddress');
    }
  });
});

describe('a Mexican address takes the manual-entry form', () => {
  const p = spouseAt({
    street: 'Avenida Reforma 222',
    city: 'Ciudad de México',
    state: 'CDMX',
    postal_code: '06600',
    country: 'Mexico',
  });

  it('writes number (last in the street), street, city, state and postal code', () => {
    expect(at(p, '#manualEntryaddress_partnerInfoAddress-input')).toBe('Yes');
    expect(at(p, '#streetNum_partnerInfoAddress')).toBe('222');
    expect(at(p, '#street_partnerInfoAddress')).toBe('Avenida Reforma');
    expect(at(p, '#city_partnerInfoAddress')).toBe('Ciudad de México');
    expect(at(p, '#mexicoState_partnerInfoAddress')).toBe('CDMX');
    expect(at(p, '#postalcodeMexico_partnerInfoAddress')).toBe('06600');
    expect(targets(p)).not.toContain('#state_partnerInfoAddress');
    expect(targets(p)).not.toContain('#streetAddress_partnerInfoAddress');
  });
});

describe('Canada and every other country are unchanged', () => {
  it('Canada: province and postal code', () => {
    const p = spouseAt('1228 Turner Drive, Milton, ON L9T 5R6, Canada');
    expect(at(p, '#manualEntryaddress_partnerInfoAddress-input')).toBe('Yes');
    expect(at(p, '#province_partnerInfoAddress')).toBe('Ontario');
    expect(at(p, '#postalcode_partnerInfoAddress')).toBe('L9T 5R6');
    expect(targets(p)).not.toContain('#zipcode_partnerInfoAddress');
  });

  it('Pakistan: one street line, no manual-entry fields', () => {
    const p = spouseAt('5 Canal Road, Lahore, Pakistan');
    expect(at(p, '#streetAddress_partnerInfoAddress')).toBe('5 Canal Road');
    expect(at(p, '#city_partnerInfoAddress')).toBe('Lahore');
    expect(targets(p)).not.toContain(
      '#manualEntryaddress_partnerInfoAddress-input',
    );
  });
});

describe('mailing address (contact information)', () => {
  it('a U.S. mailing address fills the manual-entry form, not the street line', () => {
    const p = {
      residential_address: '350 Fifth Avenue, New York, NY 10118, USA',
      mailing_same_as_residential: true,
    };
    expect(at(p, '#manualEntryaddress_contactAddressGroup-input')).toBe('Yes');
    expect(at(p, '#streetNum_contactAddressGroup')).toBe('350');
    expect(at(p, '#state_contactAddressGroup')).toBe('New York');
    expect(at(p, '#zipcode_contactAddressGroup')).toBe('10118');
    expect(targets(p)).not.toContain('#streetAddress_contactAddressGroup');
    expect(targets(p)).not.toContain('#postalcodeother_contactAddressGroup');
  });

  it('an incomplete Canadian mailing address is left with a note', () => {
    const p = {
      residential_address: 'Turner Drive, Milton, Canada',
      mailing_same_as_residential: true,
    };
    expect(targets(p)).not.toContain('#streetAddress_contactAddressGroup');
    expect(
      left(p, '/contact-info').some((n) => /part by part/.test(n.note ?? '')),
    ).toBe(true);
  });

  it('a Pakistani mailing address still fills the street line', () => {
    const p = {
      residential_address: 'House 12, Street 4, Rawalpindi, Pakistan',
      mailing_same_as_residential: true,
    };
    expect(at(p, '#streetAddress_contactAddressGroup')).toBe(
      'House 12, Street 4',
    );
    expect(at(p, '#city_contactAddressGroup')).toBe('Rawalpindi');
  });
});

describe('review of #253', () => {
  it.each([
    '350 Fifth Avenue, New York, NY 10118, USA',
    '1228 Turner Drive, Milton, ON L9T 5R6, Canada',
  ])('a complete mailing address (%s) lists nothing on the page', (a) => {
    const p = { residential_address: a, mailing_same_as_residential: true };
    const rows = left(p, '/contact-info').map((n) => n.label);
    expect(rows.filter((l) => /^Mailing address/.test(l))).toEqual([]);
  });

  it.each([
    ['Calle 5 # 23', '23', 'Calle 5'],
    ['Av. Insurgentes Sur # 1234', '1234', 'Av. Insurgentes Sur'],
    ['Insurgentes Sur No. 1234', '1234', 'Insurgentes Sur'],
  ])(
    'Mexico: "%s" — the number after # or No. is the civic number',
    (street, num, name) => {
      const p = spouseAt({
        street,
        city: 'Mérida',
        state: 'Yucatán',
        country: 'Mexico',
      });
      expect(at(p, '#streetNum_partnerInfoAddress')).toBe(num);
      expect(at(p, '#street_partnerInfoAddress')).toBe(name);
      expect(targets(p)).not.toContain('#apartmentNumber_partnerInfoAddress');
    },
  );

  it.each(['PO Box 123', 'Route 66'])(
    'U.S.: "%s" has no civic number, so nothing is written',
    (street) => {
      const p = spouseAt({
        street,
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'USA',
      });
      expect(targets(p)).not.toContain('#streetNum_partnerInfoAddress');
      expect(targets(p)).not.toContain(
        '#manualEntryaddress_partnerInfoAddress-input',
      );
    },
  );

  it('"100 Unit Road" is a street, not a unit', () => {
    const p = spouseAt('100 Unit Road, Austin, TX 78701, USA');
    expect(at(p, '#streetNum_partnerInfoAddress')).toBe('100');
    expect(at(p, '#street_partnerInfoAddress')).toBe('Unit Road');
  });

  it('a Pakistani mailing and spouse address resolve exactly as before', () => {
    const p = {
      residential_address: 'House 12, Street 4, Rawalpindi, Pakistan',
      mailing_same_as_residential: true,
      ...spouseAt('5 Canal Road, Lahore, Pakistan'),
    };
    const contact = mapped(p)
      .filter((x) =>
        /contactAddressGroup|partnerInfoAddress/.test(x.targetField),
      )
      .map((x) => `${x.fieldKey}=${x.targetField}=${x.mappedValue}`);
    expect(contact).toEqual([
      expect.stringMatching(/^mailing_country=#country_contactAddressGroup=/),
      'mailing_street=#streetAddress_contactAddressGroup=House 12, Street 4',
      'mailing_city=#city_contactAddressGroup=Rawalpindi',
      expect.stringMatching(
        /^ircc_spouse_address_country=#country_partnerInfoAddress=/,
      ),
      'ircc_spouse_address_street=#streetAddress_partnerInfoAddress=5 Canal Road',
      'ircc_spouse_address_city=#city_partnerInfoAddress=Lahore',
    ]);
  });
});

describe('re-review of #253', () => {
  const mx = (street: string) =>
    spouseAt({ street, city: 'Mérida', state: 'Yucatán', country: 'Mexico' });

  it('Mérida: the number after # is the civic number, cross streets stay', () => {
    const p = mx('Calle 60 # 23 x 45 y 47');
    expect(at(p, '#streetNum_partnerInfoAddress')).toBe('23');
    expect(at(p, '#street_partnerInfoAddress')).toBe('Calle 60 x 45 y 47');
  });

  it('Mexico: a leading number still parses', () => {
    const p = mx('222 Avenida Reforma');
    expect(at(p, '#streetNum_partnerInfoAddress')).toBe('222');
    expect(at(p, '#street_partnerInfoAddress')).toBe('Avenida Reforma');
  });

  it('U.S.: a one-letter unit is split off', () => {
    const p = spouseAt('123 Main Street Apt B, Austin, TX 78701, USA');
    expect(at(p, '#apartmentNumber_partnerInfoAddress')).toBe('B');
    expect(at(p, '#street_partnerInfoAddress')).toBe('Main Street');
  });

  it('an apartment over 10 characters stays on the street line', () => {
    const p = spouseAt({
      street: '350 Fifth Avenue',
      apartment: 'Penthouse 12345',
      city: 'New York',
      state: 'NY',
      zip: '10118',
      country: 'USA',
    });
    expect(targets(p)).not.toContain('#apartmentNumber_partnerInfoAddress');
    expect(at(p, '#street_partnerInfoAddress')).toBe(
      'Fifth Avenue Penthouse 12345',
    );
  });
});
