import { intakeAnswerIsYes, isoDayMs } from '@visaai/types';
import { countryName, toIso3 } from './country-names';

/**
 * An IRCC medical exam number in a format the portal accepts (live
 * validation 2026-10-18), or undefined: a UMI is 2 letters + 8 or 9 digits,
 * or "U" + 9 digits; an IME is digits only — 8 here, since a 10-digit number
 * was rejected. Spaces and dashes are dropped, letters uppercased.
 */
export function irccMedicalNumber(raw: string): string | undefined {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{2}\d{8,9}$/.test(v) || /^U\d{9}$/.test(v) || /^\d{8}$/.test(v)
    ? v
    : undefined;
}

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

/** City-states: the place of birth "Singapore" is the city AND the country. */
const CITY_STATES = new Set(['HKG', 'MAC', 'SGP', 'MCO', 'VAT']);

/**
 * "Rawalpindi, Punjab, Pakistan" → { city: "Rawalpindi", country: "PAK" }.
 * A single part that names a country is the country ("PAKISTAN" →
 * { country: "PAK" }), and also the city for a city-state ("HONG KONG" →
 * { city: "HONG KONG", country: "HKG" }). "Kowloon, Hong Kong, China" is
 * Hong Kong, which IRCC lists apart from China.
 */
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
  const last = parts[parts.length - 1];
  // "Los Angeles, CA" is California, not Canada; "Atlanta, GA" Georgia, not
  // Gabon (review 2026-10-18): after a city, a two-letter code is a state or
  // province first.
  const region =
    parts.length > 1 && /^[A-Z]{2}$/.test(last)
      ? US_STATES[last]
        ? 'USA'
        : CA_PROVINCES[last]
          ? 'CAN'
          : undefined
      : undefined;
  let country = region ?? toIso3(last) ?? undefined;
  if (country === 'CHN' && parts.length > 1) {
    const sar = toIso3(parts[parts.length - 2]);
    if (sar === 'HKG' || sar === 'MAC') country = sar;
  }
  if (parts.length === 1) {
    if (!country) return { city: parts[0] };
    return CITY_STATES.has(country) ? { city: parts[0], country } : { country };
  }
  return { city: parts[0], country };
}

/**
 * Family and given names. Explicit parts win; a full name is split on its
 * last word (the readback gate shows the split for the applicant to check).
 * A single name is the family name, the given name left blank (IRCC: "if you
 * have only one name, enter it as your last name").
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
  if (words.length < 2)
    return given ? { family, given } : { family: family ?? words[0] };
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
  /** ISO-3. */
  country?: string;
  /**
   * The country as the address line wrote it, most specific first: "England"
   * for "…, England, United Kingdom". Portals that list the UK by nation (the
   * eTA place list) need this, not GBR.
   */
  countryText?: string;
}

const CA_POSTAL = /\b([A-Za-z]\d[A-Za-z])[\s-]?(\d[A-Za-z]\d)\b/;
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
  // "Québec" and "Quebec" alike.
  const plain = (x: string) =>
    x
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const byName = Object.values(CA_PROVINCES).find((n) => plain(n) === plain(t));
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
 * Region names a one-line address may carry between the city and the postal
 * code / country. Only a part on this list is taken off as the region; any
 * other part stays where it is (a neighbourhood like "Johar Town" or "Clapham"
 * is part of the street, never the city).
 */
export const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};
const OTHER_REGIONS = [
  // Pakistan
  'Punjab',
  'Sindh',
  'Khyber Pakhtunkhwa',
  'KPK',
  'KP',
  'Balochistan',
  'Baluchistan',
  'Gilgit-Baltistan',
  'Gilgit Baltistan',
  'Azad Kashmir',
  'Azad Jammu and Kashmir',
  'AJK',
  'Islamabad Capital Territory',
  'ICT',
  // UK ceremonial counties and metropolitan areas
  'Greater London',
  'Greater Manchester',
  'West Midlands',
  'Merseyside',
  'West Yorkshire',
  'South Yorkshire',
  'North Yorkshire',
  'East Riding of Yorkshire',
  'Tyne and Wear',
  'Kent',
  'Essex',
  'Surrey',
  'Sussex',
  'East Sussex',
  'West Sussex',
  'Hampshire',
  'Berkshire',
  'Buckinghamshire',
  'Hertfordshire',
  'Oxfordshire',
  'Cambridgeshire',
  'Lancashire',
  'Cheshire',
  'Derbyshire',
  'Nottinghamshire',
  'Leicestershire',
  'Staffordshire',
  'Warwickshire',
  'Gloucestershire',
  'Somerset',
  'Devon',
  'Cornwall',
  'Dorset',
  'Wiltshire',
  'Norfolk',
  'Suffolk',
  'Lincolnshire',
  'Northamptonshire',
  'Bedfordshire',
  'Worcestershire',
  'Shropshire',
  'Herefordshire',
  'Cumbria',
  'Durham',
  'County Durham',
  'Northumberland',
  'Middlesex',
  'Avon',
  // India — states and union territories. Delhi, Chandigarh and Puducherry
  // are left out: each is also the city, and taking it off as the region
  // would make the street the city.
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Orissa',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Jammu and Kashmir',
  'Ladakh',
  'NCT of Delhi',
  'National Capital Territory of Delhi',
  // Nigeria — states whose name is not also their best-known city ("Lagos",
  // "Kano" are cities; "Lagos State" is caught by its suffix).
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Ekiti',
  'Imo',
  'Jigawa',
  'Kogi',
  'Kwara',
  'Ogun',
  'Osun',
  'Plateau',
  'Rivers',
  'Taraba',
  'Yobe',
  'Zamfara',
  'FCT',
  // China — provinces and autonomous regions (the municipalities are cities).
  'Anhui',
  'Fujian',
  'Gansu',
  'Guangdong',
  'Guizhou',
  'Hainan',
  'Hebei',
  'Heilongjiang',
  'Henan',
  'Hubei',
  'Hunan',
  'Jiangsu',
  'Jiangxi',
  'Liaoning',
  'Qinghai',
  'Shaanxi',
  'Shandong',
  'Shanxi',
  'Sichuan',
  'Yunnan',
  'Zhejiang',
  'Guangxi',
  'Inner Mongolia',
  'Ningxia',
  'Xinjiang',
  'Xizang',
  // Mexico — states not named like their capital.
  'Baja California',
  'Baja California Sur',
  'Chiapas',
  'Coahuila',
  'Guerrero',
  'Hidalgo',
  'Jalisco',
  'Estado de Mexico',
  'Edo Mex',
  'Edo de Mex',
  'Michoacan',
  'Morelos',
  'Nayarit',
  'Nuevo Leon',
  'Quintana Roo',
  'Sinaloa',
  'Sonora',
  'Tabasco',
  'Tamaulipas',
  'Yucatan',
  // Brazil — states not named like their capital.
  'Acre',
  'Alagoas',
  'Amapa',
  'Amazonas',
  'Bahia',
  'Ceara',
  'Distrito Federal',
  'Espirito Santo',
  'Goias',
  'Maranhao',
  'Mato Grosso',
  'Mato Grosso do Sul',
  'Minas Gerais',
  'Para',
  'Paraiba',
  'Parana',
  'Pernambuco',
  'Piaui',
  'Rio Grande do Norte',
  'Rio Grande do Sul',
  'Rondonia',
  'Roraima',
  'Santa Catarina',
  'Sergipe',
  'Tocantins',
  // Philippines — regions and provinces.
  'Metro Manila',
  'NCR',
  'National Capital Region',
  'Cavite',
  'Laguna',
  'Rizal',
  'Bulacan',
  'Pampanga',
  'Pangasinan',
  'Negros Occidental',
  'Negros Oriental',
  'Davao del Sur',
  'Davao del Norte',
  'Leyte',
  'Bohol',
  'Albay',
  'Camarines Sur',
  'Zambales',
  'Nueva Ecija',
  'Isabela',
  'Misamis Oriental',
  'Ilocos Norte',
  'Ilocos Sur',
  'Benguet',
  // Bangladesh — divisions are named like their cities; "Dhaka Division"
  // and "Sylhet District" are caught by their suffix.
];

/**
 * Two-letter state abbreviations that only mean a state in their own country
 * ("SP" is São Paulo in Brazil and nothing anywhere else).
 */
const SCOPED_REGION_CODES: Record<string, ReadonlySet<string>> = {
  BRA: new Set(
    'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(
      ' ',
    ),
  ),
  MEX: new Set(
    'ags bc bcs camp chis chih coah col dgo gto gro hgo jal mex mich mor nay nl oax pue qro qroo slp sin son tab tamps tlax ver yuc zac'.split(
      ' ',
    ),
  ),
};

/** Lower-case, accents and dots dropped: "São Paulo" → "sao paulo", "N.L." → "nl". */
const regionKey = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

const REGION_NAMES = new Set(
  [
    ...Object.keys(CA_PROVINCES),
    ...Object.values(CA_PROVINCES),
    ...Object.keys(US_STATES),
    ...Object.values(US_STATES),
    ...OTHER_REGIONS,
  ].map(regionKey),
);

/**
 * A part that says it is a region whatever the country: "Lagos State",
 * "Metro Manila", "Dhaka Division", "Province of Cavite", "Tokyo Prefecture".
 */
const REGION_WORDS =
  /^(?:[^\d,]+\s)?(?:State|Province|Region|Prefecture|Governorate|Oblast|County|District|Division|Territory)$|^Metro\s+[^\d\s]+$|^(?:State|Province|Prefecture|Governorate|Region) of\s+[^\d]+$/i;

const isRegion = (part: string, country?: string) => {
  const k = regionKey(part);
  if (!k) return false;
  if (REGION_NAMES.has(k)) return true;
  if (country && SCOPED_REGION_CODES[country]?.has(k)) return true;
  return REGION_WORDS.test(part.trim());
};

/**
 * A comma part that is only a postal code: "SW1A 1AA", "46000", "M5V 2T6",
 * "1012 AB", "01310-100", "100-0001", "00-950", "114 55", "D02 X285".
 */
const POSTAL_PART =
  /^(?:\d{3,10}(?:-\d{3,4})?|\d{2}-\d{3}|\d{3}\s\d{2}|[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d|\d{4}\s?[A-Za-z]{2}|[A-Za-z]\d{2}\s?[A-Za-z\d]{4})$/;

/**
 * "Maharashtra 400050", "NY 10001", "SP 01310-100": a known region and its
 * postal code in one part. Only split when the head is a region.
 */
function regionWithPostal(
  part: string,
  country?: string,
): { region: string; postalCode: string } | undefined {
  const words = part.trim().split(/\s+/);
  for (const n of [1, 2]) {
    if (words.length <= n) continue;
    const tail = words.slice(-n).join(' ');
    const head = words.slice(0, -n).join(' ');
    if (POSTAL_PART.test(tail) && /\d/.test(tail) && isRegion(head, country))
      return { region: head, postalCode: tail };
  }
  return undefined;
}

const sameText = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z]/g, '') ===
  b.toLowerCase().replace(/[^a-z]/g, '');

/**
 * A one-line address, split conservatively. Parts are comma-separated and the
 * line ends in its country:
 *
 *   "<street…>, <city>, <country>"
 *   "<street…>, <city>, <region>, <postal>, <constituent>, <country>"
 *     e.g. "10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom"
 *
 * From the end: the country (and a constituent country before it that names
 * the same state — "England, United Kingdom"), then a postal code, then a
 * region ONLY when it is a known province / state / county name, a state
 * abbreviation of that country ("SP" in Brazil) or says it is a region
 * ("Lagos State", "Metro Manila", "Dhaka Division"); "Maharashtra 400050" is
 * both. Before 2026-10-18 only Pakistani / UK / Canadian / US regions were
 * known and "…, Mumbai, Maharashtra, 400050, India" got the city
 * "Maharashtra". The city is
 * then the last remaining part and everything before it the street (so a
 * neighbourhood — "Johar Town", "Clapham" — stays in the street). The city is
 * never a part with digits or one that names a country (dry run 2026-10-17:
 * City/town = "England"); the line is then not split.
 *
 * `fallbackCountry` is for a line that names no country at all ("138 Millat
 * Colony, Rawalpindi 46000", dry run 2026-10-16) when the caller knows which
 * country the address is in — the applicant's home address is in their
 * country of residence.
 */
export function parseAddressLine(
  line: unknown,
  fallbackCountry?: string,
): Address | undefined {
  if (typeof line !== 'string' || !line.trim()) return undefined;
  const parts = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;

  let country = toIso3(parts[parts.length - 1]) ?? undefined;
  let countryText: string | undefined;
  if (country) {
    countryText = parts.pop()!;
    const prev = parts[parts.length - 1];
    if (
      prev !== undefined &&
      parts.length > 2 &&
      toIso3(prev) === country &&
      !sameText(prev, countryText)
    )
      countryText = parts.pop()!;
  } else {
    if (!fallbackCountry) return undefined;
    country = fallbackCountry;
  }
  if (parts.length < 2) return undefined;

  let postalCode: string | undefined;
  let region: string | undefined;
  if (parts.length > 2 && POSTAL_PART.test(parts[parts.length - 1]))
    postalCode = parts.pop()!;
  if (!postalCode && parts.length > 2) {
    const both = regionWithPostal(parts[parts.length - 1], country);
    if (both) {
      parts.pop();
      ({ region, postalCode } = both);
    }
  }
  if (!region && parts.length > 2 && isRegion(parts[parts.length - 1], country))
    region = parts.pop()!;

  let cityPart = parts[parts.length - 1];
  if (!postalCode) {
    const pc = /\b(\d{4,6})\b/.exec(cityPart);
    if (pc) {
      postalCode = pc[1];
      cityPart = cityPart.replace(pc[0], '').trim();
    }
  }
  if (!cityPart || /\d/.test(cityPart)) return undefined;
  const cityCountry = toIso3(cityPart);
  if (
    cityCountry &&
    (cityCountry !== country ||
      !countryText ||
      !sameText(cityPart, countryText))
  )
    return undefined;
  return {
    street: parts.slice(0, -1).join(', '),
    city: cityPart,
    ...(region ? { province: region } : {}),
    postalCode,
    country,
    ...(countryText ? { countryText } : {}),
  };
}

/**
 * A Canadian postal code as IRCC accepts it: "A1A 1A1", upper case with one
 * space (live 2026-10-19: "M5H1A1" is rejected by tr-rt). Anything that is
 * not a Canadian postal code is undefined, never guessed.
 */
export function canadianPostalCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = /^([A-Za-z]\d[A-Za-z])[\s-]*(\d[A-Za-z]\d)$/.exec(raw.trim());
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : undefined;
}

/**
 * A Canadian address ("123 Main St, Apt 4, Toronto, ON M5V 2T6[, Canada]",
 * also "…, Toronto, Ontario, M5V2T6" with the province and postal code apart,
 * or an address object). Needs a civic number, a city, a province and a
 * postal code; otherwise it is not split and the inviter's address is left
 * for the applicant.
 */
export function parseCanadianAddress(line: unknown): Address | undefined {
  if (line && typeof line === 'object' && !Array.isArray(line))
    return canadianObject(line as Profile);
  if (typeof line !== 'string' || !line.trim()) return undefined;
  let parts = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length && toIso3(parts[parts.length - 1]) === 'CAN')
    parts = parts.slice(0, -1);
  if (parts.length < 3) return undefined;
  let last = parts[parts.length - 1];
  // "Ontario, M5V 2T6": the postal code on its own after the province.
  if (parts.length >= 4 && canadianPostalCode(last)) {
    parts = [...parts.slice(0, -2), `${parts[parts.length - 2]} ${last}`];
    last = parts[parts.length - 1];
  }
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

/** An address object in Canada, complete enough for IRCC's manual entry. */
function canadianObject(o: Profile): Address | undefined {
  const a = addressObject(o);
  if (!a || (a.country && a.country !== 'CAN')) return undefined;
  let num = a.streetNumber;
  let name = a.streetName;
  if (!num || !name) {
    const m = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(a.street ?? '');
    if (m) [num, name] = [m[1], m[2]];
  }
  const prov = a.province ? province(a.province) : undefined;
  const postalCode = canadianPostalCode(a.postalCode);
  if (!num || !name || !a.city || /\d/.test(a.city) || !prov || !postalCode)
    return undefined;
  return {
    streetNumber: num,
    streetName: name,
    apartment: a.apartment,
    city: a.city,
    province: prov,
    postalCode,
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
    province: pickText(
      p,
      'residential_address_province',
      'residential_province',
      'residential_province_state',
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
      'current_country_of_residence',
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
    const line = parseAddressLine(p[k], flat.country);
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
 * follow-up is then the applicant's to complete). With only a home address
 * and no answer, the home address is entered but "same" is not assumed
 * (audit 2026-10-19: "Yes" was written for applicants never asked).
 */
export function contactAddress(
  p: Profile,
): { address: Address; same?: 'Yes' | 'No' } | undefined {
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
  return explicit ? { address: home, same: explicit } : { address: home };
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
