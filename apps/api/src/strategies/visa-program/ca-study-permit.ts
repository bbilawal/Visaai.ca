import { CA_STUDY_VISAAI_ID, requiredGenTypesForRoute } from '@visaai/types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';

/**
 * Canada's study permit (from outside Canada) on top of the generic student
 * program.
 *
 * WHY THIS EXISTS
 *
 * No program claimed the `ca-study-permit` route (2026-10-20), so every stage
 * fell back to the visitor visa: the interview asked for a trip purpose and
 * travel dates, readiness scored a student as unemployed, and Launch resolved
 * to IRCC tr-rt with the visitor-visa mapping — "Visitor visa" ticked on a
 * study permit.
 *
 * Since 2025-03-25 a study permit from outside Canada is applied for in the
 * IRCC secure account (GCKey) on IMM 1294 and IMM 5645, not on the IRCC
 * Portal (tr-rt). There is no Portal Assistant mapping for it yet, so the
 * route resolves to a portal with assisted fill off (canada.strategy.ts).
 *
 * Sources (read 2026-10-20):
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/portal-application-process-study.html
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents.html
 */

const INTERVIEW_GUIDANCE = `THIS ROUTE IS A CANADIAN STUDY PERMIT (APPLIED FOR FROM OUTSIDE CANADA).
- It is NOT a visit. Never ask for a purpose of trip, a return ticket, an itinerary, a host or a letter of invitation, or arrival and departure dates: ask the program's start and end dates instead.
- Ask what IMM 1294 asks: the school (designated learning institution) and its DLI number, the program, level and field, the campus city and province, the study dates, the provincial or territorial attestation letter (PAL/TAL) or the exception that applies (a CAQ for Quebec), tuition and what is already paid, living costs, the funds available and who pays; then identity, family (IMM 5645), education, work and the background questions.
- A student under 17 travelling without a parent needs a custodian in Canada: ask only when the applicant is a minor.
- Background declarations (refusals, overstays, crimes, military service, health) are asked word for word and recorded only from an explicit answer. Never infer one.
- Never judge whether the school, program or funds are good enough, never estimate the chance of approval or processing time, and give no legal advice. VisaAI guarantees no outcome.`;

/** The Canada-only settings of the study permit program. */
export function caStudyPermitOverrides(
  country: VisaProgramStrategy['country'],
): Partial<VisaProgramStrategy> {
  return {
    registryVisaaiIds: [CA_STUDY_VISAAI_ID],
    // Shared with the web app's progress through @visaai/types route-letters.
    requiredGeneratedDocuments: () =>
      requiredGenTypesForRoute({ country, visaaiId: CA_STUDY_VISAAI_ID }),
    // The registry carries IRCC's study documents (letter of acceptance,
    // PAL/TAL, funds, custodianship...). Discovery's prompt reasons like a
    // visitor — a return flight, funds for the trip — and would pad the file.
    checklistSupplement: false,
    // A student is not expected to have a job: scoring them as unemployed
    // (10/100) would mark down every first-time student.
    riskWeightOverrides: () => ({ employment_pct: 0 }),
    interviewGuidance: () => INTERVIEW_GUIDANCE,
  };
}
