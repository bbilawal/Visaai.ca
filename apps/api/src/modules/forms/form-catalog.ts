import { Logger } from '@nestjs/common';
import { strategyRegistry } from '../../strategies';

const log = new Logger('FormCatalog');

/**
 * Application → the official forms it needs.
 *
 * Two gaps this closes, both real:
 *
 * 1. `strategyRegistry.resolve()` had ZERO callers. The FormSpec entries in
 *    canada.strategy.ts were unreachable from an application.
 * 2. `country_frameworks.visa_type` stores the public visa code ('TRV'), not
 *    a VisaProgramId ('visitor_visa'), and nothing mapped between them.
 *
 * Landing URLs come from FormSpec.sourceUrl when present. LANDING_URLS covers
 * the forms whose FormSpec omits it — IMM 5645 is required by the Super Visa
 * program with no sourceUrl, so without the fallback it could never be
 * discovered. Keep this map small: the right long-term home is FormSpec, and
 * every entry here is a form whose strategy should eventually carry its own
 * URL.
 */
export interface RequiredForm {
  formCode: string;
  formName: string;
  landingUrl: string | null;
  portalId: string;
  program: string;
}

/** Public visa code → VisaProgramId. Keys are compared case-insensitively. */
const VISA_TYPE_TO_PROGRAM: Record<string, string> = {
  trv: 'visitor_visa',
  'visitor visa': 'visitor_visa',
  visitor: 'visitor_visa',
  'super visa': 'family_sponsorship',
  'study permit': 'student_visa',
  'work permit': 'work_permit',
};

const KNOWN_PROGRAM_IDS = new Set([
  'visitor_visa',
  'tourist_visa',
  'business_visa',
  'student_visa',
  'work_permit',
  'family_sponsorship',
]);

const LANDING_URLS: Record<string, string> = {
  'IMM 5257':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
  'IMM 5645':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
};

function normalize(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

export function programIdForVisaType(visaType: string): string | null {
  const key = normalize(visaType);
  if (!key) return null;
  if (KNOWN_PROGRAM_IDS.has(key)) return key;
  return VISA_TYPE_TO_PROGRAM[key] ?? null;
}

export function requiredFormsFor(
  countryCode: string,
  visaType: string,
): RequiredForm[] {
  const program = programIdForVisaType(visaType);
  if (!program) {
    log.warn(
      `no program mapping for visa_type "${visaType}" (country ${countryCode}) — ` +
        `no official forms will be offered. Add it to VISA_TYPE_TO_PROGRAM.`,
    );
    return [];
  }

  const resolved = strategyRegistry.resolve(countryCode, program);
  if (!resolved) {
    log.warn(
      `no strategy for ${countryCode}/${program} — no official forms will be offered.`,
    );
    return [];
  }

  const portalId = resolved.country.portal().portalId;
  const specs = resolved.program.forms?.() ?? [];

  return specs.map((spec) => ({
    formCode: spec.formCode,
    formName: spec.formName,
    landingUrl: spec.sourceUrl ?? LANDING_URLS[spec.formCode] ?? null,
    portalId,
    program,
  }));
}

/**
 * Every official form required by ANY program the country registers, keyed
 * by form code.
 *
 * Applications created through intake carry `destination_country` but no
 * `framework_id`, so the program is not recorded anywhere. We therefore
 * cannot know which program applies. Offering the union is the safer error:
 * an extra blank form costs the applicant one ignored download, while a
 * MISSING required form is the exact failure this feature exists to prevent.
 */
export function formsForCountry(countryCode: string): RequiredForm[] {
  const country = strategyRegistry.getCountry(countryCode);
  if (!country) return [];

  const seen = new Set<string>();
  const out: RequiredForm[] = [];
  for (const program of country.programs()) {
    for (const form of requiredFormsFor(countryCode, program.id)) {
      if (seen.has(form.formCode)) continue;
      seen.add(form.formCode);
      out.push(form);
    }
  }
  return out;
}

/**
 * The refresh job's worklist: every (country, program, form) with a landing
 * URL. Forms without one are skipped — there is nothing to discover from.
 */
export function allCatalogedForms(): Array<
  RequiredForm & { countryCode: string }
> {
  const out: Array<RequiredForm & { countryCode: string }> = [];

  for (const { code, programs } of strategyRegistry.listCountries()) {
    for (const programId of programs) {
      for (const form of requiredFormsFor(code, programId)) {
        if (form.landingUrl) out.push({ ...form, countryCode: code });
      }
    }
  }
  return out;
}
