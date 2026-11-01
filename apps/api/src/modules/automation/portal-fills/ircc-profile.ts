import { intakeAnswerIsYes, isoDayMs } from '@visaai/types';
import { countryName, toIso3 } from './country-names';

/**
 * Readers that turn an applicant profile into the answers IRCC's tr-rt pages
 * ask for. Profiles are written by an interview extractor and by document
 * extraction, so one fact arrives under several keys and shapes; every reader
 * here takes the first EXPLICIT answer and otherwise returns undefined, which
 * means "nothing is written; the applicant fills it".
 *
 * Nothing here defaults an answer. In particular the legal declarations
 * (criminality, security, medical, immigration history) are read only from an
 * answer the applicant gave to that question — `declared` below — and an
 * aggregate answer is used only where it covers the portal's question
 * exactly (see crime questions in canada-ircc.ts).
 */
export type Profile = Record<string, unknown>;

function present(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/** First present value among the keys. */
export function pick(p: Profile, ...keys: string[]): unknown {
  for (const k of keys) if (present(p[k])) return p[k];
  return undefined;
}

/** First present string among the keys, trimmed. */
export function pickText(p: Profile, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** "Yes" / "No" from the first key holding a yes/no answer; undefined otherwise. */
export function declared(
  p: Profile,
  ...keys: string[]
): 'Yes' | 'No' | undefined {
  for (const k of keys) {
    const yn = intakeAnswerIsYes(p[k]);
    if (yn !== undefined) return yn ? 'Yes' : 'No';
  }
  return undefined;
}

/** An ISO date (YYYY-MM-DD) from the first key holding one. */
export function pickDate(p: Profile, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (typeof v !== 'string') continue;
    const d = v.trim().slice(0, 10);
    if (isoDayMs(d) !== null) return d;
  }
  return undefined;
}

/** ISO-3 country from the first key whose value names a known country. */
export function pickCountry(p: Profile, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const iso = toIso3(p[k]);
    if (iso) return iso;
  }
  return undefined;
}

/** "Rawalpindi, Punjab, Pakistan" → { city: "Rawalpindi", country: "PAK" }. */
export function splitPlace(place: unknown): {
  city?: string;
  country?: string;
} {
  if (typeof place !== 'string' || !place.trim()) return {};
  const parts = place
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  const country = toIso3(parts[parts.length - 1]) ?? undefined;
  if (parts.length === 1) return country ? { country } : { city: parts[0] };
  return { city: parts[0], country };
}

/**
 * Family and given names. Explicit parts win; a full name is split on its
 * last word (the readback gate shows the split for the applicant to check).
 */
export function nameParts(
  p: Profile,
  prefix: string,
): { family?: string; given?: string } {
  const family = pickText(
    p,
    `${prefix}_family_name`,
    `${prefix}_last_name`,
    `${prefix}_surname`,
  );
  const given = pickText(
    p,
    `${prefix}_given_name`,
    `${prefix}_given_names`,
    `${prefix}_first_name`,
  );
  if (family && given) return { family, given };
  const full = pickText(p, `${prefix}_name`, `${prefix}_full_name`);
  if (!full) return { family, given };
  const words = full.split(/\s+/);
  if (words.length < 2) return { family, given };
  return {
    family: family ?? words[words.length - 1],
    given: given ?? words.slice(0, -1).join(' '),
  };
}

export interface Address {
  street?: string;
  streetNumber?: string;
  streetName?: string;
  apartment?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
}

const CA_POSTAL = /\b([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)\b/;
const CA_PROVINCES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

function province(token: string): string | undefined {
  const t = token.trim();
  const code = t.toUpperCase().replace(/\./g, '');
  if (CA_PROVINCES[code]) return CA_PROVINCES[code];
  const byName = Object.values(CA_PROVINCES).find(
    (n) => n.toLowerCase() === t.toLowerCase(),
  );
  return byName;
}

/** An address object ({street, city, …}) under a key, read as an Address. */
function addressObject(v: unknown): Address | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Profile;
  const a: Address = {
    street: pickText(
      o,
      'street',
      'street_address',
      'address_line1',
      'line1',
      'address1',
    ),
    streetNumber: pickText(o, 'street_number', 'house_number', 'civic_number'),
    streetName: pickText(o, 'street_name'),
    apartment: pickText(o, 'apartment', 'unit', 'apt', 'suite'),
    city: pickText(o, 'city', 'town', 'locality'),
    province: pickText(o, 'province', 'state', 'region'),
    postalCode: pickText(o, 'postal_code', 'postcode', 'zip', 'zip_code'),
    country: toIso3(o.country) ?? undefined,
  };
  return a;
}

/**
 * A one-line address, split conservatively: the last part must name a known
 * country, the part before it is the city (a postal code inside it is taken
 * out), and everything before that is the street. Anything else is not split.
 */
export function parseAddressLine(line: unknown): Address | undefined {
  if (typeof line !== 'string' || !line.trim()) return undefined;
  const parts = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 3) return undefined;
  const country = toIso3(parts[parts.length - 1]);
  if (!country) return undefined;
  let cityPart = parts[parts.length - 2];
  let postalCode: string | undefined;
  const pc = /\b(\d{4,6})\b/.exec(cityPart);
  if (pc) {
    postalCode = pc[1];
    cityPart = cityPart.replace(pc[0], '').trim();
  }
  if (!cityPart || /\d/.test(cityPart)) return undefined;
  return {
    street: parts.slice(0, -2).join(', '),
    city: cityPart,
    postalCode,
    country,
  };
}

/**
 * A Canadian address ("123 Main St, Apt 4, Toronto, ON M5V 2T6[, Canada]").
 * Needs a civic number, a city, a province and a postal code; otherwise it is
 * not split and the inviter's address is left for the applicant.
 */
export function parseCanadianAddress(line: unknown): Address | undefined {
  if (typeof line !== 'string' || !line.trim()) return undefined;
  let parts = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length && toIso3(parts[parts.length - 1]) === 'CAN')
    parts = parts.slice(0, -1);
  if (parts.length < 3) return undefined;
  const last = parts[parts.length - 1];
  const pc = CA_POSTAL.exec(last);
  if (!pc) return undefined;
  const prov = province(last.replace(pc[0], '').trim());
  if (!prov) return undefined;
  const city = parts[parts.length - 2];
  if (!city || /\d/.test(city)) return undefined;
  const streetParts = parts.slice(0, -2);
  let apartment: string | undefined;
  const rest: string[] = [];
  for (const s of streetParts) {
    const apt = /^(?:apt\.?|apartment|unit|suite|#)\s*([\w-]+)$/i.exec(s);
    if (apt) apartment = apt[1];
    else rest.push(s);
  }
  const m = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(rest.join(' '));
  if (!m) return undefined;
  return {
    streetNumber: m[1],
    streetName: m[2],
    apartment,
    city,
    province: prov,
    postalCode: `${pc[1]} ${pc[2]}`.toUpperCase(),
    country: 'CAN',
  };
}

/** The applicant's home address: structured keys, an address object, or one line. */
export function residentialAddress(p: Profile): Address | undefined {
  const flat: Address = {
    street: pickText(
      p,
      'residential_address_street',
      'residential_street',
      'address_street',
      'street_address',
      'address_line1',
    ),
    city: pickText(
      p,
      'residential_address_city',
      'residential_city',
      'address_city',
      'city_of_residence',
    ),
    postalCode: pickText(
      p,
      'residential_address_postal_code',
      'residential_postal_code',
      'address_postal_code',
      'postal_code',
    ),
    country: pickCountry(
      p,
      'residential_address_country',
      'residential_country',
      'address_country',
      'country_of_residence',
      'residence_country',
    ),
  };
  if (flat.street && flat.city && flat.country) return flat;
  for (const k of [
    'residential_address',
    'home_address',
    'current_address',
    'address',
  ]) {
    const obj = addressObject(p[k]);
    if (obj?.street && obj.city)
      return { ...obj, country: obj.country ?? flat.country };
    const line = parseAddressLine(p[k]);
    if (line) return line;
  }
  return undefined;
}

/** A separate mailing address, when the profile records one. */
export function mailingAddress(p: Profile): Address | undefined {
  for (const k of [
    'mailing_address',
    'postal_address',
    'correspondence_address',
  ]) {
    const obj = addressObject(p[k]);
    if (obj?.street && obj.city) return obj;
    const line = parseAddressLine(p[k]);
    if (line) return line;
  }
  return undefined;
}

function sameAddress(a: Address, b: Address): boolean {
  const n = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    n(a.street) === n(b.street) &&
    n(a.city) === n(b.city) &&
    a.country === b.country
  );
}

/**
 * The address IRCC's contact page is filled with, and whether the mailing
 * address is the residential one. A recorded mailing address that differs
 * from home is used as the mailing address with "No" (the residential
 * follow-up is then the applicant's to complete).
 */
export function contactAddress(
  p: Profile,
): { address: Address; same: 'Yes' | 'No' } | undefined {
  const home = residentialAddress(p);
  const mail = mailingAddress(p);
  const explicit = declared(
    p,
    'mailing_same_as_residential',
    'mailing_address_same_as_residential',
    'mailing_address_same',
  );
  if (mail) {
    const same =
      explicit ??
      (home && sameAddress(home, mail) ? 'Yes' : home ? 'No' : undefined);
    return same ? { address: mail, same } : undefined;
  }
  if (!home) return undefined;
  if (explicit === 'No') return undefined; // a different mailing address we do not have
  return { address: home, same: 'Yes' };
}

/** One person record from a list under any of the keys. */
export function people(p: Profile, ...keys: string[]): Profile[] {
  for (const k of keys) {
    const v = p[k];
    if (Array.isArray(v)) {
      return v.filter(
        (x): x is Profile => !!x && typeof x === 'object' && !Array.isArray(x),
      );
    }
  }
  return [];
}

export function displayCountry(iso3: string | undefined): string | undefined {
  return iso3 ? (countryName(iso3) ?? iso3) : undefined;
}

/** Truncate nothing; join parts with spaces and drop empties. */
export function sentence(...parts: Array<string | undefined | false>): string {
  return parts.filter((x): x is string => !!x && x.trim() !== '').join(' ');
}

export const CA_PROVINCE_NAMES = CA_PROVINCES;
