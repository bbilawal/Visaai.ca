import { statedNationality } from './stated-nationality';

/**
 * Prod 2026-10-16, app 5d3a17a4: the applicant's FIRST message said "I am a
 * citizen of Pakistan with a Pakistani passport only" and the stored profile
 * held no nationality at all — so the eTA gate saw 'unknown' and accepted a
 * route a Pakistani passport cannot use. The model's extraction is not the
 * only line of defence for the one fact that decides the route.
 */
const PROD_MESSAGE =
  'I am a citizen of Pakistan with a Pakistani passport only. I want to visit my son Bilawal, a Canadian permanent resident in Ontario, for 2 months as a tourist. I am retired.';

describe('statedNationality', () => {
  it('reads the nationality and passport country from the prod message', () => {
    expect(statedNationality(PROD_MESSAGE)).toEqual({
      nationality: 'Pakistan',
      passport_country: 'Pakistan',
    });
  });

  it.each([
    ["I'm a Pakistani citizen.", 'Pakistan'],
    ['I am an Indian national', 'India'],
    ['I hold a Nigerian passport', 'Nigeria'],
    ['My passport is from the United Kingdom.', 'United Kingdom'],
    ['I have a British passport and I want to visit', 'United Kingdom'],
    ['My nationality is Mexican', 'Mexico'],
    ['i am a citizen of the united states', 'United States'],
  ])('reads %p as %p', (text, expected) => {
    expect(statedNationality(text)?.nationality).toBe(expected);
  });

  it.each([
    'I want to visit my son, a Canadian citizen.',
    'My son is a Canadian permanent resident.',
    'My daughter holds a British passport.',
    'I am retired.',
    'I am visiting a Canadian citizen.',
    "I have my son's Canadian passport details.",
    'I am in Canada on a visit.',
    'I am a citizen.',
    'We are going for tourism.',
  ])(
    'does not attribute someone else’s status to the applicant: %p',
    (text) => {
      expect(statedNationality(text)).toBeNull();
    },
  );
});

// Review of #134: a relative's citizenship in the possessive is not the
// applicant's ("I'm a Canadian citizen's spouse").
describe('statedNationality — possessive relatives', () => {
  it("ignores \"I'm a Canadian citizen's spouse\"", () => {
    expect(statedNationality("I'm a Canadian citizen's spouse")).toBeNull();
  });
});
