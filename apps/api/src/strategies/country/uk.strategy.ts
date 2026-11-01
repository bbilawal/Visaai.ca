import { BaseCountryStrategy } from './base-country.strategy';
import type { ComplianceRequirement, PortalIntegration } from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';
import {
  complianceFor,
  RESIDENCY_BY_JURISDICTION,
} from '../compliance/compliance';
import { visitorVisaProgram } from '../visa-program/visitor-visa.strategy';
import { studentVisaProgram } from '../visa-program/student-visa.strategy';

/** United Kingdom (stub: Standard Visitor + Student). */
export class UkStrategy extends BaseCountryStrategy {
  readonly code = 'GB';
  readonly name = 'United Kingdom';
  readonly dataResidency = RESIDENCY_BY_JURISDICTION.UK;

  compliance(): ComplianceRequirement[] {
    return complianceFor('UK_GDPR');
  }
  portal(): PortalIntegration {
    return {
      portalId: 'uk-gov-visa',
      portalUrl: 'https://www.gov.uk/standard-visitor',
      assistedFill: false,
    };
  }
  programs(): VisaProgramStrategy[] {
    return [
      visitorVisaProgram('GB', {
        label: 'Standard Visitor Visa',
        compliance: this.compliance(),
      }),
      studentVisaProgram('GB', this.compliance()),
    ];
  }
}
