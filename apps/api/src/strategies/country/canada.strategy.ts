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
import { etaProgram, CA_TRV_VISAAI_ID } from '../visa-program/eta.strategy';
import { expressEntryProgram } from '../visa-program/express-entry.strategy';
import { spousalSponsorshipProgram } from '../visa-program/spousal-sponsorship.strategy';
import {
  CA_EE_VISAAI_ID,
  CA_SPOUSAL_VISAAI_ID,
  CA_STUDY_VISAAI_ID,
  CA_WORK_VISAAI_ID,
} from '@visaai/types';
import { caStudyPermitOverrides } from '../visa-program/ca-study-permit';
import { caWorkPermitOverrides } from '../visa-program/ca-work-permit';
import { assessCaBusinessVisitorEligibility } from '../visa-program/ca-business-visitor-eligibility';
import { COMMON_DOCS } from '../document-requirements/common-documents';

/** `visa_types.visaai_id` of the Canada eTA route. */
export const CA_ETA_VISAAI_ID = 'ca-electronic-travel-authorization-eta';

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

  /**
   * An eTA is applied for on its own single-page form, not on IRCC tr-rt, so
   * its route fills a different portal; so do Express Entry, spousal
   * sponsorship, the study permit and the work permit (each its own branch
   * of the secure account's questionnaire). Every other route
   * keeps 'ircc'.
   */
  portalForRoute(visaaiId: string | null | undefined): PortalIntegration {
    if (visaaiId === CA_ETA_VISAAI_ID) {
      return {
        portalId: 'ircc-eta',
        portalUrl:
          'https://onlineservices-servicesenligne.cic.gc.ca/eta/welcome?lang=en',
        assistedFill: true,
      };
    }
    // Express Entry is a permanent-residence profile in the IRCC account,
    // not tr-rt: until its own mapping is recorded off the live form, it
    // fills nothing rather than tr-rt's visitor-visa answers (2026-10-19).
    if (visaaiId === CA_EE_VISAAI_ID) {
      return {
        portalId: 'ircc-ee',
        portalUrl: this.portal().portalUrl,
        assistedFill: false,
      };
    }
    // Spousal sponsorship is filed on the Permanent Residence Portal as two
    // applications (sponsor + principal applicant), not tr-rt. The assistant
    // fills the principal applicant's profile, IMM 0008 and the single-entry
    // parts of IMM 5406 / IMM 5669 (recorded live 2026-10-20:
    // portal-fills/canada-ircc-pr-family.ts). Launch starts at the portal's
    // own sign-in; the applicant creates the application themselves.
    if (visaaiId === CA_SPOUSAL_VISAAI_ID) {
      return {
        portalId: 'ircc-pr-family',
        portalUrl: 'https://prson-srpel.apps.cic.gc.ca/en/login',
        assistedFill: true,
      };
    }
    // A study permit from outside Canada is applied for in the IRCC secure
    // account (IMM 1294), not on tr-rt, since 2025-03-25: tr-rt hides
    // "study permit" for every new application. The assistant fills the
    // account's eligibility questionnaire (/eapp/eapp, recorded live
    // 2026-10-20: portal-fills/canada-ircc-study-eapp.ts) and stops at its
    // "Review your answers" page. Launch starts at the account sign-in.
    if (visaaiId === CA_STUDY_VISAAI_ID) {
      return {
        portalId: 'ircc-study',
        portalUrl: this.portal().portalUrl,
        assistedFill: true,
      };
    }
    // A new work permit from outside Canada is applied for in the IRCC
    // secure account ("Apply to come to Canada" -> questionnaire -> IMM
    // 1295), not on tr-rt, which lists only the H-1B holder work permit.
    // Without this case the route fell to 'ircc' and Launch would write
    // tr-rt's visitor-visa answers ("Visitor visa", 464) into a work permit.
    // The assistant fills the questionnaire's Work branch (recorded live
    // 2026-10-30: portal-fills/canada-ircc-work-eapp.ts; "Work" 7123, never
    // the study mapping's "Study") and stops at "Review your answers".
    if (visaaiId === CA_WORK_VISAAI_ID) {
      return {
        portalId: 'ircc-work',
        portalUrl: this.portal().portalUrl,
        assistedFill: true,
      };
    }
    return this.portal();
  }

  programs(): VisaProgramStrategy[] {
    return [
      visitorVisaProgram('CA', {
        label: 'Visitor Visa (TRV)',
        compliance: this.compliance(),
        forms: [IMM_5257],
        registryVisaaiIds: [CA_TRV_VISAAI_ID],
      }),
      familySponsorshipProgram('CA', {
        label: 'Super Visa (parents / grandparents)',
        compliance: this.compliance(),
        forms: [IMM_5257, IMM_5645],
        registryVisaaiIds: ['ca-super-visa'],
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
      businessVisaProgram(
        'CA',
        this.compliance(),
        [IMM_5257],
        ['ca-business-visitors'],
        // Visa-exempt nationals flying in need an eTA, not this visa.
        assessCaBusinessVisitorEligibility,
      ),
      studentVisaProgram(
        'CA',
        this.compliance(),
        'Study Permit',
        [IMM_1294],
        caStudyPermitOverrides('CA'),
      ),
      workPermitProgram(
        'CA',
        this.compliance(),
        [IMM_1295, IMM_5645],
        caWorkPermitOverrides('CA'),
      ),
      // Not a visa: an online pre-screen for visa-exempt travellers flying in.
      // Its own program so no stage mistakes it for the TRV (dry run 2026-10-16).
      etaProgram('CA', { compliance: this.compliance() }),
      // Permanent residence: CEC, FSW and FST share one profile.
      expressEntryProgram('CA', { compliance: this.compliance() }),
      // Permanent residence for a spouse, partner or dependent child; not the
      // Super Visa above, which is a parent's or grandparent's visit.
      spousalSponsorshipProgram('CA', { compliance: this.compliance() }),
    ];
  }
}
