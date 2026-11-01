import type {
  CountryCode,
  VisaProgramId,
  ComplianceRequirement,
  DocumentRequirement,
  FormSpec,
} from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { visitorVisaProgram } from './visitor-visa.strategy';
import { touristVisaProgram } from './tourist-visa.strategy';
import { businessVisaProgram } from './business-visa.strategy';
import { studentVisaProgram } from './student-visa.strategy';
import { workPermitProgram } from './work-permit.strategy';
import { familySponsorshipProgram } from './family-sponsorship.strategy';
import { etaProgram } from './eta.strategy';
import { expressEntryProgram } from './express-entry.strategy';
import { spousalSponsorshipProgram } from './spousal-sponsorship.strategy';

export interface ProgramBuildOpts {
  label?: string;
  compliance?: ComplianceRequirement[];
  extraDocuments?: DocumentRequirement[];
  forms?: FormSpec[];
}

type ProgramBuilder = (
  country: CountryCode,
  opts: ProgramBuildOpts,
) => VisaProgramStrategy;

/**
 * Registry of generic visa-program TYPES. A country composes its programs by
 * building from these (resolve: program id → builder → strategy). Adding a new
 * program type = register a builder; countries reference it by id.
 */
export class VisaProgramRegistry {
  private builders = new Map<VisaProgramId, ProgramBuilder>();

  register(id: VisaProgramId, builder: ProgramBuilder): void {
    this.builders.set(id, builder);
  }
  has(id: VisaProgramId): boolean {
    return this.builders.has(id);
  }
  build(
    id: VisaProgramId,
    country: CountryCode,
    opts: ProgramBuildOpts = {},
  ): VisaProgramStrategy {
    const b = this.builders.get(id);
    if (!b) throw new Error(`Unknown visa program: ${id}`);
    return b(country, opts);
  }
  list(): VisaProgramId[] {
    return [...this.builders.keys()];
  }
}

export const visaProgramRegistry = new VisaProgramRegistry();

// Built-in program types. Compliance-only builders are adapted to the unified opts.
visaProgramRegistry.register('visitor_visa', (c, o) =>
  visitorVisaProgram(c, o),
);
visaProgramRegistry.register('family_sponsorship', (c, o) =>
  familySponsorshipProgram(c, o),
);
visaProgramRegistry.register('tourist_visa', (c, o) =>
  touristVisaProgram(c, o.compliance ?? []),
);
visaProgramRegistry.register('business_visa', (c, o) =>
  businessVisaProgram(c, o.compliance ?? []),
);
visaProgramRegistry.register('student_visa', (c, o) =>
  studentVisaProgram(c, o.compliance ?? []),
);
visaProgramRegistry.register('work_permit', (c, o) =>
  workPermitProgram(c, o.compliance ?? []),
);
visaProgramRegistry.register('eta', (c, o) =>
  etaProgram(c, { label: o.label, compliance: o.compliance }),
);
visaProgramRegistry.register('express_entry', (c, o) =>
  expressEntryProgram(c, { label: o.label, compliance: o.compliance }),
);
visaProgramRegistry.register('spousal_sponsorship', (c, o) =>
  spousalSponsorshipProgram(c, { label: o.label, compliance: o.compliance }),
);
