/**
 * Country names and ISO 3166-1 alpha-2 codes → alpha-3, for every country the
 * IRCC code table (ircc-country-codes.ts) knows, plus Hong Kong and Macao
 * (which IRCC lists as SARs, apart from China).
 *
 * Profiles do not agree on how a country is written: the passport MRZ gives
 * "PAK", the intake interview "Pakistan", a birth place "Rawalpindi, Pakistan",
 * an older extraction "PK". The IRCC selects want IRCC's own numeric code, and
 * the only way there is through alpha-3. A spelling not listed here resolves to
 * nothing, and nothing is written — the field is left for the applicant.
 */
const ROWS: ReadonlyArray<readonly [string, string, ...string[]]> = [
  ['AFG', 'AF', 'Afghanistan'],
  ['ALB', 'AL', 'Albania'],
  ['DZA', 'DZ', 'Algeria'],
  ['AND', 'AD', 'Andorra'],
  ['AGO', 'AO', 'Angola'],
  ['ANG', 'AI', 'Anguilla'],
  ['ATG', 'AG', 'Antigua and Barbuda', 'Antigua'],
  ['ARG', 'AR', 'Argentina'],
  ['ARM', 'AM', 'Armenia'],
  ['AUS', 'AU', 'Australia'],
  ['AUT', 'AT', 'Austria'],
  ['AZE', 'AZ', 'Azerbaijan'],
  ['BHS', 'BS', 'Bahamas', 'The Bahamas'],
  ['BHR', 'BH', 'Bahrain'],
  ['BGD', 'BD', 'Bangladesh'],
  ['BRB', 'BB', 'Barbados'],
  ['BLR', 'BY', 'Belarus'],
  ['BEL', 'BE', 'Belgium'],
  ['BLZ', 'BZ', 'Belize'],
  ['BEN', 'BJ', 'Benin'],
  ['BMU', 'BM', 'Bermuda'],
  ['BTN', 'BT', 'Bhutan'],
  ['BOL', 'BO', 'Bolivia'],
  ['BIH', 'BA', 'Bosnia and Herzegovina', 'Bosnia'],
  ['BWA', 'BW', 'Botswana'],
  ['BRA', 'BR', 'Brazil'],
  ['VGB', 'VG', 'British Virgin Islands'],
  ['BRN', 'BN', 'Brunei', 'Brunei Darussalam'],
  ['BGR', 'BG', 'Bulgaria'],
  ['BFA', 'BF', 'Burkina Faso'],
  ['MMR', 'MM', 'Myanmar', 'Burma'],
  ['BDI', 'BI', 'Burundi'],
  ['CPV', 'CV', 'Cabo Verde', 'Cape Verde'],
  ['KHM', 'KH', 'Cambodia'],
  ['CMR', 'CM', 'Cameroon'],
  ['CAN', 'CA', 'Canada'],
  ['CYM', 'KY', 'Cayman Islands'],
  ['CAF', 'CF', 'Central African Republic'],
  ['TCD', 'TD', 'Chad'],
  ['CHL', 'CL', 'Chile'],
  ['CHN', 'CN', 'China', "People's Republic of China"],
  ['COL', 'CO', 'Colombia'],
  ['COM', 'KM', 'Comoros'],
  ['CRI', 'CR', 'Costa Rica'],
  ['HRV', 'HR', 'Croatia'],
  ['CUB', 'CU', 'Cuba'],
  ['CYP', 'CY', 'Cyprus'],
  ['CZE', 'CZ', 'Czechia', 'Czech Republic'],
  [
    'COD',
    'CD',
    'Democratic Republic of the Congo',
    'DR Congo',
    'Congo (Kinshasa)',
  ],
  ['DNK', 'DK', 'Denmark'],
  ['DJI', 'DJ', 'Djibouti'],
  ['DMA', 'DM', 'Dominica'],
  ['DOM', 'DO', 'Dominican Republic'],
  ['TLS', 'TL', 'Timor-Leste', 'East Timor'],
  ['ECU', 'EC', 'Ecuador'],
  ['EGY', 'EG', 'Egypt'],
  ['SLV', 'SV', 'El Salvador'],
  ['GNQ', 'GQ', 'Equatorial Guinea'],
  ['ERI', 'ER', 'Eritrea'],
  ['EST', 'EE', 'Estonia'],
  ['ETH', 'ET', 'Ethiopia'],
  ['FSM', 'FM', 'Micronesia'],
  ['FJI', 'FJ', 'Fiji'],
  ['FIN', 'FI', 'Finland'],
  ['FRA', 'FR', 'France'],
  ['GAB', 'GA', 'Gabon'],
  ['GMB', 'GM', 'Gambia', 'The Gambia'],
  ['GEO', 'GE', 'Georgia'],
  ['DEU', 'DE', 'Germany'],
  ['GHA', 'GH', 'Ghana'],
  ['GRC', 'GR', 'Greece'],
  ['GRD', 'GD', 'Grenada'],
  ['GTM', 'GT', 'Guatemala'],
  ['GIN', 'GN', 'Guinea'],
  ['GNB', 'GW', 'Guinea-Bissau'],
  ['GUY', 'GY', 'Guyana'],
  ['HTI', 'HT', 'Haiti'],
  ['HND', 'HN', 'Honduras'],
  [
    'HKG',
    'HK',
    'Hong Kong',
    'Hong Kong SAR',
    'Hong Kong (SAR)',
    'Hong Kong SAR China',
    'Hong Kong China',
    'Hong Kong Special Administrative Region',
    'Hongkong',
  ],
  ['HUN', 'HU', 'Hungary'],
  ['ISL', 'IS', 'Iceland'],
  ['IND', 'IN', 'India'],
  ['IDN', 'ID', 'Indonesia'],
  ['IRN', 'IR', 'Iran'],
  ['IRQ', 'IQ', 'Iraq'],
  ['IRL', 'IE', 'Ireland'],
  ['ISR', 'IL', 'Israel'],
  ['ITA', 'IT', 'Italy'],
  ['CIV', 'CI', "Cote d'Ivoire", 'Ivory Coast'],
  ['JAM', 'JM', 'Jamaica'],
  ['JPN', 'JP', 'Japan'],
  ['JOR', 'JO', 'Jordan'],
  ['KAZ', 'KZ', 'Kazakhstan'],
  ['KEN', 'KE', 'Kenya'],
  ['KIR', 'KI', 'Kiribati'],
  ['PRK', 'KP', 'North Korea'],
  ['KOR', 'KR', 'South Korea', 'Korea', 'Republic of Korea'],
  ['RKS', 'XK', 'Kosovo'],
  ['KWT', 'KW', 'Kuwait'],
  ['KGZ', 'KG', 'Kyrgyzstan'],
  ['LAO', 'LA', 'Laos'],
  ['LVA', 'LV', 'Latvia'],
  ['LBN', 'LB', 'Lebanon'],
  ['LSO', 'LS', 'Lesotho'],
  ['LBR', 'LR', 'Liberia'],
  ['LBY', 'LY', 'Libya'],
  ['LIE', 'LI', 'Liechtenstein'],
  ['LTU', 'LT', 'Lithuania'],
  ['LUX', 'LU', 'Luxembourg'],
  [
    'MAC',
    'MO',
    'Macao',
    'Macau',
    'Macao SAR',
    'Macau SAR',
    'Macao (SAR)',
    'Macau (SAR)',
    'Macao SAR China',
    'Macao Special Administrative Region',
  ],
  ['MKD', 'MK', 'North Macedonia', 'Macedonia'],
  ['MDG', 'MG', 'Madagascar'],
  ['MWI', 'MW', 'Malawi'],
  ['MYS', 'MY', 'Malaysia'],
  ['MDV', 'MV', 'Maldives'],
  ['MLI', 'ML', 'Mali'],
  ['MLT', 'MT', 'Malta'],
  ['MHL', 'MH', 'Marshall Islands'],
  ['MRT', 'MR', 'Mauritania'],
  ['MUS', 'MU', 'Mauritius'],
  ['MEX', 'MX', 'Mexico'],
  ['MDA', 'MD', 'Moldova'],
  ['MCO', 'MC', 'Monaco'],
  ['MNG', 'MN', 'Mongolia'],
  ['MNE', 'ME', 'Montenegro'],
  ['MSR', 'MS', 'Montserrat'],
  ['MAR', 'MA', 'Morocco'],
  ['MOZ', 'MZ', 'Mozambique'],
  ['NAM', 'NA', 'Namibia'],
  ['NRU', 'NR', 'Nauru'],
  ['NPL', 'NP', 'Nepal'],
  ['NLD', 'NL', 'Netherlands', 'The Netherlands', 'Holland'],
  ['NZL', 'NZ', 'New Zealand'],
  ['NIC', 'NI', 'Nicaragua'],
  ['NER', 'NE', 'Niger'],
  ['NGA', 'NG', 'Nigeria'],
  ['NOR', 'NO', 'Norway'],
  ['OMN', 'OM', 'Oman'],
  ['PAK', 'PK', 'Pakistan'],
  ['PSE', 'PS', 'Palestine'],
  ['PAN', 'PA', 'Panama'],
  ['PNG', 'PG', 'Papua New Guinea'],
  ['PRY', 'PY', 'Paraguay'],
  ['PER', 'PE', 'Peru'],
  ['PHL', 'PH', 'Philippines'],
  ['POL', 'PL', 'Poland'],
  ['PRT', 'PT', 'Portugal'],
  ['QAT', 'QA', 'Qatar'],
  ['COG', 'CG', 'Republic of the Congo', 'Congo (Brazzaville)', 'Congo'],
  ['PLW', 'PW', 'Palau'],
  ['ROU', 'RO', 'Romania'],
  ['RUS', 'RU', 'Russia', 'Russian Federation'],
  ['RWA', 'RW', 'Rwanda'],
  ['SHN', 'SH', 'Saint Helena'],
  ['KNA', 'KN', 'Saint Kitts and Nevis'],
  ['LCA', 'LC', 'Saint Lucia'],
  ['WSM', 'WS', 'Samoa'],
  ['SMR', 'SM', 'San Marino'],
  ['STP', 'ST', 'Sao Tome and Principe'],
  ['SAU', 'SA', 'Saudi Arabia'],
  ['SEN', 'SN', 'Senegal'],
  ['SRB', 'RS', 'Serbia'],
  ['SYC', 'SC', 'Seychelles'],
  ['SLE', 'SL', 'Sierra Leone'],
  ['SGP', 'SG', 'Singapore'],
  ['SVK', 'SK', 'Slovakia'],
  ['SVN', 'SI', 'Slovenia'],
  ['SLB', 'SB', 'Solomon Islands'],
  ['SOM', 'SO', 'Somalia'],
  ['ZAF', 'ZA', 'South Africa'],
  ['SSD', 'SS', 'South Sudan'],
  ['ESP', 'ES', 'Spain'],
  ['LKA', 'LK', 'Sri Lanka'],
  ['VCT', 'VC', 'Saint Vincent and the Grenadines'],
  ['SDN', 'SD', 'Sudan'],
  ['SUR', 'SR', 'Suriname'],
  ['SWZ', 'SZ', 'Eswatini', 'Swaziland'],
  ['SWE', 'SE', 'Sweden'],
  ['CHE', 'CH', 'Switzerland'],
  ['SYR', 'SY', 'Syria'],
  ['TWN', 'TW', 'Taiwan'],
  ['TJK', 'TJ', 'Tajikistan'],
  ['TZA', 'TZ', 'Tanzania'],
  ['THA', 'TH', 'Thailand'],
  ['TGO', 'TG', 'Togo'],
  ['TON', 'TO', 'Tonga'],
  ['TTO', 'TT', 'Trinidad and Tobago'],
  ['TUN', 'TN', 'Tunisia'],
  ['TUR', 'TR', 'Turkey', 'Turkiye', 'Türkiye'],
  ['TKM', 'TM', 'Turkmenistan'],
  ['TCA', 'TC', 'Turks and Caicos Islands'],
  ['TUV', 'TV', 'Tuvalu'],
  ['UGA', 'UG', 'Uganda'],
  [
    'GBR',
    'GB',
    'United Kingdom',
    'UK',
    'Great Britain',
    'Britain',
    'England',
    'Scotland',
    'Wales',
    'Northern Ireland',
  ],
  ['UKR', 'UA', 'Ukraine'],
  ['ARE', 'AE', 'United Arab Emirates', 'UAE'],
  [
    'USA',
    'US',
    'United States',
    'United States of America',
    'USA',
    'U.S.',
    'U.S.A.',
  ],
  ['URY', 'UY', 'Uruguay'],
  ['UZB', 'UZ', 'Uzbekistan'],
  ['VUT', 'VU', 'Vanuatu'],
  ['VAT', 'VA', 'Vatican City', 'Holy See'],
  ['VEN', 'VE', 'Venezuela'],
  ['VNM', 'VN', 'Vietnam', 'Viet Nam'],
  ['YEM', 'YE', 'Yemen'],
  ['ZMB', 'ZM', 'Zambia'],
  ['ZWE', 'ZW', 'Zimbabwe'],
];

function key(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ISO3 = new Set(ROWS.map((r) => r[0]));
const BY_ISO2 = new Map(ROWS.map((r) => [r[1], r[0]]));
const BY_NAME = new Map<string, string>();
for (const [iso3, , ...names] of ROWS) {
  for (const n of names) BY_NAME.set(key(n), iso3);
}

/**
 * Formal and printed names that are not the short name: ISO 3166 formal names
 * no rule below can derive, passport prints and abbreviations. Several are
 * listed precisely because a rule would get them WRONG: "Republic of China"
 * is Taiwan, not China; "Democratic Republic of Congo" is not the Republic of
 * the Congo.
 */
const FORMAL_NAMES: ReadonlyArray<readonly [string, ...string[]]> = [
  [
    'TWN',
    'Republic of China',
    'Republic of China (Taiwan)',
    'ROC',
    'Taiwan, Province of China',
    'Taiwan Province of China',
    'Chinese Taipei',
  ],
  [
    'CHN',
    'P.R. China',
    'PR China',
    'PRC',
    'P.R.C.',
    'Mainland China',
    'China, Peoples Republic of',
  ],
  [
    'COD',
    'Democratic Republic of Congo',
    'DRC',
    'D.R. Congo',
    'Congo-Kinshasa',
    'Congo, The Democratic Republic of the',
    'Congo, Democratic Republic of the',
    'Congo, Democratic Republic of',
    'Zaire',
  ],
  [
    'COG',
    'Republic of Congo',
    'Congo-Brazzaville',
    'Congo, Republic of the',
    'Congo, Republic of',
  ],
  [
    'PRK',
    "Democratic People's Republic of Korea",
    "Korea, Democratic People's Republic of",
    'DPRK',
    'Korea (North)',
    'Korea, North',
  ],
  ['KOR', 'Korea, Republic of', 'Korea (South)', 'Korea, South', 'ROK'],
  ['ARE', 'U.A.E.', 'U.A.E'],
  ['GBR', 'U.K.', 'United Kingdom of Great Britain and Northern Ireland'],
  ['SYR', 'Syrian Arab Republic'],
  ['LAO', "Lao People's Democratic Republic", 'Lao PDR', 'Lao'],
  ['LBY', 'Libyan Arab Jamahiriya'],
  ['MEX', 'United Mexican States'],
  ['ARG', 'Argentine Republic'],
  ['GRC', 'Hellenic Republic'],
  ['SVK', 'Slovak Republic'],
  ['KGZ', 'Kyrgyz Republic'],
  ['CHE', 'Swiss Confederation'],
  ['PSE', 'Palestinian Territories', 'Occupied Palestinian Territory'],
  ['IRL', 'Eire'],
  ['DEU', 'Deutschland'],
  ['ESP', 'Espana'],
  ['VAT', 'Vatican'],
];

/**
 * ICAO 9303 nationality codes that are not ISO 3166 alpha-3 (Doc 9303 part 3).
 * Germany prints "D" (padded "D<<" in the MRZ); the UK's non-citizen classes
 * print GBD / GBN / GBO / GBS / GBP, which are United Kingdom passports and
 * resolve to GBR here. The IRCC writers must NOT treat those as "British
 * citizen" — see mrzNationalityVariant(). Kosovo prints XKX.
 */
const MRZ_CODES: Readonly<Record<string, string>> = {
  D: 'DEU',
  GBD: 'GBR',
  GBN: 'GBR',
  GBO: 'GBR',
  GBS: 'GBR',
  GBP: 'GBR',
  XKX: 'RKS',
};

/**
 * Not countries, but nationalities a passport records: stateless persons and
 * refugees print XXA / XXB / XXC. toIso3 returns these codes as they are.
 */
const NON_STATE: ReadonlyArray<readonly [string, ...string[]]> = [
  ['XXA', 'Stateless', 'Stateless person'],
  ['XXB', 'Refugee (1951 Convention)'],
  ['XXC', 'Refugee (other)'],
];

/**
 * Nationality adjectives the interview records ("applicant_citizenship":
 * "Pakistani", dry run 2026-10-16). Only unambiguous ones: "Congolese"
 * (COD / COG) and "Dominican" (DOM / DMA) are deliberately absent and resolve
 * to nothing, as an unknown country name does. "Korean" is South Korea.
 */
const DEMONYMS: ReadonlyArray<readonly [string, ...string[]]> = [
  ['AFG', 'Afghan', 'Afghani'],
  ['ALB', 'Albanian'],
  ['DZA', 'Algerian'],
  ['AND', 'Andorran'],
  ['AGO', 'Angolan'],
  ['ARG', 'Argentine', 'Argentinian', 'Argentinean'],
  ['ARM', 'Armenian'],
  ['AUS', 'Australian'],
  ['AUT', 'Austrian'],
  ['AZE', 'Azerbaijani', 'Azeri'],
  ['BHS', 'Bahamian'],
  ['BHR', 'Bahraini'],
  ['BGD', 'Bangladeshi'],
  ['BRB', 'Barbadian', 'Bajan'],
  ['BLR', 'Belarusian'],
  ['BEL', 'Belgian'],
  ['BLZ', 'Belizean'],
  ['BEN', 'Beninese'],
  ['BTN', 'Bhutanese'],
  ['BOL', 'Bolivian'],
  ['BIH', 'Bosnian'],
  ['BWA', 'Motswana', 'Batswana'],
  ['BRA', 'Brazilian'],
  ['BRN', 'Bruneian'],
  ['BGR', 'Bulgarian'],
  ['BFA', 'Burkinabe'],
  ['MMR', 'Burmese'],
  ['BDI', 'Burundian'],
  ['CPV', 'Cape Verdean', 'Cabo Verdean'],
  ['KHM', 'Cambodian'],
  ['CMR', 'Cameroonian'],
  ['CAN', 'Canadian'],
  ['CAF', 'Central African'],
  ['TCD', 'Chadian'],
  ['CHL', 'Chilean'],
  ['CHN', 'Chinese'],
  ['COL', 'Colombian'],
  ['CRI', 'Costa Rican'],
  ['HRV', 'Croatian'],
  ['CUB', 'Cuban'],
  ['CYP', 'Cypriot'],
  ['CZE', 'Czech'],
  ['DNK', 'Danish'],
  ['DJI', 'Djiboutian'],
  ['ECU', 'Ecuadorian', 'Ecuadorean'],
  ['EGY', 'Egyptian'],
  ['SLV', 'Salvadoran', 'Salvadorian'],
  ['ERI', 'Eritrean'],
  ['EST', 'Estonian'],
  ['SWZ', 'Swazi'],
  ['ETH', 'Ethiopian'],
  ['FJI', 'Fijian'],
  ['FIN', 'Finnish'],
  ['FRA', 'French'],
  ['GAB', 'Gabonese'],
  ['GMB', 'Gambian'],
  ['GEO', 'Georgian'],
  ['DEU', 'German'],
  ['GHA', 'Ghanaian'],
  ['GRC', 'Greek'],
  ['GRD', 'Grenadian'],
  ['GTM', 'Guatemalan'],
  ['GIN', 'Guinean'],
  ['GUY', 'Guyanese'],
  ['HTI', 'Haitian'],
  ['HND', 'Honduran'],
  ['HKG', 'Hong Konger', 'Hongkonger'],
  ['HUN', 'Hungarian'],
  ['ISL', 'Icelandic'],
  ['IND', 'Indian'],
  ['IDN', 'Indonesian'],
  ['IRN', 'Iranian'],
  ['IRQ', 'Iraqi'],
  ['IRL', 'Irish'],
  ['ISR', 'Israeli'],
  ['ITA', 'Italian'],
  ['CIV', 'Ivorian'],
  ['JAM', 'Jamaican'],
  ['JPN', 'Japanese'],
  ['JOR', 'Jordanian'],
  ['KAZ', 'Kazakh', 'Kazakhstani'],
  ['KEN', 'Kenyan'],
  ['KOR', 'Korean', 'South Korean'],
  ['PRK', 'North Korean'],
  ['RKS', 'Kosovar', 'Kosovan'],
  ['KWT', 'Kuwaiti'],
  ['KGZ', 'Kyrgyz', 'Kyrgyzstani'],
  ['LAO', 'Laotian'],
  ['LVA', 'Latvian'],
  ['LBN', 'Lebanese'],
  ['LSO', 'Basotho', 'Mosotho'],
  ['LBR', 'Liberian'],
  ['LBY', 'Libyan'],
  ['LTU', 'Lithuanian'],
  ['LUX', 'Luxembourgish', 'Luxembourger'],
  ['MAC', 'Macanese'],
  ['MKD', 'Macedonian', 'North Macedonian'],
  ['MDG', 'Malagasy'],
  ['MWI', 'Malawian'],
  ['MYS', 'Malaysian'],
  ['MDV', 'Maldivian'],
  ['MLI', 'Malian'],
  ['MLT', 'Maltese'],
  ['MRT', 'Mauritanian'],
  ['MUS', 'Mauritian'],
  ['MEX', 'Mexican'],
  ['MDA', 'Moldovan'],
  ['MCO', 'Monegasque'],
  ['MNG', 'Mongolian'],
  ['MNE', 'Montenegrin'],
  ['MAR', 'Moroccan'],
  ['MOZ', 'Mozambican'],
  ['NAM', 'Namibian'],
  ['NPL', 'Nepali', 'Nepalese'],
  ['NLD', 'Dutch'],
  ['NZL', 'New Zealander'],
  ['NIC', 'Nicaraguan'],
  ['NER', 'Nigerien'],
  ['NGA', 'Nigerian'],
  ['NOR', 'Norwegian'],
  ['OMN', 'Omani'],
  ['PAK', 'Pakistani'],
  ['PSE', 'Palestinian'],
  ['PAN', 'Panamanian'],
  ['PNG', 'Papua New Guinean'],
  ['PRY', 'Paraguayan'],
  ['PER', 'Peruvian'],
  ['PHL', 'Filipino', 'Filipina', 'Philippine'],
  ['POL', 'Polish'],
  ['PRT', 'Portuguese'],
  ['QAT', 'Qatari'],
  ['ROU', 'Romanian'],
  ['RUS', 'Russian'],
  ['RWA', 'Rwandan'],
  ['LCA', 'Saint Lucian'],
  ['WSM', 'Samoan'],
  ['SAU', 'Saudi', 'Saudi Arabian'],
  ['SEN', 'Senegalese'],
  ['SRB', 'Serbian'],
  ['SYC', 'Seychellois'],
  ['SLE', 'Sierra Leonean'],
  ['SGP', 'Singaporean'],
  ['SVK', 'Slovak', 'Slovakian'],
  ['SVN', 'Slovenian', 'Slovene'],
  ['SOM', 'Somali'],
  ['ZAF', 'South African'],
  ['SSD', 'South Sudanese'],
  ['ESP', 'Spanish'],
  ['LKA', 'Sri Lankan'],
  ['SDN', 'Sudanese'],
  ['SUR', 'Surinamese'],
  ['SWE', 'Swedish'],
  ['CHE', 'Swiss'],
  ['SYR', 'Syrian'],
  ['TWN', 'Taiwanese'],
  ['TJK', 'Tajik', 'Tajikistani'],
  ['TZA', 'Tanzanian'],
  ['THA', 'Thai'],
  ['TLS', 'Timorese', 'East Timorese'],
  ['TGO', 'Togolese'],
  ['TON', 'Tongan'],
  ['TTO', 'Trinidadian', 'Trinidadian and Tobagonian'],
  ['TUN', 'Tunisian'],
  ['TUR', 'Turkish'],
  ['TKM', 'Turkmen'],
  ['UGA', 'Ugandan'],
  ['UKR', 'Ukrainian'],
  ['ARE', 'Emirati'],
  ['GBR', 'British', 'British citizen'],
  ['USA', 'American'],
  ['URY', 'Uruguayan'],
  ['UZB', 'Uzbek', 'Uzbekistani'],
  ['VUT', 'Ni-Vanuatu'],
  ['VEN', 'Venezuelan'],
  ['VNM', 'Vietnamese'],
  ['YEM', 'Yemeni'],
  ['ZMB', 'Zambian'],
  ['ZWE', 'Zimbabwean'],
];

for (const [iso3, ...names] of [...FORMAL_NAMES, ...NON_STATE]) {
  for (const n of names) if (!BY_NAME.has(key(n))) BY_NAME.set(key(n), iso3);
}
for (const [iso3, ...names] of DEMONYMS) {
  if (!ISO3.has(iso3)) continue;
  for (const n of names) if (!BY_NAME.has(key(n))) BY_NAME.set(key(n), iso3);
}

const NON_STATE_CODES = new Set(NON_STATE.map((r) => r[0]));

/**
 * Words a formal state name puts before the short name ("Islamic Republic of
 * Iran", "Kingdom of Saudi Arabia", "Federal Republic of Nigeria"), as key()
 * spells them. Taken off one at a time from the front, longest first, only
 * after the whole name failed to match. "United" alone is never one ("United
 * States", "United Kingdom"): only "United Republic of".
 */
const STATE_PREFIXES = [
  'united republic of',
  'federated states of',
  'independent state of',
  'commonwealth of',
  'principality of',
  'grand duchy of',
  'sultanate of',
  'kingdom of',
  'republic of',
  'state of',
  'union of',
  'plurinational',
  'bolivarian',
  'democratic',
  'federative',
  'socialist',
  'hashemite',
  'oriental',
  'islamic',
  'federal',
  'people s',
  'peoples',
  'arab',
  'the',
].sort((a, b) => b.length - a.length);

/**
 * Short names a stripped formal name may NOT land on: each is the short form
 * of two states (North / South Korea, the two Congos, the PRC and the ROC),
 * and which one is told by exactly the words stripping removes. Their formal
 * names are listed whole in ROWS / FORMAL_NAMES instead.
 */
const AMBIGUOUS_SHORT = new Set(['korea', 'congo', 'china']);

/** "citizen of Pakistan", "Pakistani national", "Canadian citizen" → the name. */
function withoutCitizenWords(k: string): string {
  return k
    .replace(/^(?:citizen|national) of (?:the )?/, '')
    .replace(/ (?:citizen|national|nationality|citizenship)$/, '')
    .trim();
}

function byFormalName(k: string): string | null {
  let rest = k;
  let stripped = false;
  for (;;) {
    const hit = BY_NAME.get(rest);
    if (hit) return stripped && AMBIGUOUS_SHORT.has(rest) ? null : hit;
    const prefix = STATE_PREFIXES.find((p) => rest.startsWith(`${p} `));
    if (!prefix) return null;
    rest = rest.slice(prefix.length + 1).trim();
    stripped = true;
  }
}

function byName(raw: string): string | null {
  const direct = BY_NAME.get(key(raw));
  if (direct) return direct;
  // "Korea, Republic of" / "Bolivia (Plurinational State of)": the ISO list
  // puts the qualifier after the name. Read it the way it is said ("Republic
  // of Korea") and look that up, so "Congo (Democratic Republic of the)" is
  // the DRC and never the Congo the bare name would give.
  const inverted =
    /^([^,()]+),\s*([^,()]+)$/.exec(raw) ??
    /^([^,()]+)\(([^()]+)\)\s*$/.exec(raw);
  const keys = inverted
    ? [key(`${inverted[2]} ${inverted[1]}`), key(raw)]
    : [key(raw)];
  for (const k of keys) {
    for (const c of new Set([k, withoutCitizenWords(k)])) {
      if (!c) continue;
      const iso = byFormalName(c);
      if (iso) return iso;
    }
  }
  return null;
}

/**
 * Country name / ISO-2 / ISO-3 / MRZ code / nationality → ISO-3, or null when
 * the spelling is unknown. The MRZ's "<" fillers are ignored ("D<<" is
 * Germany). Besides ISO-3 this can return XXA / XXB / XXC (stateless,
 * refugee), which are nationalities but not countries.
 */
export function toIso3(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (
    /^[A-Z]{3}$/.test(upper) &&
    (ISO3.has(upper) || NON_STATE_CODES.has(upper))
  )
    return upper;
  // A lone "d" is not Germany; the MRZ prints it upper-case.
  if (MRZ_CODES[upper] && (upper.length === 3 || raw === upper))
    return MRZ_CODES[upper];
  if (/^[A-Z]{2}$/.test(upper) && BY_ISO2.has(upper))
    return BY_ISO2.get(upper)!;
  return byName(raw);
}

/**
 * The ICAO code of a United Kingdom passport that is NOT a British citizen's
 * (GBD, GBN, GBO, GBS, GBP), or null. toIso3 resolves these to GBR — the
 * country is right — but a nationality list tells them apart, and writing
 * "British citizen" for a BN(O) holder would be wrong data.
 */
export function mrzNationalityVariant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.replace(/</g, '').trim().toUpperCase();
  return /^GB[DNOSP]$/.test(v) ? v : null;
}

/** English display name for an ISO-3 code from this table (first name listed). */
export function countryName(iso3: string): string | null {
  const row = ROWS.find((r) => r[0] === iso3);
  if (row) return row[2];
  const other = NON_STATE.find((r) => r[0] === iso3);
  return other ? other[1] : null;
}
