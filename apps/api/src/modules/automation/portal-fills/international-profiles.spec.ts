/**
 * Applicants from everywhere (audit 2026-10-18): country spellings the IRCC
 * country selects skipped, addresses whose state became the city, places of
 * birth that are a country. Each case was a defect before this file.
 */
import { applyFillTransform } from '../fill-transforms';
import { countryName, mrzNationalityVariant, toIso3 } from './country-names';
import { etaCountryCodeOption, etaNationalityOption } from './eta-options';
import { IRCC_COUNTRY_CODES } from './ircc-country-codes';
import { parseAddressLine, splitPlace } from './ircc-profile';

describe('toIso3 — places IRCC lists apart, and non-states', () => {
  it.each([
    ['HKG', 'HKG'],
    ['Hong Kong (SAR)', 'HKG'],
    ['Hong Kong SAR, China', 'HKG'],
    ['HONG KONG', 'HKG'],
    ['MAC', 'MAC'],
    ['Macau', 'MAC'],
    ['Macao SAR', 'MAC'],
    ['XXA', 'XXA'],
    ['Stateless', 'XXA'],
    ['XXB', 'XXB'],
    ['XXC', 'XXC'],
  ])('%s → %s', (raw, want) => {
    expect(toIso3(raw)).toBe(want);
  });

  it('names the non-states', () => {
    expect(countryName('XXA')).toBe('Stateless');
    expect(countryName('HKG')).toBe('Hong Kong');
  });
});

describe('toIso3 — ICAO MRZ codes', () => {
  it.each([
    ['D', 'DEU'],
    ['D<<', 'DEU'],
    ['GBD', 'GBR'],
    ['GBN', 'GBR'],
    ['GBO', 'GBR'],
    ['GBS', 'GBR'],
    ['GBP', 'GBR'],
    ['XKX', 'RKS'],
    ['PAK', 'PAK'],
  ])('%s → %s', (raw, want) => {
    expect(toIso3(raw)).toBe(want);
  });

  it('a lone lower-case "d" is not Germany', () => {
    expect(toIso3('d')).toBeNull();
  });

  it('flags the UK passports that are not a British citizen’s', () => {
    expect(mrzNationalityVariant('GBN')).toBe('GBN');
    expect(mrzNationalityVariant('GBD<')).toBe('GBD');
    expect(mrzNationalityVariant('GBR')).toBeNull();
    expect(mrzNationalityVariant('British')).toBeNull();
  });
});

describe('toIso3 — formal state names', () => {
  it.each([
    ['Korea, Republic of', 'KOR'],
    ['Republic of Korea', 'KOR'],
    ["Korea, Democratic People's Republic of", 'PRK'],
    ["Democratic People's Republic of Korea", 'PRK'],
    ['Islamic Republic of Iran', 'IRN'],
    ['Iran, Islamic Republic of', 'IRN'],
    ['Iran (Islamic Republic of)', 'IRN'],
    ['Kingdom of Saudi Arabia', 'SAU'],
    ['Arab Republic of Egypt', 'EGY'],
    ['State of Palestine', 'PSE'],
    ['Palestine, State of', 'PSE'],
    ['Republic of the Philippines', 'PHL'],
    ['Federal Republic of Nigeria', 'NGA'],
    ['Federal Republic of Germany', 'DEU'],
    ['Republic of China', 'TWN'],
    ["People's Republic of China", 'CHN'],
    ['Syrian Arab Republic', 'SYR'],
    ['Tanzania, United Republic of', 'TZA'],
    ['United Republic of Tanzania', 'TZA'],
    ['Bolivia (Plurinational State of)', 'BOL'],
    ['Venezuela (Bolivarian Republic of)', 'VEN'],
    ['U.A.E.', 'ARE'],
    ['P.R. China', 'CHN'],
    ['PRC', 'CHN'],
    ["People's Republic of Bangladesh", 'BGD'],
    ['Islamic Republic of Pakistan', 'PAK'],
    ['Socialist Republic of Viet Nam', 'VNM'],
    ['Federal Democratic Republic of Ethiopia', 'ETH'],
    ['Kingdom of the Netherlands', 'NLD'],
    ['Republic of Ireland', 'IRL'],
    ['Republic of South Africa', 'ZAF'],
    ['Republic of Niger', 'NER'],
    ['Commonwealth of Dominica', 'DMA'],
    ['Dominican Republic', 'DOM'],
    ['Dominica', 'DMA'],
    ['citizen of Pakistan', 'PAK'],
    ['Canadian citizen', 'CAN'],
  ])('%s → %s', (raw, want) => {
    expect(toIso3(raw)).toBe(want);
  });

  it('keeps the two Congos apart', () => {
    expect(toIso3('Democratic Republic of the Congo')).toBe('COD');
    expect(toIso3('Democratic Republic of Congo')).toBe('COD');
    expect(toIso3('Congo, Democratic Republic of the')).toBe('COD');
    expect(toIso3('Congo (Democratic Republic of the)')).toBe('COD');
    expect(toIso3('Republic of the Congo')).toBe('COG');
    expect(toIso3('Republic of Congo')).toBe('COG');
    expect(toIso3('Congo, Republic of the')).toBe('COG');
  });

  it('never lands a stripped name on an ambiguous short name', () => {
    // An unknown formal name of a Korea / Congo / China is not guessed.
    expect(toIso3('Union of Korea')).toBeNull();
    expect(toIso3('Kingdom of Congo')).toBeNull();
    expect(toIso3('Kingdom of China')).toBeNull();
  });

  it('does not strip "United" from United States / Kingdom / Arab Emirates', () => {
    expect(toIso3('United States')).toBe('USA');
    expect(toIso3('United Kingdom')).toBe('GBR');
    expect(toIso3('United Arab Emirates')).toBe('ARE');
  });

  it('still refuses a place that is not a country', () => {
    expect(toIso3('Lahore, Pakistan')).toBeNull();
    expect(toIso3('Rawalpindi')).toBeNull();
    expect(toIso3('Republic of Atlantis')).toBeNull();
  });
});

describe('toIso3 — nationality words', () => {
  it.each([
    ['British Citizen', 'GBR'],
    ['Korean', 'KOR'],
    ['North Korean', 'PRK'],
    ['Taiwanese', 'TWN'],
    ['Palestinian', 'PSE'],
    ['Kosovar', 'RKS'],
    ['Dutch', 'NLD'],
    ['Spanish', 'ESP'],
    ['Filipino', 'PHL'],
    ['Nigerian', 'NGA'],
    ['Nigerien', 'NER'],
    ['Brazilian', 'BRA'],
    ['Mexican', 'MEX'],
    ['Thai', 'THA'],
    ['Vietnamese', 'VNM'],
    ['Ghanaian', 'GHA'],
    ['Zimbabwean', 'ZWE'],
    ['Pakistani national', 'PAK'],
    ['Macanese', 'MAC'],
  ])('%s → %s', (raw, want) => {
    expect(toIso3(raw)).toBe(want);
  });

  it('leaves the ambiguous ones unresolved', () => {
    expect(toIso3('Congolese')).toBeNull();
    expect(toIso3('Dominican')).toBeNull();
  });
});

describe('ircc_country — new codes and the UK nationality classes', () => {
  it('Hong Kong, Macao and stateless resolve to IRCC codes', () => {
    expect(applyFillTransform('ircc_country', 'Hong Kong (SAR)')).toBe('200');
    expect(applyFillTransform('ircc_country', 'MAC')).toBe('198');
    expect(applyFillTransform('ircc_country', 'XXA')).toBe('979');
    expect(applyFillTransform('ircc_country', 'D<<')).toBe(
      IRCC_COUNTRY_CODES.DEU,
    );
    expect(applyFillTransform('ircc_country', 'Korea, Republic of')).toBe(
      '258',
    );
  });

  it('no two ISO codes share an IRCC code', () => {
    const codes = Object.values(IRCC_COUNTRY_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('a BN(O) / BOTC / BOC passport is never "British Citizen" (003)', () => {
    expect(applyFillTransform('ircc_country', 'GBN')).toBe('010');
    expect(applyFillTransform('ircc_country', 'GBO')).toBe('004');
    expect(applyFillTransform('ircc_country', 'GBD')).toBe('005');
    expect(applyFillTransform('ircc_country', 'GBS')).toBeNull();
    expect(applyFillTransform('ircc_country', 'GBR')).toBe('003');
  });

  it('refugee travel documents write nothing', () => {
    expect(applyFillTransform('ircc_country', 'XXB')).toBeNull();
  });

  it('the eTA lists do not call a GBN holder a British citizen', () => {
    expect(etaCountryCodeOption('GBN')).toBeNull();
    expect(etaNationalityOption('GBN')).toBeNull();
    expect(etaCountryCodeOption('GBR')).toBe('GBR (UK - British citizen)');
  });
});

describe('parseAddressLine — regions outside PK / UK / CA / US', () => {
  it.each([
    [
      '12 Hill Road, Bandra West, Mumbai, Maharashtra, 400050, India',
      {
        city: 'Mumbai',
        province: 'Maharashtra',
        postalCode: '400050',
        country: 'IND',
      },
    ],
    [
      '5 Awolowo Road, Ikoyi, Lagos, Lagos State, Nigeria',
      { city: 'Lagos', province: 'Lagos State', country: 'NGA' },
    ],
    [
      '8 Ayala Avenue, Makati, Metro Manila, 1200, Philippines',
      {
        city: 'Makati',
        province: 'Metro Manila',
        postalCode: '1200',
        country: 'PHL',
      },
    ],
    [
      'Av. Paulista 1000, Bela Vista, Sao Paulo, SP, 01310-100, Brazil',
      {
        city: 'Sao Paulo',
        province: 'SP',
        postalCode: '01310-100',
        country: 'BRA',
      },
    ],
    [
      'Calle Madero 10, Centro, Guadalajara, Jalisco, 44100, Mexico',
      {
        city: 'Guadalajara',
        province: 'Jalisco',
        postalCode: '44100',
        country: 'MEX',
      },
    ],
    [
      '88 Tianhe Road, Guangzhou, Guangdong, 510000, China',
      {
        city: 'Guangzhou',
        province: 'Guangdong',
        postalCode: '510000',
        country: 'CHN',
      },
    ],
    [
      'House 4, Road 2, Dhanmondi, Dhaka, Dhaka Division, 1205, Bangladesh',
      {
        city: 'Dhaka',
        province: 'Dhaka Division',
        postalCode: '1205',
        country: 'BGD',
      },
    ],
    [
      '1-1 Marunouchi, Chiyoda, Tokyo, 100-0001, Japan',
      { city: 'Tokyo', postalCode: '100-0001', country: 'JPN' },
    ],
    [
      '12 Hill Road, Bandra West, Mumbai, Maharashtra 400050, India',
      {
        city: 'Mumbai',
        province: 'Maharashtra',
        postalCode: '400050',
        country: 'IND',
      },
    ],
    [
      '350 5th Ave, Manhattan, New York, NY 10118, USA',
      { city: 'New York', province: 'NY', postalCode: '10118', country: 'USA' },
    ],
  ])('%s', (line, want) => {
    expect(parseAddressLine(line)).toMatchObject(want);
  });

  it('a state code only counts in its own country', () => {
    // "SP" is not a region in India: the line keeps its old reading.
    const a = parseAddressLine('12 Hill Road, Mumbai, SP, India');
    expect(a?.city).toBe('SP');
  });

  it('keeps the UK reading unchanged', () => {
    expect(
      parseAddressLine(
        '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
      ),
    ).toMatchObject({
      city: 'London',
      province: 'Greater London',
      postalCode: 'SW1A 1AA',
      country: 'GBR',
      countryText: 'England',
    });
  });
});

describe('splitPlace — a place of birth that is a country', () => {
  it('a city-state is the city and the country', () => {
    expect(splitPlace('HONG KONG')).toEqual({
      city: 'HONG KONG',
      country: 'HKG',
    });
    expect(splitPlace('Singapore')).toEqual({
      city: 'Singapore',
      country: 'SGP',
    });
    expect(splitPlace('Macao')).toEqual({ city: 'Macao', country: 'MAC' });
    expect(splitPlace('Monaco')).toEqual({ city: 'Monaco', country: 'MCO' });
  });

  it('any other country is the country only', () => {
    expect(splitPlace('PAKISTAN')).toEqual({ country: 'PAK' });
  });

  it('Hong Kong, China is Hong Kong', () => {
    expect(splitPlace('Kowloon, Hong Kong, China')).toEqual({
      city: 'Kowloon',
      country: 'HKG',
    });
    expect(splitPlace('Hong Kong, China')).toEqual({
      city: 'Hong Kong',
      country: 'HKG',
    });
  });

  it('a city stays a city', () => {
    expect(splitPlace('Rawalpindi')).toEqual({ city: 'Rawalpindi' });
    expect(splitPlace('Rawalpindi, Punjab, Pakistan')).toEqual({
      city: 'Rawalpindi',
      country: 'PAK',
    });
  });
});
