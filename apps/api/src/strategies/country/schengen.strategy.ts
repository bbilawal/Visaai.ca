import { BaseCountryStrategy } from './base-country.strategy';
import type { ComplianceRequirement, PortalIntegration } from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';
import {
  complianceFor,
  RESIDENCY_BY_JURISDICTION,
} from '../compliance/compliance';
import { touristVisaProgram } from '../visa-program/tourist-visa.strategy';
import { businessVisaProgram } from '../visa-program/business-visa.strategy';

/**
 * Schengen area (stub: Type C short-stay). Modeled as a single strategy because
 * the visa is area-wide; the specific member state of application is metadata.
 */
export class SchengenStrategy extends BaseCountryStrategy {
  readonly code = 'SCHENGEN';
  readonly name = 'Schengen Area';
  readonly selectable = false; // keep registered & resolvable, hide from picker
  readonly dataResidency = RESIDENCY_BY_JURISDICTION.EU;

  compliance(): ComplianceRequirement[] {
    return complianceFor('GDPR');
  }
  portal(): PortalIntegration {
    // Submission is via the relevant member-state consulate/VFS, not one portal.
    return {
      portalId: 'schengen-consulate',
      portalUrl: 'https://www.schengenvisainfo.com/',
      assistedFill: false,
    };
  }
  programs(): VisaProgramStrategy[] {
    return [
      touristVisaProgram('SCHENGEN', this.compliance()),
      businessVisaProgram('SCHENGEN', this.compliance()),
    ];
  }
}
