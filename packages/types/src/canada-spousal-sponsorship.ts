import { CA_EE_VISAAI_ID } from './canada-express-entry'

/**
 * Canada spousal sponsorship: the registry id shared by the API and the web app.
 *
 * WHY THIS EXISTS
 *
 * "Sponsor your spouse, partner or child" was a registry route with no program
 * behind it (2026-10-19), so every stage treated it as a visitor visa: the
 * interview asked for a trip purpose and travel dates, readiness weighed ties
 * to the home country, and the IRCC portal route resolved to tr-rt — Launch
 * would have written IMM 5257 visitor-visa answers for a permanent-residence
 * application. It is filed as two applications (the sponsor's and the
 * principal applicant's) on IRCC's Permanent Residence Portal.
 */

/** Registry visa type (`visa_types.visaai_id`) for Canada's spousal sponsorship. */
export const CA_SPOUSAL_VISAAI_ID = 'ca-sponsor-your-spouse-partner-or-child'

/**
 * Routes the Portal Assistant has no mapping for yet. Submit shows the manual
 * route for them and the Forms page promises no auto-fill; the API resolves
 * them to a portal with `assistedFill: false`. Spousal sponsorship left the
 * list on 2026-10-20: its Permanent Residence Portal pages were recorded.
 * The work permit was on it from 2026-10-29 to 2026-10-30, until the IRCC
 * secure account questionnaire's Work branch was recorded live
 * (apps/api portal-fills/canada-ircc-work-eapp.ts).
 */
export const ROUTES_WITHOUT_PORTAL_FILL: readonly string[] = [CA_EE_VISAAI_ID]

/** Can the Portal Assistant fill this route's government portal? */
export function routeHasPortalFill(visaaiId: string | null | undefined): boolean {
  return !ROUTES_WITHOUT_PORTAL_FILL.includes((visaaiId ?? '').trim())
}
