/**
 * Canada's business visitor route — a Temporary Resident Visa whose purpose is
 * business (IRCC "business visitors"): meetings, conferences and trade fairs,
 * buying goods or services, after-sales service under a contract, training at
 * a Canadian parent company. The visitor's pay and place of business stay
 * outside Canada, so they do not enter the Canadian labour market.
 *
 * Pure and dependency-free: shared by the API and the web app.
 */

/** Registry id (`visa_types.visaai_id`) of the business visitor route. */
export const CA_BUSINESS_VISITOR_VISAAI_ID = 'ca-business-visitors'

export function isBusinessVisitorRoute(
  visaaiId: string | null | undefined,
): boolean {
  return (visaaiId ?? '').trim() === CA_BUSINESS_VISITOR_VISAAI_ID
}
