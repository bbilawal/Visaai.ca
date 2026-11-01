/**
 * Canada's electronic travel authorization (eTA): who can hold one.
 *
 * WHY THIS EXISTS
 *
 * Dry run 2026-10-16 (app a37a534b, Pakistani applicant): intake correctly
 * said a Pakistani needs a visitor visa (TRV), and the applicant could still
 * pick "Electronic travel authorization (eTA)" with no warning. The registry
 * row `eta_required_country_air_travel` carried no rule because the two
 * nationality lists had never been read, so nothing could tell an applicant
 * which side of the line they fall on.
 *
 * The lists below are IRCC's own, read 2026-10-16 from
 * https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/entry-requirements-country.html
 * (page dated 2026-07-31) and the conditional ("CAN+") branch from
 * https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility/eta-x.html
 *
 * Shared by the API (eligibility, intake questions) and the web app, so it is
 * pure and dependency-free. Codes are ISO 3166-1 alpha-2.
 */

/** Registry visa type (`visa_types.visaai_id`) for Canada's eTA. */
export const CA_ETA_VISAAI_ID = 'ca-electronic-travel-authorization-eta'

/**
 * Visa-exempt: citizens need an eTA to FLY to Canada, and nothing else.
 *
 * Qualifiers IRCC attaches, recorded rather than encoded (VisaAI does not yet
 * collect the passport sub-type that decides them): Israel — national Israeli
 * passport; Taiwan — ordinary passport with the personal identification
 * number; Hong Kong SAR — HKSAR passport (BN(O) is listed separately as a
 * British category); Romania — electronic passport only; Vatican — passport or
 * travel document issued by the Vatican. The British categories (citizen,
 * national overseas, overseas citizen re-admissible to the UK, subject with
 * right of abode) all travel on a UK passport, hence GB; British overseas
 * territory citizens are listed under their territory.
 */
export const CA_ETA_VISA_EXEMPT: readonly string[] = [
  'AD', // Andorra
  'AU', // Australia
  'AT', // Austria
  'BS', // Bahamas
  'BB', // Barbados
  'BE', // Belgium
  'GB', // British citizen / BN(O) / British overseas citizen / British subject with right of abode
  'AI', // Anguilla (British overseas territory citizen)
  'BM', // Bermuda
  'VG', // British Virgin Islands
  'KY', // Cayman Islands
  'FK', // Falkland Islands (Malvinas)
  'GI', // Gibraltar
  'MS', // Montserrat
  'PN', // Pitcairn Island
  'SH', // Saint Helena
  'TC', // Turks and Caicos Islands
  'BN', // Brunei Darussalam
  'BG', // Bulgaria
  'CL', // Chile
  'HR', // Croatia
  'CY', // Cyprus
  'CZ', // Czech Republic
  'DK', // Denmark
  'EE', // Estonia
  'FI', // Finland
  'FR', // France
  'DE', // Germany
  'GR', // Greece
  'HK', // Hong Kong SAR
  'HU', // Hungary
  'IS', // Iceland
  'IE', // Ireland
  'IL', // Israel
  'IT', // Italy
  'JP', // Japan
  'LV', // Latvia
  'LI', // Liechtenstein
  'LT', // Lithuania
  'LU', // Luxembourg
  'MT', // Malta
  'MC', // Monaco
  'NL', // Netherlands
  'NZ', // New Zealand
  'NO', // Norway
  'PG', // Papua New Guinea
  'PL', // Poland
  'PT', // Portugal
  'QA', // Qatar
  'KR', // Republic of Korea
  'RO', // Romania
  'WS', // Samoa
  'SM', // San Marino
  'SG', // Singapore
  'SK', // Slovakia
  'SI', // Slovenia
  'SB', // Solomon Islands
  'ES', // Spain
  'SE', // Sweden
  'CH', // Switzerland
  'TW', // Taiwan
  'AE', // United Arab Emirates
  'VA', // Vatican City State
]

/**
 * Visa-required countries whose citizens may apply for an eTA INSTEAD of a
 * visitor visa — only when flying, and only if they held a Canadian visitor
 * visa in the past 10 years OR currently hold a valid US non-immigrant visa.
 * By land or sea they still need a visitor visa.
 */
export const CA_ETA_CONDITIONAL: readonly string[] = [
  'AG', // Antigua and Barbuda
  'AR', // Argentina
  'BR', // Brazil
  'CR', // Costa Rica
  'ID', // Indonesia
  'MY', // Malaysia
  'MX', // Mexico
  'MA', // Morocco
  'PA', // Panama
  'PH', // Philippines
  'KN', // St. Kitts and Nevis
  'LC', // St. Lucia
  'VC', // St. Vincent and the Grenadines
  'SC', // Seychelles
  'TH', // Thailand
  'TT', // Trinidad and Tobago
  'UY', // Uruguay
]

/**
 * ICAO 9303 / ISO alpha-3 → alpha-2, for passports read from the MRZ ("PAK",
 * "GBR", "D"). Covers every country in the two lists above plus the codes the
 * applicant base most often carries. An alpha-3 code that is NOT here resolves
 * to nothing — eligibility then says "unknown" rather than guessing.
 */
const ALPHA3: Record<string, string> = {
  AND: 'AD', AUS: 'AU', AUT: 'AT', BHS: 'BS', BRB: 'BB', BEL: 'BE',
  GBR: 'GB', GBD: 'GB', GBN: 'GB', GBO: 'GB', GBS: 'GB', GBP: 'GB',
  AIA: 'AI', BMU: 'BM', VGB: 'VG', CYM: 'KY', FLK: 'FK', GIB: 'GI',
  MSR: 'MS', PCN: 'PN', SHN: 'SH', TCA: 'TC', BRN: 'BN', BGR: 'BG',
  CHL: 'CL', HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK', EST: 'EE',
  FIN: 'FI', FRA: 'FR', DEU: 'DE', D: 'DE', GRC: 'GR', HKG: 'HK',
  HUN: 'HU', ISL: 'IS', IRL: 'IE', ISR: 'IL', ITA: 'IT', JPN: 'JP',
  LVA: 'LV', LIE: 'LI', LTU: 'LT', LUX: 'LU', MLT: 'MT', MCO: 'MC',
  NLD: 'NL', NZL: 'NZ', NOR: 'NO', PNG: 'PG', POL: 'PL', PRT: 'PT',
  QAT: 'QA', KOR: 'KR', ROU: 'RO', WSM: 'WS', SMR: 'SM', SGP: 'SG',
  SVK: 'SK', SVN: 'SI', SLB: 'SB', ESP: 'ES', SWE: 'SE', CHE: 'CH',
  TWN: 'TW', ARE: 'AE', VAT: 'VA',
  ATG: 'AG', ARG: 'AR', BRA: 'BR', CRI: 'CR', IDN: 'ID', MYS: 'MY',
  MEX: 'MX', MAR: 'MA', PAN: 'PA', PHL: 'PH', KNA: 'KN', LCA: 'LC',
  VCT: 'VC', SYC: 'SC', THA: 'TH', TTO: 'TT', URY: 'UY',
  USA: 'US', CAN: 'CA',
  PAK: 'PK', IND: 'IN', BGD: 'BD', NGA: 'NG', CHN: 'CN', IRN: 'IR',
  AFG: 'AF', EGY: 'EG', LKA: 'LK', NPL: 'NP', VNM: 'VN', GHA: 'GH',
  KEN: 'KE', TUR: 'TR', RUS: 'RU', UKR: 'UA', SAU: 'SA', IRQ: 'IQ',
  SYR: 'SY', JOR: 'JO', LBN: 'LB', ETH: 'ET', SOM: 'SO', SDN: 'SD',
  ZWE: 'ZW', CMR: 'CM', SEN: 'SN', COL: 'CO', PER: 'PE', VEN: 'VE',
  HTI: 'HT', JAM: 'JM', CUB: 'CU', DZA: 'DZ', TUN: 'TN', KWT: 'KW',
  OMN: 'OM', BHR: 'BH', UZB: 'UZ', KAZ: 'KZ', AZE: 'AZ', ARM: 'AM',
  GEO: 'GE', BLR: 'BY', SRB: 'RS', ALB: 'AL', MKD: 'MK', BIH: 'BA',
}

/** Demonyms the interview writes ("Pakistani") that are not country names. */
const DEMONYMS: Record<string, string> = {
  pakistani: 'PK', indian: 'IN', bangladeshi: 'BD', nigerian: 'NG',
  chinese: 'CN', filipino: 'PH', filipina: 'PH', american: 'US',
  canadian: 'CA', british: 'GB', iranian: 'IR', mexican: 'MX',
  brazilian: 'BR', afghan: 'AF', egyptian: 'EG', turkish: 'TR',
  'sri lankan': 'LK', nepali: 'NP', nepalese: 'NP', vietnamese: 'VN',
  ghanaian: 'GH', kenyan: 'KE', australian: 'AU', german: 'DE',
  french: 'FR', irish: 'IE', italian: 'IT', spanish: 'ES', japanese: 'JP',
  korean: 'KR', 'south korean': 'KR', argentine: 'AR', argentinian: 'AR',
  indonesian: 'ID', malaysian: 'MY', moroccan: 'MA', thai: 'TH',
  uruguayan: 'UY', 'costa rican': 'CR', panamanian: 'PA', chilean: 'CL',
  israeli: 'IL', emirati: 'AE', taiwanese: 'TW', singaporean: 'SG',
  'new zealander': 'NZ', dutch: 'NL', swiss: 'CH', swedish: 'SE',
  norwegian: 'NO', danish: 'DK', polish: 'PL', portuguese: 'PT',
  greek: 'GR', saudi: 'SA', russian: 'RU', ukrainian: 'UA',
}

const EXTRA_NAMES: Record<string, string> = {
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'great britain': 'GB',
  'south korea': 'KR',
  'republic of korea': 'KR',
  korea: 'KR',
  'hong kong sar': 'HK',
  'hong kong': 'HK',
  'vatican city': 'VA',
  'vatican city state': 'VA',
  'holy see': 'VA',
  'czech republic': 'CZ',
  'st. kitts and nevis': 'KN',
  'st kitts and nevis': 'KN',
  'st. lucia': 'LC',
  'st lucia': 'LC',
  'st. vincent and the grenadines': 'VC',
  'st vincent and the grenadines': 'VC',
  uae: 'AE',
  brunei: 'BN',
}

const RETIRED_REGION_CODES = new Set(['AN','BU','CS','DD','DY','FX','HV','NH','RH','SU','TP','UK','VD','YD','YU','ZR'])

let names: Map<string, string> | null = null
function nameIndex(): Map<string, string> {
  if (names) return names
  names = new Map()
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    const A = 'A'.charCodeAt(0)
    for (let i = 0; i < 26; i += 1) {
      for (let j = 0; j < 26; j += 1) {
        const code = String.fromCharCode(A + i, A + j)
        const name = dn.of(code)
        // ICU also names retired ISO codes (DD -> "Germany", UK -> "United
        // Kingdom", VD -> "Vietnam"...). Skip them so a name maps to the
        // CURRENT code whichever order the loop meets them in.
        if (RETIRED_REGION_CODES.has(code)) continue
        if (name && name !== code && !names.has(name.toLowerCase()))
          names.set(name.toLowerCase(), code)
      }
    }
  } catch {
    // No ICU data: names stay unmapped; codes and the tables still work.
  }
  for (const [k, v] of Object.entries(EXTRA_NAMES)) names.set(k, v)
  return names
}

/**
 * A nationality, however the profile wrote it ("PK", "PAK", "Pakistan",
 * "Pakistani"), as ISO alpha-2 — or null when it cannot be recognised.
 */
export function nationalityCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  const upper = s.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper)) return upper
  if (/^[A-Z]{1,3}$/.test(upper) && ALPHA3[upper]) return ALPHA3[upper]
  const lower = s.toLowerCase()
  return DEMONYMS[lower] ?? nameIndex().get(lower) ?? null
}

/** Profile keys a nationality may be written under, most specific first. */
export const NATIONALITY_KEYS: readonly string[] = [
  'nationality',
  'citizenship',
  'country_of_citizenship',
  'applicant_citizenship',
  'applicant_nationality',
  'nationality_country',
  'passport_country',
  'passport_issuing_country',
  'passport_nationality',
]

/** The applicant's nationality from a profile, as ISO alpha-2, or null. */
export function profileNationality(
  profile: Record<string, unknown> | null | undefined,
): string | null {
  const p = profile ?? {}
  // The PASSPORT decides an eTA, not the citizenship. A dual national who
  // says "I am a Pakistani citizen but I travel on my British passport" is
  // judged on the British passport (review of #134), so passport keys win.
  const passportFirst = [
    ...NATIONALITY_KEYS.filter((k) => k.startsWith('passport_')),
    ...NATIONALITY_KEYS.filter((k) => !k.startsWith('passport_')),
  ]
  for (const k of passportFirst) {
    const code = nationalityCode(p[k])
    if (code) return code
  }
  return null
}

export function isEtaVisaExempt(code: string | null | undefined): boolean {
  return !!code && CA_ETA_VISA_EXEMPT.includes(code.toUpperCase())
}

export function isEtaConditional(code: string | null | undefined): boolean {
  return !!code && CA_ETA_CONDITIONAL.includes(code.toUpperCase())
}
