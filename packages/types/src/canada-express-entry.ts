/**
 * Canada Express Entry: the registry id shared by the API and the web app.
 *
 * WHY THIS EXISTS
 *
 * Express Entry was a registry route with no program behind it (2026-10-19),
 * so every stage treated it as a visitor visa: the interview asked for a trip
 * purpose and arrival/departure dates, and the IRCC portal route resolved to
 * tr-rt — an Express Entry applicant who reached Launch got IMM 5257 visitor
 * visa fill steps. It is a permanent-residence profile on its own IRCC form.
 */

/** Registry visa type (`visa_types.visaai_id`) for Canada's Express Entry. */
export const CA_EE_VISAAI_ID = 'ca-express-entry'
