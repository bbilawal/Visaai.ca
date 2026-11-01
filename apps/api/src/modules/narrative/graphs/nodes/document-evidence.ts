import { plannedStay } from '@visaai/types';
import {
  choosePolicy,
  policyDate,
  readPolicy,
} from '../../../shared/profile/insurance-policy';

export { policyDate };

/**
 * What the applicant's VERIFIED documents say, for the letters.
 *
 * The letters were written from the profile alone, and the profile can be
 * wrong in ways the documents are not (dry run 2026-10-16): a host document
 * had overwritten the applicant's name, so the letters were signed with the
 * host's name; and the profile said "insured for 12 months" while the
 * uploaded policy had expired before the trip begins. Where a read document
 * answers the question, it outranks the profile.
 */

export interface VerificationRow {
  document_type: string | null;
  verification_type: string;
  result: string;
  details_json: Record<string, unknown> | null;
}

export interface InsuranceEvidence {
  insurer: string | null;
  policyNumber: string | null;
  coverageAmount: number | null;
  /** YYYY-MM-DD */
  start: string | null;
  /** YYYY-MM-DD */
  end: string | null;
  /** null when the policy dates or the stay dates are unknown. */
  coversStay: boolean | null;
}

export interface NarrativeEvidence {
  /** The applicant's name as their own passport prints it, title-cased. */
  applicantName: string | null;
  insurance: InsuranceEvidence | null;
  stay: { entryDate: string | null; departureDate: string | null };
}

function fields(row: VerificationRow): Record<string, unknown> {
  const f = (row.details_json ?? {}).extracted_fields;
  return f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const normNo = (v: unknown) =>
  typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() : '';

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(
      /(^|[\s'-])(\p{L})/gu,
      (_m, sep: string, c: string) => sep + c.toUpperCase(),
    );
}

export function narrativeEvidence(
  profile: Record<string, unknown>,
  rows: VerificationRow[],
): NarrativeEvidence {
  const stay = plannedStay(profile);
  const identity = rows.filter(
    (r) => r.verification_type === 'identity' && r.result !== 'fail',
  );

  // The applicant's passport: the one whose number the profile holds; with
  // no number on the profile, the only passport there is.
  const passports = identity.filter((r) => r.document_type === 'passport');
  const wanted = normNo(profile.passport_number);
  const own = wanted
    ? passports.find((r) => normNo(fields(r).passport_number) === wanted)
    : passports.length === 1
      ? passports[0]
      : undefined;
  const passportName = own ? str(fields(own).full_name) : null;

  // Of several uploaded policies, the one that covers the stay (prod
  // 2026-10-16: an expired policy uploaded first hid the covering one).
  const chosen = choosePolicy(
    identity
      .filter((r) => /insurance/.test(r.document_type ?? ''))
      .map((r) => readPolicy(fields(r), stay)),
  );
  const insurance: InsuranceEvidence | null = chosen
    ? {
        insurer: chosen.insurer,
        policyNumber: chosen.policyNumber,
        coverageAmount: chosen.coverageAmount,
        start: chosen.start,
        end: chosen.end,
        coversStay: chosen.coversStay,
      }
    : null;

  return {
    applicantName: passportName ? titleCase(passportName) : null,
    insurance,
    stay: { entryDate: stay.entryDate, departureDate: stay.departureDate },
  };
}

/** Prompt lines stating what the documents establish, or '' when nothing. */
export function evidenceDirective(
  e: NarrativeEvidence | null | undefined,
): string {
  if (!e) return '';
  const lines: string[] = [];
  if (e.applicantName) {
    lines.push(
      `- The applicant's name, from their own verified passport, is ${e.applicantName}. Name the applicant and sign the applicant's letters exactly as "${e.applicantName}"; ignore any other name the profile gives for the applicant.`,
    );
  }
  const ins = e.insurance;
  if (ins) {
    const desc = [
      ins.insurer,
      ins.policyNumber ? `policy ${ins.policyNumber}` : null,
      ins.coverageAmount !== null
        ? `cover ${ins.coverageAmount.toLocaleString('en-US')}`
        : null,
      ins.start || ins.end
        ? `valid ${ins.start ?? '?'} to ${ins.end ?? '?'}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');
    if (ins.coversStay === false) {
      const span =
        e.stay.entryDate && e.stay.departureDate
          ? `${e.stay.entryDate} to ${e.stay.departureDate}`
          : 'the stay';
      lines.push(
        `- The uploaded medical insurance policy (${desc}) does NOT cover the planned stay. Never state or imply that the applicant holds insurance for the stay; where the letter needs it, write the placeholder "[medical insurance policy covering ${span} — to be provided]".`,
      );
    } else if (ins.coversStay === true) {
      lines.push(
        `- Medical insurance (verified document): ${desc}; it covers the planned stay.`,
      );
    } else if (desc) {
      lines.push(
        `- An insurance policy was uploaded (${desc}), but whether it covers the stay could not be checked; do not claim coverage dates it does not show.`,
      );
    }
  }
  if (lines.length === 0) return '';
  return `\n\nFROM THE APPLICANT'S VERIFIED DOCUMENTS (these outrank the profile):\n${lines.join('\n')}`;
}
