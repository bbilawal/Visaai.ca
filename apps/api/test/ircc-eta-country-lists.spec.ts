/**
 * The eTA form's three country selects, read in full from the live form on
 * 2026-10-18. Before, only Pakistan and the UK resolved, so an applicant from
 * anywhere else had citizenship, nationality, birth, address and employer
 * country all left blank.
 */
import {
  etaCountryCodeOption,
  etaNationalityOption,
  etaPlaceOption,
} from '../src/modules/automation/portal-fills/eta-options';
import {
  ETA_CODE_OPTIONS,
  ETA_NATIONALITY_OPTIONS,
  ETA_PLACE_OPTIONS,
} from '../src/modules/automation/portal-fills/eta-country-lists';

describe('eTA country lists', () => {
  it.each([
    ['India', 'IND (India)', 'India', 'India'],
    ['IND', 'IND (India)', 'India', 'India'],
    ['Mexico', 'MEX (Mexico)', 'Mexico', 'Mexico'],
    ['Philippines', 'PHL (Philippines)', 'Philippines', 'Philippines'],
    ['Pakistan', 'PAK (Pakistan)', 'Pakistan', 'Pakistan'],
    ['Germany', 'D (Germany, Federal Republic Of)', 'Germany, Federal Republic Of', 'Germany, Federal Republic Of'],
    ['United States', 'USA (United States of America)', 'United States of America', 'United States of America'],
    ['South Korea', 'KOR (Korea, South)', 'Korea, South', 'Korea, South'],
    ['Hong Kong', 'CHN (China (Hong Kong SAR))', 'China (Hong Kong SAR)', 'China (Hong Kong SAR)'],
    ['Myanmar', 'MMR (Burma (Myanmar))', 'Burma (Myanmar)', 'Burma (Myanmar)'],
    ['Netherlands', 'NLD (Netherlands, The)', 'Netherlands, The', 'Netherlands, The'],
  ])('%s → code %s, nationality %s, place %s', (raw, code, nat, place) => {
    expect(etaCountryCodeOption(raw)).toBe(code);
    expect(etaNationalityOption(raw)).toBe(nat);
    expect(etaPlaceOption(raw)).toBe(place);
  });

  it('the UK: citizen code and nationality, but the place is the nation, never guessed', () => {
    expect(etaCountryCodeOption('United Kingdom')).toBe('GBR (UK - British citizen)');
    expect(etaNationalityOption('GBR')).toBe('UK - British citizen');
    expect(etaPlaceOption('United Kingdom')).toBeNull();
    expect(etaPlaceOption('Leeds, England')).toBe('England');
    expect(etaPlaceOption('Glasgow, Scotland')).toBe('Scotland');
  });

  it('a UK passport other than "British citizen" is not guessed', () => {
    expect(etaCountryCodeOption('GBN')).toBeNull();
    expect(etaNationalityOption('GBO')).toBeNull();
  });

  it('an unknown spelling resolves to nothing', () => {
    expect(etaCountryCodeOption('Atlantis')).toBeNull();
    expect(etaPlaceOption('Atlantis')).toBeNull();
  });

  it('the tables cover the recorded lists (most countries of the world)', () => {
    expect(Object.keys(ETA_CODE_OPTIONS).length).toBeGreaterThanOrEqual(200);
    expect(Object.keys(ETA_NATIONALITY_OPTIONS).length).toBeGreaterThanOrEqual(200);
    expect(Object.keys(ETA_PLACE_OPTIONS).length).toBeGreaterThanOrEqual(200);
    expect(ETA_PLACE_OPTIONS.GBR).toBeUndefined();
  });
});
