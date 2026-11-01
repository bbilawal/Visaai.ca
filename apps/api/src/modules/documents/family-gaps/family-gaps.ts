import {
  DEFAULT_FAMILY_GUIDANCE,
  FAMILY_DOCUMENT_GAP_ROUTES,
  ISSUING_COUNTRY_GUIDANCE,
  type FamilyDocumentGapRoute,
  type IssuingCountryGuidance,
} from '../../../strategies/document-requirements/family-document-gaps.config';
import { parseCivilDate } from '../ocr/civil-records';
import {
  CONSISTENCY_FLAGS_KEY,
  childrenOf,
  spouseNameOf,
} from '../graphs/nodes/sync-family';
import {
  isRemovedChild,
  isSamePerson,
  normalizePersonName,
  personName,
} from '../../shared/profile/family-members';

/**
 * Family facts the official form needs but the profile does not have, as the
 * checklist items that would supply them.
 *
 * Dry run 2026-10-15 (Canada visitor visa, Pakistani applicant): IRCC asks for
 * the spouse's and every child's date of birth, and VisaAI reads them from
 * civil documents. A document the client never uploaded used to leave the
 * field empty without anyone being asked for it. Owner's rule: a document the
 * client has not provided is a MISSING document, requested on the checklist.
 *
 *  - a child (in `children`, or named by intake as `youngest_son_name`, …)
 *    without a full date of birth → "Birth certificate — <child>";
 *  - a named spouse without a date of birth → "National ID card or passport —
 *    <spouse>", the spouse's own document, uploaded alone;
 *  - a married applicant without a marriage date, or whose marriage date is
 *    flagged by the cross-document check → the marriage certificate, marked
 *    needs-attention with the flag's message.
 *
 * Only for routes listed in FAMILY_DOCUMENT_GAP_ROUTES. Pure: no I/O — the
 * checklist rows are written by family-gaps.sync.ts.
 */

/** `added_reason` prefix of every row this module owns. */
export const FAMILY_GAP_REASON_PREFIX = 'family_gap';

export interface FamilyGapMeta {
  kind: 'document';
  owner: 'applicant';
  family_gap: { key: string; person?: string };
  needs_attention?: true;
  attention_message?: string;
  specs: { source: string; format?: string; notes: string };
  [k: string]: unknown;
}

export interface FamilyGapItem {
  /** Identity of the gap across runs: `child:<name>`, `spouse`, `marriage`. */
  key: string;
  document_type: string;
  label: string;
  required: true;
  added_reason: string;
  meta: FamilyGapMeta;
}

export function isFamilyGapItem(row: {
  added_reason?: string | null;
}): boolean {
  return (row.added_reason ?? '').startsWith(`${FAMILY_GAP_REASON_PREFIX}:`);
}

/** The configured route a registry visa type belongs to, or null. */
export function familyGapRouteFor(
  visaaiId: string | null | undefined,
  routes: FamilyDocumentGapRoute[] = FAMILY_DOCUMENT_GAP_ROUTES,
): FamilyDocumentGapRoute | null {
  const id = (visaaiId ?? '').toLowerCase().trim();
  if (!id) return null;
  return (
    routes.find((r) =>
      r.visaaiIdPrefixes.some((p) => id === p || id.startsWith(`${p}-`)),
    ) ?? null
  );
}

// ─── Profile reading ─────────────────────────────────────────────────────────

type Profile = Record<string, unknown>;
type Person = Record<string, unknown>;

const DOB_KEYS = ['date_of_birth', 'dob', 'birth_date', 'birthdate'];

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** A full calendar date (day, month and year) — a year or an age is not. */
function isFullDate(v: unknown): boolean {
  return !!parseCivilDate(v, { dayFirst: true });
}

function personHasDob(p: Person): boolean {
  return DOB_KEYS.some((k) => isFullDate(p[k]));
}

/**
 * Intake names children under prefixed keys: `youngest_son_name`,
 * `eldest_daughter_full_name`, `child_2_name`. The role word must be its own
 * token, so `grandson_name` and `person_name` are not children.
 */
const CHILD_NAME_KEY =
  /^((?:[a-z]+_)*?(?:son|daughter|child)(?:_\d+)?)_(?:full_)?name$/;
const NOT_A_CHILD_PREFIX =
  /(?:^|_)(?:sponsor|host|inviter|employer|contact|guarantor|spouse|partner|father|mother|parent|sibling|brother|sister)(?:_|$)/;

interface ChildRef {
  name: string;
  hasDob: boolean;
  countryOfBirth?: string;
}

function familyChildren(profile: Profile): ChildRef[] {
  const out: ChildRef[] = [];
  const add = (ref: ChildRef) => {
    if (isRemovedChild(profile, ref.name)) return;
    const same = out.find((c) => isSamePerson(c.name, ref.name));
    if (same) {
      same.hasDob ||= ref.hasDob;
      same.countryOfBirth ??= ref.countryOfBirth;
      return;
    }
    out.push(ref);
  };

  for (const child of childrenOf(profile)) {
    const name = personName(child);
    if (!name.trim()) continue;
    add({
      name: name.trim(),
      hasDob: personHasDob(child),
      countryOfBirth: str(child.country_of_birth) ?? str(child.birth_country),
    });
  }

  for (const [key, value] of Object.entries(profile)) {
    const m = CHILD_NAME_KEY.exec(key);
    const name = str(value);
    if (!m || !name || NOT_A_CHILD_PREFIX.test(m[1])) continue;
    const prefix = m[1];
    add({
      name,
      hasDob: DOB_KEYS.some((k) => isFullDate(profile[`${prefix}_${k}`])),
      countryOfBirth: str(profile[`${prefix}_country_of_birth`]),
    });
  }
  return out;
}

function spouseHasDob(profile: Profile): boolean {
  if (
    ['spouse_date_of_birth', 'spouse_dob', 'spouse_birth_date'].some((k) =>
      isFullDate(profile[k]),
    )
  ) {
    return true;
  }
  const spouse = profile.spouse;
  return (
    !!spouse &&
    typeof spouse === 'object' &&
    !Array.isArray(spouse) &&
    personHasDob(spouse as Person)
  );
}

const NOT_MARRIED =
  /\b(?:single|never|unmarried|divorc\w*|widow\w*|separated|annulled)\b/i;

function maritalStatus(profile: Profile): string {
  return str(profile.marital_status) ?? str(profile.civil_status) ?? '';
}

interface MarriageFlag {
  code?: string;
  field?: string;
  message?: string;
}

function marriageFlags(profile: Profile): MarriageFlag[] {
  const raw = profile[CONSISTENCY_FLAGS_KEY];
  if (!Array.isArray(raw)) return [];
  return (raw as MarriageFlag[]).filter(
    (f) => !!f && typeof f === 'object' && f.field === 'marriage_date',
  );
}

function guidanceFor(
  ...candidates: Array<string | undefined>
): IssuingCountryGuidance | null {
  for (const c of candidates) {
    const v = (c ?? '').toLowerCase().trim();
    if (!v) continue;
    const hit = ISSUING_COUNTRY_GUIDANCE.find(
      (g) => g.code.toLowerCase() === v || g.names.includes(v),
    );
    if (hit) return hit;
  }
  return null;
}

/** The applicant's own country, as the default issuer of family documents. */
function homeCountries(profile: Profile): Array<string | undefined> {
  return [
    str(profile.country_of_birth),
    str(profile.nationality),
    str(profile.citizenship),
    str(profile.country_of_citizenship),
    str(profile.country_of_residence),
    str(profile.current_country),
  ];
}

// ─── Gaps ────────────────────────────────────────────────────────────────────

const FORMAT = 'Clear colour scan or photo of the whole document, PDF or JPG';

export function familyDocumentGaps(
  profile: Profile,
  route: FamilyDocumentGapRoute,
): FamilyGapItem[] {
  const items: FamilyGapItem[] = [];
  const home = homeCountries(profile);
  const status = maritalStatus(profile);
  const notMarried = NOT_MARRIED.test(status);

  for (const child of familyChildren(profile)) {
    if (child.hasDob) continue;
    const g = guidanceFor(child.countryOfBirth, ...home);
    const key = `child:${normalizePersonName(child.name)}`;
    items.push({
      key,
      document_type: 'birth_certificate',
      label: `Birth certificate — ${child.name}`,
      required: true,
      added_reason: `${FAMILY_GAP_REASON_PREFIX}:child_date_of_birth`,
      meta: {
        kind: 'document',
        owner: 'applicant',
        family_gap: { key, person: child.name },
        specs: {
          source:
            g?.birthCertificate ?? DEFAULT_FAMILY_GUIDANCE.birthCertificate,
          format: FORMAT,
          notes: `${route.formSection} We do not have ${child.name}'s full date of birth yet.`,
        },
      },
    });
  }

  if (notMarried) return items;

  const spouse = spouseNameOf(profile);
  const g = guidanceFor(...home);
  if (spouse && !spouseHasDob(profile)) {
    items.push({
      key: 'spouse',
      document_type: 'spouse_national_id',
      label: `National ID card or passport — ${spouse}`,
      required: true,
      added_reason: `${FAMILY_GAP_REASON_PREFIX}:spouse_date_of_birth`,
      meta: {
        kind: 'document',
        owner: 'applicant',
        family_gap: { key: 'spouse', person: spouse },
        specs: {
          source: g?.spouseIdentity ?? DEFAULT_FAMILY_GUIDANCE.spouseIdentity,
          format: FORMAT,
          notes:
            `${route.formSection} Upload ${spouse}'s own card or passport alone, ` +
            'as a separate file — not combined with your own card in one scan.',
        },
      },
    });
  }

  const married =
    !!spouse || (/\bmarried\b/i.test(status) && !/common/i.test(status));
  if (!married) return items;

  const flags = marriageFlags(profile);
  const hasDate = isFullDate(profile.marriage_date);
  if (hasDate && flags.length === 0) return items;

  const name = g?.marriageCertificateName;
  const flagged = flags.length > 0;
  items.push({
    key: 'marriage',
    document_type: 'marriage_certificate',
    label: name ? `Marriage certificate (${name})` : 'Marriage certificate',
    required: true,
    added_reason: `${FAMILY_GAP_REASON_PREFIX}:${flagged ? 'marriage_flagged' : 'marriage_date'}`,
    meta: {
      kind: 'document',
      owner: 'applicant',
      family_gap: { key: 'marriage' },
      ...(flagged
        ? {
            needs_attention: true as const,
            attention_message: flags
              .map((f) => f.message)
              .filter((m): m is string => !!m)
              .join(' '),
          }
        : {}),
      specs: {
        source:
          g?.marriageCertificate ?? DEFAULT_FAMILY_GUIDANCE.marriageCertificate,
        format: FORMAT,
        notes: flagged
          ? 'The marriage date we have does not agree with your other documents. Upload a clear copy of the certificate so the date can be checked.'
          : 'IRCC asks for the date of your marriage. We do not have it yet.',
      },
    },
  });
  return items;
}
