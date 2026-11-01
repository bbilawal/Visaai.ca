/**
 * IRCC tr-rt native language (#selectNativeLanguage_select): the extension
 * selects by exact option text, so the language is resolved against IRCC's
 * own list (assets/tr-lov/test-lovs.json, Person_Spoken_Language). A
 * language not on it is "Other" plus #inputNativeLanguage_input, which takes
 * English/French letters only.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { IRCC_NATIVE_LANGUAGES } from '../src/modules/automation/portal-fills/ircc-languages';

const trv = () => resolvePortalFill('ircc')!;
const BASE: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  passport_number: 'AB1234567',
};
const at = (p: Record<string, unknown>, target: string) =>
  buildMappingInputs(
    trv(),
    applyPrefillOverrides(trv(), { ...BASE, ...p }, []),
  ).find((x) => x.targetField === target)?.mappedValue;
const SELECT = '#selectNativeLanguage_select';
const OTHER = '#inputNativeLanguage_input';

it('the list holds the common languages and "Other"', () => {
  for (const l of ['Urdu', 'Punjabi', 'English', 'Arabic', 'Mandarin', 'Other'])
    expect(IRCC_NATIVE_LANGUAGES).toContain(l);
});

it.each([
  ['urdu', 'Urdu'],
  ['Punjabi', 'Punjabi'],
  [' english ', 'English'],
])('"%s" selects IRCC\'s "%s", nothing typed', (raw, option) => {
  expect(at({ native_language: raw }, SELECT)).toBe(option);
  expect(at({ native_language: raw }, OTHER)).toBeUndefined();
});

it('a language IRCC does not list is "Other", typed in', () => {
  const p = { native_language: 'Klingon' };
  expect(at(p, SELECT)).toBe('Other');
  expect(at(p, OTHER)).toBe('Klingon');
});

it("text IRCC's letters-only box would reject is left for the applicant", () => {
  const p = { native_language: 'Urdu and Punjabi' };
  expect(at(p, SELECT)).toBeUndefined();
  expect(at(p, OTHER)).toBeUndefined();
});

it('…with a note saying why', () => {
  const left =
    portalFillCoverage(
      trv(),
      applyPrefillOverrides(
        trv(),
        { ...BASE, native_language: 'Urdu and Punjabi' },
        [],
      ),
    ).pages.find((x) => x.page === '/language')?.left ?? [];
  expect(
    left.some((n) => /one language from its list/.test(n.note ?? '')),
  ).toBe(true);
});

describe('review of #260', () => {
  const rows = (p: Record<string, unknown>) =>
    (
      portalFillCoverage(
        trv(),
        applyPrefillOverrides(trv(), { ...BASE, ...p }, []),
      ).pages.find((x) => x.page === '/language')?.left ?? []
    ).filter((n) => n.label === 'Native language');

  it('one row, never a false "not in your data", when the language is known', () => {
    const r = rows({ native_language: 'Urdu and Punjabi' });
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('fill_yourself');
  });

  it('no language at all: one "not in your data" row', () => {
    const r = rows({});
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('not_in_profile');
  });

  it('a known language lists nothing', () => {
    expect(rows({ native_language: 'Urdu' })).toHaveLength(0);
  });

  it.each(['None', 'NA', 'Unknown', 'Same', 'Other'])(
    '"%s" is not a language: nothing is written',
    (raw) => {
      expect(at({ native_language: raw }, SELECT)).toBeUndefined();
      expect(at({ native_language: raw }, OTHER)).toBeUndefined();
    },
  );

  it.each([
    ['Panjabi', 'Punjabi'],
    ['Bangla', 'Bengali'],
    ['Filipino', 'Tagalog'],
  ])('"%s" is IRCC\'s "%s"', (raw, option) => {
    expect(at({ native_language: raw }, SELECT)).toBe(option);
  });

  it("a language IRCC lists in several kinds is the applicant's to choose", () => {
    expect(at({ native_language: 'Balochi' }, SELECT)).toBeUndefined();
    expect(rows({ native_language: 'Balochi' })[0].note).toMatch(
      /several kinds of Balochi/,
    );
  });

  it('the one "Name, …" entry is chosen', () => {
    const one = IRCC_NATIVE_LANGUAGES.find(
      (l) =>
        l.includes(',') &&
        IRCC_NATIVE_LANGUAGES.filter((m) =>
          m.toLowerCase().startsWith(l.split(',')[0].toLowerCase()),
        ).length === 1,
    )!;
    expect(at({ native_language: one.split(',')[0] }, SELECT)).toBe(one);
  });

  it("a consultant's typed language wins for Other", () => {
    const q = applyPrefillOverrides(
      trv(),
      {
        ...BASE,
        native_language: 'Klingon',
        ircc_native_language_other: 'Klingonese',
      },
      [],
    );
    const out = buildMappingInputs(trv(), q);
    expect(out.find((x) => x.targetField === SELECT)?.mappedValue).toBe(
      'Other',
    );
    expect(out.find((x) => x.targetField === OTHER)?.mappedValue).toBe(
      'Klingonese',
    );
  });
});
