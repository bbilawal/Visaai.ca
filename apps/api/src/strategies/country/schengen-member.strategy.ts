import { BaseCountryStrategy } from './base-country.strategy';
import type {
  ComplianceRequirement,
  PortalIntegration,
  CountryCode,
} from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';
import {
  complianceFor,
  RESIDENCY_BY_JURISDICTION,
} from '../compliance/compliance';
import { touristVisaProgram } from '../visa-program/tourist-visa.strategy';
import { businessVisaProgram } from '../visa-program/business-visa.strategy';
import { SCHENGEN_FORMS } from './schengen-forms';

/**
 * A single Schengen member state. Selectable in the UI. All immigration logic is
 * shared & identical to the area-wide SchengenStrategy (Type C short-stay):
 * GDPR, EU data residency, member-consulate portal (no assisted fill), tourist +
 * business Type C programs. The specific member is the destination of record;
 * the programs are still passed THIS member's code so program.country is correct.
 */
export class SchengenMemberStrategy extends BaseCountryStrategy {
  readonly selectable = true;
  readonly dataResidency = RESIDENCY_BY_JURISDICTION.EU;

  constructor(
    readonly code: CountryCode, // ISO-2, e.g. 'DE'
    readonly name: string, // e.g. 'Germany'
  ) {
    super();
  }

  compliance(): ComplianceRequirement[] {
    return complianceFor('GDPR');
  }
  portal(): PortalIntegration {
    return {
      portalId: 'schengen-consulate',
      portalUrl: 'https://www.schengenvisainfo.com/',
      assistedFill: false,
    };
  }
  programs(): VisaProgramStrategy[] {
    return [
      touristVisaProgram(this.code, this.compliance(), SCHENGEN_FORMS),
      businessVisaProgram(this.code, this.compliance(), SCHENGEN_FORMS),
    ];
  }
}
