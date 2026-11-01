import { BaseCountryStrategy } from './base-country.strategy';
import type { ComplianceRequirement, PortalIntegration } from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';
import {
  complianceFor,
  RESIDENCY_BY_JURISDICTION,
} from '../compliance/compliance';
import { visitorVisaProgram } from '../visa-program/visitor-visa.strategy';
import { familySponsorshipProgram } from '../visa-program/family-sponsorship.strategy';
import { businessVisaProgram } from '../visa-program/business-visa.strategy';
import { studentVisaProgram } from '../visa-program/student-visa.strategy';
import { workPermitProgram } from '../visa-program/work-permit.strategy';
import { COMMON_DOCS } from '../document-requirements/common-documents';

/** IRCC landing pages. Stable; the PDF they link to is versioned by date. */
const GUIDES =
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides';

const IMM_5257 = {
  formCode: 'IMM 5257',
  formName: 'Application for Temporary Resident Visa',
  sourceUrl: `${GUIDES}/imm5257.html`,
};
const IMM_5645 = {
  formCode: 'IMM 5645',
  formName: 'Family Information',
  sourceUrl: `${GUIDES}/imm5645.html`,
};
const IMM_1294 = {
  formCode: 'IMM 1294',
  formName: 'Application for Study Permit Made Outside of Canada',
  sourceUrl: `${GUIDES}/imm1294.html`,
};
const IMM_1295 = {
  formCode: 'IMM 1295',
  formName: 'Application for Work Permit Made Outside of Canada',
  sourceUrl: `${GUIDES}/imm1295.html`,
};

/**
 * Canada — the reference country strategy. The two launch corridors (TRV +
 * Super Visa) are configurations of the generic visitor / family-sponsorship
 * programs, not bespoke code paths.
 */
export class CanadaStrategy extends BaseCountryStrategy {
  readonly code = 'CA';
  readonly name = 'Canada';
  readonly dataResidency = RESIDENCY_BY_JURISDICTION.CA;

  compliance(): ComplianceRequirement[] {
    return complianceFor('PIPEDA');
  }

  portal(): PortalIntegration {
    return {
      portalId: 'ircc',
      portalUrl:
        'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/account.html',
      assistedFill: true,
    };
  }

  programs(): VisaProgramStrategy[] {
    return [
      visitorVisaProgram('CA', {
        label: 'Visitor Visa (TRV)',
        compliance: this.compliance(),
        forms: [IMM_5257],
      }),
      familySponsorshipProgram('CA', {
        label: 'Super Visa (parents / grandparents)',
        compliance: this.compliance(),
        forms: [IMM_5257, IMM_5645],
        extraDocuments: [
          { ...COMMON_DOCS.medical_insurance, required: true },
          {
            code: 'sponsor_income',
            label: "Sponsor's proof of income (meets LICO)",
            required: true,
            ownedBy: 'sponsor',
          },
        ],
      }),
      // A business visitor enters on the same TRV as a tourist — same form.
      businessVisaProgram('CA', this.compliance(), [IMM_5257]),
      studentVisaProgram('CA', this.compliance(), 'Study Permit', [IMM_1294]),
      workPermitProgram('CA', this.compliance(), [IMM_1295]),
    ];
  }
}
