import {
  CA_ETA_VISAAI_ID,
  isEtaConditional,
  isEtaVisaExempt,
  intakeAnswerIsYes,
  profileNationality,
} from '@visaai/types';
import type { RouteEligibility } from './base-visa-program.strategy';
import { assessEtaEligibility } from './eta.strategy';

/** Whether the applicant said they fly to Canada (true / false / not asked). */
function travelsByAirAnswered(p: Record<string, unknown>): boolean | undefined {
  for (const k of ['travel_by_air', 'arriving_by_air', 'flying_to_canada']) {
    const v = intakeAnswerIsYes(p[k]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const ETA_LABEL = 'Electronic travel authorization (eTA)';

/**
 * Who should file Canada's business visitor route (`ca-business-visitors`,
 * IRCC tr-rt — a visitor visa for business). A business visitor needs the
 * same entry document as any visitor, so the answer comes from the eTA rules
 * above (owner decision 2026-10-18):
 *
 *  - a visa-exempt national flying in needs an eTA, not a visa → sent to
 *    the eTA route;
 *  - nothing at all (Canadian or U.S. citizen, U.S. permanent resident, a
 *    valid Canadian visa, a visa-exempt national arriving by land) →
 *    not_required;
 *  - a CAN+ national who qualifies MAY use an eTA but may also file the
 *    visa, so the route stays open and the reason says so;
 *  - everyone else needs the visa → eligible.
 */
export function assessCaBusinessVisitorEligibility(
  profile: Record<string, unknown> | null | undefined,
): RouteEligibility {
  const p = profile ?? {};
  // Pay from a Canadian source is work in the Canadian labour market: a work
  // permit, not business-visitor status, whatever the entry document.
  if (
    ['paid_by_canadian_source', 'canadian_payment', 'paid_in_canada'].some(
      (k) => intakeAnswerIsYes(p[k]) === true,
    )
  )
    return {
      status: 'ineligible',
      reason:
        'A business visitor must stay paid by their employer or business outside Canada. Being paid a salary, fee or commission by a Canadian company or person for this work usually needs a work permit, not a business visitor visa.',
    };
  const eta = assessEtaEligibility(p);
  const nationality = profileNationality(p);
  const name = nationality ? countryLabel(nationality) : '';
  switch (eta.status) {
    case 'unknown':
      // A CAN+ national whose visa history is not known yet can always file
      // the visa; only the eTA alternative is open.
      if (nationality && isEtaConditional(nationality))
        return {
          status: 'eligible',
          reason: `Citizens of ${name} need a visitor visa for a business trip to Canada, unless they fly in and held a Canadian visitor visa in the past 10 years or hold a valid U.S. non-immigrant visa — then an eTA is enough.`,
        };
      return {
        status: 'unknown',
        reason:
          'Whether you need a visitor visa or an eTA for a business trip depends on your nationality and how you travel, which we do not know yet.',
      };
    case 'not_required':
      return {
        status: 'not_required',
        reason: /valid Canadian visitor visa already/.test(eta.reason)
          ? 'A valid Canadian visitor visa already covers a business visit — you do not need to apply again.'
          : eta.reason.replace(
              /do not need an eTA/,
              'need neither a visitor visa nor an eTA',
            ),
      };
    case 'ineligible':
      // The eTA's "you need a visitor visa instead" — this route.
      return {
        status: 'eligible',
        reason: name
          ? `Citizens of ${name} need a visitor visa for a business trip to Canada.`
          : 'You need a visitor visa for a business trip to Canada.',
      };
    case 'eligible':
      if (nationality && isEtaVisaExempt(nationality))
        return {
          status: 'ineligible',
          reason:
            travelsByAirAnswered(p) === true
              ? `Citizens of ${name} do not need a visitor visa for a business trip to Canada — flying in, they need only an eTA.`
              : `Citizens of ${name} do not need a visitor visa for a business trip to Canada: flying in, they need only an eTA; arriving by car, bus, train or boat, they need nothing but a valid passport.`,
          recommendedVisaaiId: CA_ETA_VISAAI_ID,
          recommendedLabel: ETA_LABEL,
        };
      return {
        status: 'eligible',
        reason: `${eta.reason} You can also apply for a visitor visa for your business trip.`,
      };
  }
}
