import '../../strategies'; // registers the built-in country strategies
import {
  programIdForVisaType,
  requiredFormsFor,
  allCatalogedForms,
  formsForCountry,
} from './form-catalog';

describe('programIdForVisaType', () => {
  it('maps the seeded Canadian TRV code to the visitor program', () => {
    expect(programIdForVisaType('TRV')).toBe('visitor_visa');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(programIdForVisaType('  trv ')).toBe('visitor_visa');
  });

  it('passes a value that is already a program id straight through', () => {
    expect(programIdForVisaType('family_sponsorship')).toBe(
      'family_sponsorship',
    );
  });

  it('returns null for an unmapped visa type', () => {
    expect(programIdForVisaType('WHATEVER-9000')).toBeNull();
  });
});

describe('requiredFormsFor', () => {
  it('resolves IMM 5257 for a Canadian TRV', () => {
    const forms = requiredFormsFor('CA', 'TRV');
    expect(forms.map((f) => f.formCode)).toEqual(['IMM 5257']);
  });

  it('carries the landing URL from FormSpec.sourceUrl', () => {
    expect(requiredFormsFor('CA', 'TRV')[0].landingUrl).toBe(
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
    );
  });

  it('supplies a landing URL for a form whose FormSpec omits sourceUrl', () => {
    // canada.strategy.ts gives IMM 5645 no sourceUrl. Without the catalogue
    // fallback it would be permanently undiscoverable.
    const imm5645 = requiredFormsFor('CA', 'family_sponsorship').find(
      (f) => f.formCode === 'IMM 5645',
    );
    expect(imm5645?.landingUrl).toBe(
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
    );
  });

  it('tags each form with the country portal id', () => {
    expect(requiredFormsFor('CA', 'TRV')[0].portalId).toBe('ircc');
  });

  it('returns an empty list for an unknown country', () => {
    expect(requiredFormsFor('ZZ', 'TRV')).toEqual([]);
  });

  it('returns an empty list for an unmappable visa type', () => {
    expect(requiredFormsFor('CA', 'WHATEVER-9000')).toEqual([]);
  });

  it('returns an empty list for a country whose programs declare no forms', () => {
    expect(requiredFormsFor('US', 'visitor_visa')).toEqual([]);
  });
});

describe('allCatalogedForms', () => {
  it('enumerates every form with a landing URL — the refresh worklist', () => {
    const all = allCatalogedForms();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((f) => f.landingUrl !== null)).toBe(true);
  });

  it('deduplicates a form that several programs require', () => {
    // IMM 5257 appears in both visitor_visa and family_sponsorship, but the
    // identity key is (country, program, formCode), so both rows are kept and
    // neither is duplicated within its own program.
    const ca = allCatalogedForms().filter((f) => f.countryCode === 'CA');
    expect(ca.length).toBeGreaterThan(0);
    const keys = ca.map((f) => `${f.program}/${f.formCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('LANDING_URLS agrees with every FormSpec.sourceUrl for the same form code', () => {
    // Same form can resolve through either path (visitor_visa's IMM 5257 has a
    // sourceUrl, family_sponsorship's does not). If they ever disagree, one
    // program silently serves a stale government URL.
    const seen = new Map<string, string>();
    for (const form of allCatalogedForms()) {
      const prev = seen.get(form.formCode);
      if (prev) expect(form.landingUrl).toBe(prev);
      else if (form.landingUrl) seen.set(form.formCode, form.landingUrl);
    }
    expect(seen.get('IMM 5257')).toBeDefined();
  });
});

/**
 * Whole-branch review, Finding C1. Applications created through intake carry
 * `destination_country` but no `framework_id` (framework_id is never written
 * by the real path), so FormsService cannot know WHICH program applies —
 * only the country. `formsForCountry` answers "every form any program for
 * this country could need", deduplicated, so FormsService has something
 * real to offer instead of an unconditional `[]`.
 */
describe('formsForCountry', () => {
  it('returns every form registered under any CA program, deduplicated', () => {
    const forms = formsForCountry('CA');
    const codes = forms.map((f) => f.formCode);

    expect(codes).toEqual(expect.arrayContaining(['IMM 5257', 'IMM 5645']));
    // IMM 5257 is registered under BOTH visitor_visa and family_sponsorship —
    // it must appear exactly once, not once per program.
    expect(codes.filter((c) => c === 'IMM 5257')).toHaveLength(1);
  });

  it('is case-insensitive, matching the strategy registry', () => {
    expect(formsForCountry('ca').map((f) => f.formCode)).toEqual(
      expect.arrayContaining(['IMM 5257', 'IMM 5645']),
    );
  });

  it('returns an empty list for an unknown country', () => {
    expect(formsForCountry('ZZ')).toEqual([]);
  });
});

describe('Schengen coverage', () => {
  it('gives every Schengen member the harmonised form on both programs', () => {
    for (const code of ['DE', 'FR', 'IT', 'ES', 'NL']) {
      for (const program of ['tourist_visa', 'business_visa']) {
        const forms = requiredFormsFor(code, program);
        expect(forms.map((f) => f.formCode)).toEqual(['SCHENGEN-C']);
        expect(forms[0].landingUrl).toContain('home-affairs.ec.europa.eu');
        expect(forms[0].portalId).toBe('schengen-consulate');
      }
    }
  });

  it('points every member at the SAME form — one cached copy serves all 29', () => {
    const urls = new Set(
      allCatalogedForms()
        .filter((f) => f.formCode === 'SCHENGEN-C')
        .map((f) => f.landingUrl),
    );
    expect(urls.size).toBe(1);
  });

  it('covers 32 countries (Canada, US, Australia, and 29 Schengen members)', () => {
    const countries = new Set(allCatalogedForms().map((f) => f.countryCode));
    expect(countries.size).toBe(32);
    expect(countries.has('AU')).toBe(true);
    expect(countries.has('CA')).toBe(true);
    expect(countries.has('US')).toBe(true);
    expect(countries.has('DE')).toBe(true);
  });

  it('covers every Canadian program with its own official form', () => {
    expect(
      requiredFormsFor('CA', 'visitor_visa').map((f) => f.formCode),
    ).toEqual(['IMM 5257']);
    expect(
      requiredFormsFor('CA', 'business_visa').map((f) => f.formCode),
    ).toEqual(['IMM 5257']);
    expect(
      requiredFormsFor('CA', 'student_visa').map((f) => f.formCode),
    ).toEqual(['IMM 1294']);
    expect(
      requiredFormsFor('CA', 'work_permit').map((f) => f.formCode),
      // IMM 5645 Family Information: each applicant 18+ for a work permit
      // made outside Canada (2026-10-29).
    ).toEqual(['IMM 1295', 'IMM 5645']);
    expect(
      requiredFormsFor('CA', 'family_sponsorship').map((f) => f.formCode),
    ).toEqual(['IMM 5257', 'IMM 5645']);
  });

  it('gives Australia its one paper form and leaves the online-only routes empty', () => {
    // Only the Business Visitor stream still publishes a blank form; the
    // tourist form 1419 now 401s and student 157A is gone, both moved to
    // ImmiAccount.
    expect(
      requiredFormsFor('AU', 'business_visa').map((f) => f.formCode),
    ).toEqual(['1415']);
    expect(requiredFormsFor('AU', 'visitor_visa')).toEqual([]);
    expect(requiredFormsFor('AU', 'student_visa')).toEqual([]);
  });

  it('warns in the form NAME that the Australian paper form is restricted-use', () => {
    // formName is what renders in the UI, so the restriction has to live
    // there rather than only in a code comment.
    const [form] = requiredFormsFor('AU', 'business_visa');
    expect(form.formName).toMatch(/only if Home Affairs has told you/i);
    expect(form.formName).toMatch(/ImmiAccount/i);
  });

  it('gives the US family route a form while its online-only routes stay empty', () => {
    expect(
      requiredFormsFor('US', 'family_sponsorship').map((f) => f.formCode),
    ).toEqual(['I-130']);
    expect(requiredFormsFor('US', 'visitor_visa')).toEqual([]);
    expect(requiredFormsFor('US', 'business_visa')).toEqual([]);
  });

  it('still offers nothing for portals with no published blank form', () => {
    // US (DS-160) and UK are online-only applications — there is no PDF to
    // fetch, so an empty list is the correct answer, not a gap.
    expect(requiredFormsFor('US', 'visitor_visa')).toEqual([]);
    expect(requiredFormsFor('GB', 'visitor_visa')).toEqual([]);
  });
});
