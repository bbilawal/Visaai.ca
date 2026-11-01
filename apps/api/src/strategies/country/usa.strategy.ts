import { BaseCountryStrategy } from './base-country.strategy';
import type { ComplianceRequirement, PortalIntegration } from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';
import { RESIDENCY_BY_JURISDICTION } from '../compliance/compliance';
import { visitorVisaProgram } from '../visa-program/visitor-visa.strategy';
import { businessVisaProgram } from '../visa-program/business-visa.strategy';
import { familySponsorshipProgram } from '../visa-program/family-sponsorship.strategy';

/** USA (stub: B1/B2). Expand with DS-160 specifics + sector rules. */
export class UsaStrategy extends BaseCountryStrategy {
  readonly code = 'US';
  readonly name = 'United States';
  readonly dataResidency = RESIDENCY_BY_JURISDICTION.US;

  compliance(): ComplianceRequirement[] {
    // No single federal privacy law; state laws (e.g. CCPA) apply. Refine later.
    return [];
  }
  portal(): PortalIntegration {
    return {
      portalId: 'us-ceac-ds160',
      portalUrl: 'https://ceac.state.gov/genniv/',
      assistedFill: false,
    };
  }
  programs(): VisaProgramStrategy[] {
    return [
      visitorVisaProgram('US', { label: 'B-2 Visitor (Tourism)' }),
      businessVisaProgram('US'),
      // The B-1/B-2 application (DS-160) is submitted online and has no
      // downloadable blank form. The family route does: USCIS publishes
      // I-130 as a real PDF.
      familySponsorshipProgram('US', {
        label: 'Family sponsorship (Form I-130)',
        forms: [
          {
            formCode: 'I-130',
            formName: 'Petition for Alien Relative',
            sourceUrl: 'https://www.uscis.gov/i-130',
          },
        ],
      }),
    ];
  }
}
