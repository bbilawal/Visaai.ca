/**
 * Canada work permit (applied for from outside Canada): the registry id
 * shared by the API and the web app.
 *
 * WHY THIS EXISTS
 *
 * The work permit program had no registry route (2026-10-29), so every stage
 * treated `ca-work-permit` as a visitor visa: the interview asked for a trip
 * purpose and arrival/departure dates, the letters used the visitor briefs,
 * and the IRCC portal route resolved to tr-rt — Launch would have written
 * IMM 5257 visitor-visa answers, "Visitor visa" included, into a work permit
 * application. A new work permit from outside Canada is filed in the IRCC
 * secure account ("Apply to come to Canada", then IMM 1295), not on tr-rt.
 */

/** Registry visa type (`visa_types.visaai_id`) for Canada's work permit. */
export const CA_WORK_VISAAI_ID = 'ca-work-permit'

export function isWorkPermitRoute(visaaiId: string | null | undefined): boolean {
  return (visaaiId ?? '').trim() === CA_WORK_VISAAI_ID
}
