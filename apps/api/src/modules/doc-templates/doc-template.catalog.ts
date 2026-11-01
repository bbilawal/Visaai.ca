import { Logger } from '@nestjs/common';
import { strategyRegistry, documentTemplatesFor } from '../../strategies';
import type { DocumentTemplateSpec } from '../../strategies/types';
import type { VisaProgramStrategy } from '../../strategies/visa-program/base-visa-program.strategy';
import { programIdForVisaType } from '../forms/form-catalog';

const log = new Logger('DocumentTemplateCatalog');

/**
 * Application → the official document artifacts it needs.
 *
 * The mirror image of form-catalog.ts, and deliberately so: the two halves of
 * a submission package (the form you file, the documents you gather) should
 * resolve the same way, degrade the same way, and be cached the same way. What
 * differs is only the SOURCE of the list — FormSpec comes off the program
 * strategy, these come off the declarative country table, with a per-program
 * strategy hook taking precedence when one exists.
 *
 * `programIdForVisaType` is reused from form-catalog rather than restated:
 * country_frameworks.visa_type stores the public code ('TRV'), and two
 * different mappings from it would drift the moment a new visa code is added
 * to one and not the other.
 */
export interface RequiredDocumentTemplate extends DocumentTemplateSpec {
  countryCode: string;
  program: string;
  portalId: string;
}

function forProgram(
  countryCode: string,
  programId: string,
  portalId: string,
): RequiredDocumentTemplate[] {
  const program = strategyRegistry.resolve(countryCode, programId)?.program;

  // A program that implements the hook owns its list outright — the country
  // table is the DEFAULT, not an additional source, so a program that needs to
  // remove or replace an inherited artifact can actually do so.
  const specs =
    program?.documentTemplates?.() ??
    documentTemplatesFor(countryCode, programId);

  return specs.map((spec) => ({
    ...spec,
    countryCode: countryCode.toUpperCase(),
    program: programId,
    portalId,
  }));
}

export function documentTemplatesForApplication(
  countryCode: string,
  visaType: string,
): RequiredDocumentTemplate[] {
  const program = programIdForVisaType(visaType);
  if (!program) {
    log.warn(
      `no program mapping for visa_type "${visaType}" (country ${countryCode}) — ` +
        `no official document templates will be offered.`,
    );
    return [];
  }
  const country = strategyRegistry.getCountry(countryCode);
  if (!country) return [];
  return forProgram(countryCode, program, country.portal().portalId);
}

/**
 * The artifacts of the program that claims a registry route: that program's
 * own list (its `documentTemplates` hook, else its row of the country table),
 * never the union of every program in the country. A program that needs none
 * says so with an empty hook (the Canada eTA).
 */
export function documentTemplatesForRoute(
  countryCode: string,
  program: VisaProgramStrategy,
  visaaiId: string,
): RequiredDocumentTemplate[] {
  const country = strategyRegistry.getCountry(countryCode);
  if (!country) return [];
  const portalId = (country.portalForRoute?.(visaaiId) ?? country.portal())
    .portalId;
  return forProgram(countryCode, program.id, portalId);
}

/**
 * The artifacts for a registry route NO program claims: only the country's
 * wildcard entries — the ones that apply to every program it registers — never
 * one program's own list.
 *
 * The route is known, so the union below is the wrong answer here: it handed
 * a UK Skilled Worker the visit and student guidance and an Australian
 * partner-visa applicant the visitor and student forms. A route that should
 * get program-specific artifacts claims itself (`registryVisaaiIds`).
 *
 * Keyed under the country's first program: wildcard artifacts are cached once
 * per program (allCatalogedDocumentTemplates), so any program's row is the
 * same artifact and the cache lookup still hits.
 */
export function documentTemplatesForUnclaimedRoute(
  countryCode: string,
): RequiredDocumentTemplate[] {
  const country = strategyRegistry.getCountry(countryCode);
  if (!country) return [];
  const first = country.programs()[0];
  if (!first) return [];
  const wildcard = new Set(
    documentTemplatesFor(countryCode, UNCLAIMED_PROGRAM).map(
      (t) => t.templateCode,
    ),
  );
  return documentTemplatesFor(countryCode, first.id)
    .filter((t) => wildcard.has(t.templateCode))
    .map((spec) => ({
      ...spec,
      countryCode: countryCode.toUpperCase(),
      program: first.id,
      portalId: country.portal().portalId,
    }));
}

/** No program has this id, so documentTemplatesFor returns the wildcard rows alone. */
const UNCLAIMED_PROGRAM = '\u0000unclaimed';

/**
 * Every artifact required by ANY program the country registers, deduped by
 * templateCode.
 *
 * Same reasoning as formsForCountry: an application created through intake
 * carries `destination_country` but no `framework_id`, so the program is not
 * recorded anywhere. Offering the union is the safer error — an extra
 * checklist costs one ignored download, a missing one costs a refusal.
 */
export function documentTemplatesForCountry(
  countryCode: string,
): RequiredDocumentTemplate[] {
  const country = strategyRegistry.getCountry(countryCode);
  if (!country) return [];

  const portalId = country.portal().portalId;
  const seen = new Set<string>();
  const out: RequiredDocumentTemplate[] = [];
  for (const program of country.programs()) {
    for (const tpl of forProgram(countryCode, program.id, portalId)) {
      if (seen.has(tpl.templateCode)) continue;
      seen.add(tpl.templateCode);
      out.push(tpl);
    }
  }
  return out;
}

/**
 * The refresh job's worklist: every (country, program, template) that is
 * actually fetchable. `resolve: 'link'` entries are excluded — the authority
 * publishes them as a web page, or robots.txt disallows the file, so there is
 * nothing to cache and re-attempting nightly would only manufacture failures.
 */
export function allCatalogedDocumentTemplates(): RequiredDocumentTemplate[] {
  const out: RequiredDocumentTemplate[] = [];
  for (const { code, programs } of strategyRegistry.listCountries()) {
    const country = strategyRegistry.getCountry(code);
    if (!country) continue;
    const portalId = country.portal().portalId;
    for (const programId of programs) {
      for (const tpl of forProgram(code, programId, portalId)) {
        if (tpl.resolve === 'link') continue;
        out.push(tpl);
      }
    }
  }
  return out;
}
