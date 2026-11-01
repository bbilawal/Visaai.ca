import { BaseCountryStrategy } from './base-country.strategy';
import type { ComplianceRequirement, PortalIntegration } from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';
import {
  complianceFor,
  RESIDENCY_BY_JURISDICTION,
} from '../compliance/compliance';
import { visitorVisaProgram } from '../visa-program/visitor-visa.strategy';
import { studentVisaProgram } from '../visa-program/student-visa.strategy';
import { businessVisaProgram } from '../visa-program/business-visa.strategy';

/** Australia — Visitor (subclass 600) and Student (subclass 500). */
export class AustraliaStrategy extends BaseCountryStrategy {
  readonly code = 'AU';
  readonly name = 'Australia';
  readonly dataResidency = RESIDENCY_BY_JURISDICTION.AU;

  compliance(): ComplianceRequirement[] {
    return complianceFor('AUS_PRIVACY_PRINCIPLES');
  }
  portal(): PortalIntegration {
    return {
      portalId: 'au-immiaccount',
      portalUrl: 'https://immi.homeaffairs.gov.au/',
      assistedFill: false,
    };
  }
  programs(): VisaProgramStrategy[] {
    return [
      visitorVisaProgram('AU', {
        label: 'Visitor visa (subclass 600)',
        compliance: this.compliance(),
        registryVisaaiIds: ['au-visitor-visa-subclass-600'],
      }),
      // COUNTRY-003: Australia was the only launch corridor registering a
      // single program. Subclass 500 is the Australian Student visa.
      studentVisaProgram(
        'AU',
        this.compliance(),
        'Student visa (subclass 500)',
        [],
        { registryVisaaiIds: ['au-student-visa-subclass-500'] },
      ),
      // Subclass 600, Business Visitor stream — the ONLY Australian route that
      // still publishes a downloadable blank form. The tourist stream's form
      // 1419 now returns 401 and the old student form 157A is gone: both moved
      // to ImmiAccount, which is why visitor_visa and student_visa above carry
      // no forms.
      //
      // The paper form is restricted-use. Home Affairs directs almost everyone
      // to apply online, so the restriction is stated in formName itself,
      // because formName is what the applicant actually reads in the UI — a
      // caveat kept only in a code comment would never reach them.
      //
      // sourceUrl is the PDF itself, not a landing page: Home Affairs form
      // URLs are stable and unversioned, and its forms index is JS-rendered
      // with no hrefs to discover. See au-home-affairs.discovery.ts.
      businessVisaProgram(
        'AU',
        this.compliance(),
        [
          {
            formCode: '1415',
            formName:
              'Visitor visa (subclass 600) — Business Visitor stream. ' +
              'Paper form: use only if Home Affairs has told you to apply on ' +
              'paper; otherwise apply online through ImmiAccount.',
            sourceUrl:
              'https://immi.homeaffairs.gov.au/form-listing/forms/1415.pdf',
          },
        ],
        ['au-visitor-visa-subclass-600-business-visitor-stream'],
      ),
    ];
  }
}
