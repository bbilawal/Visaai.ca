import { CA_EE_VISAAI_ID, requiredGenTypesForRoute } from '@visaai/types';
import type { CountryCode, ComplianceRequirement } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { COMMON_DOCS } from '../document-requirements/common-documents';

/**
 * Canada's Express Entry as a program of its own.
 *
 * WHY THIS EXISTS
 *
 * Express Entry was a registry route no program claimed (2026-10-19), so every
 * stage fell back to visitor-visa behaviour: the interview asked for a trip
 * purpose and travel dates, readiness weighed home ties, and the IRCC portal
 * route resolved to tr-rt — Launch would have written IMM 5257 visitor-visa
 * answers for a permanent-residence profile.
 *
 * Express Entry is not one program: it manages applications for the Canadian
 * Experience Class, the Federal Skilled Worker Program and the Federal Skilled
 * Trades Program. VisaAI does not know which of the three an applicant is
 * pursuing (the registry deliberately carries no rule for it), so this
 * program has no eligibility gate: hiding criteria on a guess would hide the
 * ones that apply.
 *
 * Approval-neutral: no Comprehensive Ranking System score, no prediction of
 * an invitation, no statement that the applicant qualifies.
 *
 * Source (read 2026-10-19, page dated 2026-10-16):
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents.html
 */

const INTERVIEW_GUIDANCE = `THIS ROUTE IS CANADA'S EXPRESS ENTRY (PERMANENT RESIDENCE).
- Express Entry is NOT a visit. Never ask for a purpose of trip, arrival or departure dates, a return ticket, an itinerary, ties to the home country or who will host them.
- It manages three programs: Canadian Experience Class, Federal Skilled Worker Program and Federal Skilled Trades Program. Do not tell the applicant which one they qualify for; collect the facts the profile asks.
- Ask only what the Express Entry profile asks: identity and passport, marital status and family size, language test results (test, dates, certificate number, four scores), education and the educational credential assessment (ECA), work experience of the past 10 years (title, employer, country, dates, hours per week, duties), Canadian work experience, job offer, trade certificate, provincial nomination, settlement funds, a sibling in Canada, the spouse's language/education/Canadian work when the spouse comes and is not Canadian, preferred provinces.
- Never calculate or state a Comprehensive Ranking System (CRS) score, the chance of an invitation, or a draw cut-off. VisaAI gives no legal advice and guarantees no outcome.
- Language results are valid for 2 years and an ECA for 5 years on the day the applicant applies; say so when a date given is older.`;

export interface ExpressEntryOpts {
  label?: string;
  compliance?: ComplianceRequirement[];
}

export function expressEntryProgram(
  country: CountryCode,
  opts: ExpressEntryOpts = {},
): VisaProgramStrategy {
  return {
    id: 'express_entry',
    country,
    label: opts.label ?? 'Express Entry (permanent residence)',
    registryVisaaiIds: [CA_EE_VISAAI_ID],
    // What IRCC lists for creating the profile. The certificate of
    // qualification, job offer and nomination exist only for some.
    requiredDocuments: () => [
      COMMON_DOCS.passport,
      {
        code: 'language_test_results',
        label: 'Language test results (IELTS, CELPIP, PTE Core, TEF Canada or TCF Canada)',
        required: true,
        ownedBy: 'applicant',
      },
      {
        code: 'educational_credential_assessment',
        label: 'Educational credential assessment (ECA) or proof of Canadian education',
        required: false,
        ownedBy: 'applicant',
      },
      {
        code: 'proof_of_work_experience',
        label: 'Proof of work experience (reference letters)',
        required: true,
        ownedBy: 'applicant',
      },
      // Not needed under the Canadian Experience Class or with a valid job offer.
      {
        ...COMMON_DOCS.proof_of_funds,
        label: 'Proof of settlement funds',
        required: false,
      },
      {
        code: 'job_offer',
        label: 'Written job offer from an employer in Canada',
        required: false,
        ownedBy: 'applicant',
      },
      {
        code: 'trade_certificate',
        label: 'Certificate of qualification in a trade (province or territory)',
        required: false,
        ownedBy: 'applicant',
      },
      {
        code: 'provincial_nomination',
        label: 'Provincial or territorial nomination',
        required: false,
        ownedBy: 'applicant',
      },
      {
        code: 'police_certificates',
        label: 'Police certificates',
        required: false,
        ownedBy: 'applicant',
      },
    ],
    documentTemplates: () => [],
    eligibilityChecks: () => [
      {
        id: 'express_entry_program',
        description:
          'Meets the criteria of the Canadian Experience Class, the Federal Skilled Worker Program or the Federal Skilled Trades Program',
      },
      {
        id: 'language_results_valid',
        description:
          'Approved language test results less than 2 years old on the day of applying',
      },
    ],
    validationRules: () => [
      {
        id: 'language_test_age',
        description: 'Language test results expire 2 years after the test date',
        severity: 'warning',
      },
      {
        id: 'eca_age',
        description: 'An educational credential assessment is valid for 5 years',
        severity: 'warning',
      },
    ],
    evidenceRules: () => [],
    riskSignals: () => [],
    complianceRequirements: () => opts.compliance ?? [],
    forms: () => [],
    // Shared with the web app's progress through @visaai/types route-letters.
    requiredGeneratedDocuments: () =>
      requiredGenTypesForRoute({ country, visaaiId: CA_EE_VISAAI_ID }),
    // The registry carries IRCC's own profile documents (live 2026-10-19).
    // Discovery's prompt reasons like a visitor — ties to home, a return
    // flight — and would pad a permanent-residence file with that evidence.
    checklistSupplement: false,
    // Ties to the home country are a visitor's test; a permanent resident
    // is expected to move. The profile collects no travel history either.
    riskWeightOverrides: () => ({ home_ties_pct: 0, travel_history_pct: 0 }),
    interviewGuidance: () => INTERVIEW_GUIDANCE,
  };
}
