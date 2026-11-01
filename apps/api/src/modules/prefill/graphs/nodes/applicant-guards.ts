import type { DocumentSubject } from './subject-attribution';

/** A document whose values must not fill applicant fields. */
export interface OtherPartyDocument {
  documentType: string;
  subject: Exclude<DocumentSubject, 'applicant'>;
  holderName: string | null;
  fields: Record<string, unknown>;
}

/**
 * Keys that describe a RELATED person, not the applicant — `son_employer_name`,
 * `other_son_annual_income_cad`, `sponsor_job_title`. These are where sponsor
 * evidence legitimately lands.
 */
const RELATED_PERSON_KEY =
  /^(son|other_son|youngest_son|eldest_son|daughter|other_daughter|child|children|spouse|partner|husband|wife|father|mother|parent|sibling|brother|sister|sponsor|host|inviter|family_member|accommodation|accommodation_provider|financial_support|financial_support_provider|guarantor|relative)_/;

const APPLICANT_EMPLOYMENT_KEY =
  /^(applicant_)?(current_|previous_|most_recent_|last_)?(job_title|occupation|position|employer|employer_name|employer_address|employment_start_date|employment_end_date|employment_address|monthly_income|annual_income|salary|monthly_salary|annual_salary|income)(_[a-z]{3})?$/;

/** Keys that describe a past job — still the applicant's own history if retired. */
const PAST_EMPLOYMENT_KEY = /^(applicant_)?(previous_|most_recent_|last_)/;

export function isApplicantEmploymentKey(key: string): boolean {
  if (RELATED_PERSON_KEY.test(key)) return false;
  return APPLICANT_EMPLOYMENT_KEY.test(key);
}

export function isOccupationKey(key: string): boolean {
  return /^(applicant_)?(current_)?occupation$/.test(key);
}

export function isRetiredProfile(profile: Record<string, unknown>): boolean {
  if (profile.retired === true || profile.retired === 'true') return true;
  for (const k of ['occupation', 'current_occupation', 'employment_status']) {
    const v = profile[k];
    if (typeof v === 'string' && /\bretired\b/i.test(v)) return true;
  }
  return false;
}

/**
 * A value reduced to what two documents would agree on: dates to ISO day,
 * numbers to digits, text to lowercase alphanumerics.
 */
export function comparableValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return '';
  const s = v.trim().replace(/[.\s]+$/, '');
  if (!s) return '';
  if (/^[\d,.\s]+$/.test(s)) return s.replace(/[,\s]/g, '').replace(/\.0+$/, '');
  if (/\b(1[89]|20)\d{2}\b/.test(s) && /[a-z]|\d[-/]\d/i.test(s)) {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : `${s} UTC`);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Every comparable value present in documents that are not the applicant's. */
export function otherPartyValueSet(docs: OtherPartyDocument[]): Set<string> {
  const out = new Set<string>();
  for (const d of docs) {
    for (const v of Object.values(d.fields)) {
      const c = comparableValue(v);
      if (c.length >= 3) out.add(c);
    }
  }
  return out;
}

/**
 * Remove applicant-employment facts the intake profile absorbed from somebody
 * else's document (prod: a retired father's profile held his son's
 * `job_title` and `employment_start_date`), and current-employment facts for a
 * retired applicant. Related-person keys are never touched.
 */
export function sanitizeProfile(
  profile: Record<string, unknown>,
  otherParty: OtherPartyDocument[],
): { profile: Record<string, unknown>; removed: string[] } {
  const foreign = otherPartyValueSet(otherParty);
  const retired = isRetiredProfile(profile);
  const clean: Record<string, unknown> = {};
  const removed: string[] = [];

  for (const [k, v] of Object.entries(profile)) {
    if (isApplicantEmploymentKey(k)) {
      const contaminated = foreign.has(comparableValue(v));
      const currentJobWhileRetired =
        retired && !PAST_EMPLOYMENT_KEY.test(k) && !isOccupationKey(k);
      if (contaminated || currentJobWhileRetired) {
        removed.push(k);
        continue;
      }
    }
    clean[k] = v;
  }
  return { profile: clean, removed };
}
