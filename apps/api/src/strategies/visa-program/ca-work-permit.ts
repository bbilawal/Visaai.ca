import { CA_WORK_VISAAI_ID, requiredGenTypesForRoute } from '@visaai/types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';

/**
 * Canada's work permit (from outside Canada) on top of the generic work
 * permit program.
 *
 * WHY THIS EXISTS
 *
 * No program claimed the `ca-work-permit` route (2026-10-29), so every stage
 * fell back to the visitor visa: the interview asked for a trip purpose and
 * travel dates, the letters used the visitor briefs, the document templates
 * fell back to every Canada form (IMM 5257 included), and Launch resolved to
 * IRCC tr-rt with the visitor-visa mapping — "Visitor visa" ticked on a work
 * permit.
 *
 * A new work permit from outside Canada is applied for in the IRCC secure
 * account (GCKey / Sign-In Partner): "Apply to come to Canada", the
 * eligibility questionnaire, then IMM 1295 and the personalised checklist.
 * tr-rt only lists the H-1B holder work permit. The route resolves to its
 * own portal, 'ircc-work' (canada.strategy.ts), whose assisted fill answers
 * the questionnaire's Work branch (recorded live 2026-10-30,
 * portal-fills/canada-ircc-work-eapp.ts) and stops at "Review your answers".
 *
 * Employment is what a work permit is decided on, so readiness keeps its
 * employment weight (unlike the study permit, which zeroes it).
 *
 * Sources (read 2026-10-29):
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/application/ircc-accounts.html
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside/apply.html
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside/forms-documents.html
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1295.html
 */

const INTERVIEW_GUIDANCE = `THIS ROUTE IS A CANADIAN WORK PERMIT APPLIED FOR FROM OUTSIDE CANADA (IMM 1295, IRCC secure account).
- It is NOT a visit. Never ask for a purpose of trip, an itinerary, a host or a letter of invitation, or arrival and departure dates: ask the work start and end dates instead.
- Ask the kind of work permit as the applicant's documents describe it (employer-specific with an LMIA, employer-specific LMIA-exempt with an offer of employment number, or open); the employer, the job title and duties, where they will work and the dates; the 7-digit LMIA number or the offer of employment number (A followed by 7 digits); a Quebec acceptance certificate (CAQ) only for an LMIA job in Quebec; for an open work permit as a family member, whose family member they are and that person's permit in Canada; then identity, family (IMM 5645), education, 10 years of work history, languages and the background questions.
- International Experience Canada (IEC), post-graduation work permits and permits applied for from inside Canada or at the border are different applications: say so plainly and do not treat them as this route.
- Never decide the permit type, an LMIA exemption or eligibility for the applicant: record what their documents say. Never estimate the chance of approval or processing time, and give no legal advice. VisaAI guarantees no outcome.
- Background declarations (refusals, overstays, crimes, military service, health) and the public policy question are asked word for word and recorded only from an explicit answer. Never infer one and never default one to "No".`;

/** The Canada-only settings of the work permit program. */
export function caWorkPermitOverrides(
  country: VisaProgramStrategy['country'],
): Partial<VisaProgramStrategy> {
  return {
    registryVisaaiIds: [CA_WORK_VISAAI_ID],
    // Shared with the web app's progress through @visaai/types route-letters.
    requiredGeneratedDocuments: () =>
      requiredGenTypesForRoute({ country, visaaiId: CA_WORK_VISAAI_ID }),
    // The registry carries IRCC's work permit documents (LMIA or offer of
    // employment, contract, proof of qualifications...). Discovery's prompt
    // reasons like a visitor — a return flight, funds for the trip — and
    // would pad the file.
    checklistSupplement: false,
    interviewGuidance: () => INTERVIEW_GUIDANCE,
  };
}
