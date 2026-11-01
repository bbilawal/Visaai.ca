import { CA_SPOUSAL_VISAAI_ID, requiredGenTypesForRoute } from '@visaai/types';
import type { CountryCode, ComplianceRequirement } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { COMMON_DOCS } from '../document-requirements/common-documents';

/**
 * Canada's "Sponsor your spouse, partner or child" as a program of its own.
 *
 * WHY THIS EXISTS
 *
 * The route was a registry entry no program claimed (2026-10-19), so every
 * stage fell back to visitor-visa behaviour: the interview asked for a trip
 * purpose and travel dates, readiness weighed home ties and funds, and the
 * IRCC portal route resolved to tr-rt — Launch would have written IMM 5257
 * visitor-visa answers into a permanent-residence application.
 *
 * It is not the Super Visa (family_sponsorship): that is a visit by a parent
 * or grandparent. This is permanent residence, filed as TWO applications on
 * IRCC's Permanent Residence Portal — the sponsor's (IMM 1344) and the
 * principal applicant's (IMM 0008 and its schedules) — submitted together.
 *
 * Approval-neutral: VisaAI never judges whether a relationship is genuine,
 * never predicts an outcome and never answers a legal declaration for the
 * sponsor or the applicant.
 *
 * Sources (read 2026-10-19):
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children.html
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5525-sponsor-your-spouse-common-law-partner-conjugal-partner-dependent-child-complete-guide.html
 */

const INTERVIEW_GUIDANCE = `THIS ROUTE IS CANADA'S SPOUSAL / PARTNER / DEPENDENT CHILD SPONSORSHIP (PERMANENT RESIDENCE).
- It is NOT a visit. Never ask for a purpose of trip, arrival or departure dates, a return ticket, an itinerary, ties to the home country, or a host's letter of invitation.
- Two people file: the SPONSOR (a Canadian citizen or permanent resident, 18 or older, living in Canada) and the PRINCIPAL APPLICANT (the spouse, common-law or conjugal partner, or dependent child being sponsored). Keep their facts apart: every sponsor fact goes under a sponsor_ key; the applicant's own facts keep the usual keys. Never copy the sponsor's job, address or status onto the applicant.
- Ask what IRCC's forms ask: the relationship type and its history (how and when they met, first in-person meeting, marriage or start of living together, time apart), the sponsor's status and when they got it, previous marriages or common-law relationships of both, children of both, the applicant's addresses and activities for the past 10 years, and the declarations on the forms.
- Declarations (criminality, removal, social assistance, bankruptcy, a previous sponsorship that was defaulted, being sponsored themselves within 5 years) are asked word for word and recorded only from an explicit answer. Never infer one.
- Never say a relationship is or is not genuine, never estimate the chance of approval or processing time, and give no legal advice. VisaAI guarantees no outcome.`;

export interface SpousalSponsorshipOpts {
  label?: string;
  compliance?: ComplianceRequirement[];
}

export function spousalSponsorshipProgram(
  country: CountryCode,
  opts: SpousalSponsorshipOpts = {},
): VisaProgramStrategy {
  return {
    id: 'spousal_sponsorship',
    country,
    label: opts.label ?? 'Sponsor your spouse, partner or child (permanent residence)',
    registryVisaaiIds: [CA_SPOUSAL_VISAAI_ID],
    // IRCC's document checklist (IMM 5533), split by who supplies each. The
    // registry carries the sourced rows (20261019220100): passport, birth,
    // marriage and police certificates, relationship evidence and the
    // sponsor's status proof, plus the photo and fee receipt.
    requiredDocuments: () => [
      COMMON_DOCS.passport,
      { ...COMMON_DOCS.photo, label: 'Photos of the principal applicant and each family member' },
      {
        ...COMMON_DOCS.proof_of_relationship,
        label: 'Proof of relationship (marriage certificate, or proof of living together for 12 months)',
        required: true,
      },
      {
        code: 'relationship_evidence',
        label: 'Evidence the relationship is genuine (photos together, communication, joint documents)',
        required: true,
        ownedBy: 'applicant',
      },
      {
        code: 'birth_certificate',
        label: 'Birth certificate of the principal applicant and each dependent child',
        required: true,
        ownedBy: 'applicant',
      },
      {
        code: 'police_clearance',
        label: 'Police certificates from every country lived in for 6+ months since age 18',
        required: true,
        ownedBy: 'applicant',
      },
      {
        code: 'national_id',
        label: 'National identity document',
        required: false,
        ownedBy: 'applicant',
      },
      {
        code: 'divorce_or_death_certificate',
        label: 'Proof a previous marriage ended (divorce, annulment or death certificate)',
        required: false,
        ownedBy: 'applicant',
      },
      {
        ...COMMON_DOCS.proof_of_status,
        label: "Sponsor's proof of Canadian citizenship or permanent residence",
        required: true,
      },
      {
        code: 'sponsor_residence_proof',
        label: "Sponsor's proof of living in Canada (or of returning, if a citizen abroad)",
        required: false,
        ownedBy: 'sponsor',
      },
      {
        code: 'sponsor_previous_relationship_proof',
        label: "Proof the sponsor's previous marriage or relationship ended",
        required: false,
        ownedBy: 'sponsor',
      },
    ],
    // Never the country's visitor set (IMM 5257, 5645, 5409...). The
    // registry carries IMM 1344 and IMM 5476 as form requirements.
    documentTemplates: () => [],
    eligibilityChecks: () => [
      {
        id: 'sponsor_status',
        description: 'Sponsor is a Canadian citizen or permanent resident, 18 or older, living in Canada',
      },
      {
        id: 'qualifying_relationship',
        description: 'Spouse, common-law partner, conjugal partner or dependent child',
      },
      {
        id: 'sponsor_not_barred',
        description: 'Sponsor is not barred (e.g. sponsored as a spouse themselves within the last 5 years)',
      },
    ],
    validationRules: () => [
      {
        id: 'relationship_history_consistent',
        description: 'Relationship dates agree across the sponsor and applicant answers and the documents',
        severity: 'error',
      },
      {
        id: 'police_certificate_age',
        description: 'Police certificates must be recent (generally issued within 6 months)',
        severity: 'warning',
      },
    ],
    evidenceRules: () => [],
    riskSignals: () => [],
    complianceRequirements: () => opts.compliance ?? [],
    forms: () => [],
    // Shared with the web app's progress through @visaai/types route-letters.
    requiredGeneratedDocuments: () =>
      requiredGenTypesForRoute({ country, visaaiId: CA_SPOUSAL_VISAAI_ID }),
    // Discovery's prompt reasons like a visitor — ties to home, a return
    // flight, funds for the trip — and would pad this file with that evidence.
    checklistSupplement: false,
    // A spouse is expected to move to Canada, there is no income test for a
    // spouse or partner (only in two dependent-child cases), and the
    // applicant's job is not a test either. What decides the file is the
    // relationship evidence and consistent answers.
    riskWeightOverrides: () => ({
      home_ties_pct: 0,
      travel_history_pct: 0,
      financial_pct: 0,
      employment_pct: 0,
    }),
    interviewGuidance: () => INTERVIEW_GUIDANCE,
  };
}
