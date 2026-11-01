import type { ExtractedFields } from '../document.state';
import {
  civilRecordKind,
  parseBirthCertificates,
  parseCivilDate,
  type BirthRecord,
} from '../../ocr/civil-records';
import { resolveExtractionType } from '../../ocr/extraction-schema';
import { relativeFromIdCardText } from './classify-document';
import {
  findByName,
  isPeopleList,
  isSamePerson,
  peopleInProfile,
  personName,
} from '../../../shared/profile/family-members';

/**
 * Family documents → the applicant profile's family section.
 *
 * Dry run 2026-10-15 (Canada visitor visa, Pakistani parent): the children's
 * birth certificates and the nikah nama were uploaded, and none of it reached
 * the profile IRCC's family pages are filled from — no child's date of birth,
 * and a marriage date ("16-9-1999") that contradicted the certificate.
 *
 * Worse, the generic identity merge in sync_profile would have filled the
 * APPLICANT's date of birth, father's and mother's names from a CHILD's birth
 * certificate, and the applicant's date of birth from the SPOUSE's CNIC, on any
 * profile that had not answered them yet. A family document describes somebody
 * else; this module decides who, and routes its facts there:
 *
 *  - birth certificate whose father or mother is the applicant (or the
 *    spouse) → a child in `children`, merged BY NAME with what intake has;
 *    one whose parents are someone else (a grandchild's, a daughter-in-law's)
 *    is not the applicant's child and adds nothing;
 *  - the applicant's own birth certificate → the applicant's own fields;
 *  - marriage certificate the applicant is a party to → `marriage_date` and
 *    `spouse_name`;
 *  - the spouse's national ID → `spouse_date_of_birth`.
 *
 * sync_profile's rules hold here too: a document only fills gaps, never
 * overwrites what the applicant said. The single exception is `marriage_date`
 * when the value already there came from a document (provenance in
 * `_document_sources`, or a value an earlier extraction produced) — a
 * corrected read of a certificate may replace an earlier misread of it, but
 * never an applicant's own answer.
 *
 * Pure: no I/O.
 */

/** Profile key holding per-field provenance for document-written values. */
export const DOCUMENT_SOURCES_KEY = '_document_sources';
/** Profile key holding cross-document consistency flags for review. */
export const CONSISTENCY_FLAGS_KEY = 'document_consistency_flags';

/** Fields a later document may correct when the current value is a document's. */
const DOCUMENT_CORRECTABLE = new Set(['marriage_date']);

export interface DocumentSource {
  document_id: string;
  document_type: string;
  value: unknown;
}

export interface FamilyMergeInput {
  profile: Record<string, unknown>;
  documentId: string;
  documentType: string;
  rawText: string;
  extracted: ExtractedFields;
  /**
   * marriage_date values earlier document extractions on this application
   * produced. Profiles written before provenance existed have no
   * `_document_sources`; a value equal to one of these came from a document.
   */
  priorDocumentMarriageDates?: string[];
}

export interface FamilyMergeResult {
  /** True when the document is about family: the generic identity merge must not run. */
  handled: boolean;
  next: Record<string, unknown>;
  added: string[];
  skipped: string[];
  /** Human-readable decisions, for the log. */
  notes: string[];
}

type Person = Record<string, unknown>;

function hasAnswer(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function digits(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : '';
}

export function applicantNameOf(
  profile: Record<string, unknown>,
): string | undefined {
  for (const k of [
    'full_name',
    'applicant_name',
    'name',
    'applicant_full_name',
  ]) {
    const v = str(profile[k]);
    if (v) return v;
  }
  const given = str(profile.given_name) ?? str(profile.first_name);
  const family =
    str(profile.family_name) ?? str(profile.last_name) ?? str(profile.surname);
  return given || family
    ? [given, family].filter(Boolean).join(' ')
    : undefined;
}

export function spouseNameOf(
  profile: Record<string, unknown>,
): string | undefined {
  for (const k of [
    'spouse_name',
    'spouse_full_name',
    'partner_name',
    'husband_name',
    'wife_name',
  ]) {
    const v = str(profile[k]);
    if (v) return v;
  }
  const spouse = profile.spouse;
  if (spouse && typeof spouse === 'object' && !Array.isArray(spouse)) {
    const n = personName(spouse as Person);
    if (n) return n;
  }
  return undefined;
}

function applicantIdOf(profile: Record<string, unknown>): string {
  for (const k of [
    'national_id_number',
    'national_id',
    'cnic',
    'cnic_number',
  ]) {
    const d = digits(profile[k]);
    if (d.length >= 9) return d;
  }
  return '';
}

function spouseIdOf(profile: Record<string, unknown>): string {
  for (const k of [
    'spouse_national_id_number',
    'spouse_cnic',
    'spouse_national_id',
  ]) {
    const d = digits(profile[k]);
    if (d.length >= 9) return d;
  }
  return '';
}

class ProfileWriter {
  readonly next: Record<string, unknown>;
  readonly added: string[] = [];
  readonly skipped: string[] = [];
  readonly notes: string[] = [];
  private sources: Record<string, DocumentSource>;

  constructor(
    profile: Record<string, unknown>,
    private readonly doc: { id: string; type: string },
  ) {
    // Deep copy: people lists are mutated in place below.
    this.next = JSON.parse(JSON.stringify(profile ?? {})) as Record<
      string,
      unknown
    >;
    const raw = this.next[DOCUMENT_SOURCES_KEY];
    this.sources =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, DocumentSource>)
        : {};
  }

  /** Gap-fill one top-level key, recording that a document wrote it. */
  fill(key: string, value: unknown) {
    if (!hasAnswer(value)) return;
    if (hasAnswer(this.next[key])) {
      if (this.next[key] !== value) this.skipped.push(key);
      return;
    }
    this.write(key, value);
  }

  /**
   * Replace a value only when the current one came from a document. An
   * applicant's own answer is never replaced.
   */
  correct(key: string, value: unknown, priorDocumentValues: string[] = []) {
    if (!hasAnswer(value)) return;
    const current = this.next[key];
    if (!hasAnswer(current)) {
      this.write(key, value);
      return;
    }
    if (current === value) return;
    const src = this.sources[key];
    const fromDocument =
      DOCUMENT_CORRECTABLE.has(key) &&
      ((src && src.value === current) ||
        (typeof current === 'string' && priorDocumentValues.includes(current)));
    if (!fromDocument) {
      this.skipped.push(key);
      this.notes.push(`${key}: kept the applicant's answer`);
      return;
    }
    this.notes.push(
      `${key}: replaced the earlier document read "${String(current)}" with "${String(value)}"`,
    );
    this.write(key, value);
  }

  private write(key: string, value: unknown) {
    this.next[key] = value;
    this.sources[key] = {
      document_id: this.doc.id,
      document_type: this.doc.type,
      value,
    };
    this.next[DOCUMENT_SOURCES_KEY] = this.sources;
    this.added.push(key);
  }

  noteAdded(label: string) {
    this.added.push(label);
  }
}

// ─── Children ────────────────────────────────────────────────────────────────

/** Child attribute → the keys intake may already hold it under. */
const CHILD_ATTR_ALIASES: Record<string, string[]> = {
  date_of_birth: ['date_of_birth', 'dob', 'birth_date', 'birthdate'],
  sex: ['sex', 'gender'],
  relationship: ['relationship', 'relation'],
  country_of_birth: ['country_of_birth', 'birth_country'],
  place_of_birth: ['place_of_birth', 'birth_place', 'city_of_birth'],
  given_name: ['given_name', 'given_names', 'first_name'],
  family_name: ['family_name', 'surname', 'last_name'],
};

function childFromRecord(rec: BirthRecord): Person {
  const relationship =
    rec.sex === 'Male'
      ? 'son'
      : rec.sex === 'Female'
        ? 'daughter'
        : (rec.relation ?? 'child');
  const child: Person = { name: rec.full_name };
  if (rec.given_name) child.given_name = rec.given_name;
  if (rec.family_name) child.family_name = rec.family_name;
  if (rec.date_of_birth) child.date_of_birth = rec.date_of_birth;
  if (rec.sex) child.sex = rec.sex;
  child.relationship = relationship;
  if (rec.country_of_birth) child.country_of_birth = rec.country_of_birth;
  if (rec.place_of_birth) child.place_of_birth = rec.place_of_birth;
  return child;
}

/** Fill a known child's missing attributes. Never overwrites intake. */
function enrichChild(target: Person, from: Person): string[] {
  const filled: string[] = [];
  for (const [attr, value] of Object.entries(from)) {
    if (attr === 'name' || !hasAnswer(value)) continue;
    const aliases = CHILD_ATTR_ALIASES[attr] ?? [attr];
    if (aliases.some((a) => hasAnswer(target[a]))) continue;
    target[attr] = value;
    filled.push(attr);
  }
  return filled;
}

/** The list new children are appended to. */
function childrenList(next: Record<string, unknown>): Person[] {
  const current = next.children;
  if (
    Array.isArray(current) &&
    current.every((c) => c && typeof c === 'object' && !Array.isArray(c))
  ) {
    return current as Person[];
  }
  if (
    current === undefined ||
    current === null ||
    (Array.isArray(current) && current.length === 0)
  ) {
    next.children = [];
    return next.children as Person[];
  }
  // `children` holds something else (a count, a sentence): never clobber it.
  const side = next.children_details;
  if (isPeopleList(side) || Array.isArray(side)) return side as Person[];
  next.children_details = [];
  return next.children_details as Person[];
}

type ParentMatch = 'applicant' | 'spouse' | 'none' | 'unknown';

function parentMatch(
  rec: BirthRecord,
  profile: Record<string, unknown>,
): ParentMatch {
  const applicant = applicantNameOf(profile);
  const spouse = spouseNameOf(profile);
  const applicantId = applicantIdOf(profile);
  const spouseId = spouseIdOf(profile);
  const parents = [rec.father_name, rec.mother_name].filter(
    Boolean,
  ) as string[];
  const parentIds = [rec.father_national_id, rec.mother_national_id]
    .map(digits)
    .filter((d) => d.length >= 9);

  if (
    (applicant && parents.some((p) => isSamePerson(p, applicant))) ||
    (applicantId && parentIds.includes(applicantId))
  ) {
    return 'applicant';
  }
  if (
    (spouse && parents.some((p) => isSamePerson(p, spouse))) ||
    (spouseId && parentIds.includes(spouseId))
  ) {
    return 'spouse';
  }
  if (parents.length === 0 && parentIds.length === 0) return 'unknown';
  // Parents are printed. Without anything to compare them to we cannot say
  // whose child this is.
  if (!applicant && !spouse && !applicantId && !spouseId) return 'unknown';
  return 'none';
}

function mergeBirthCertificate(input: FamilyMergeInput, w: ProfileWriter) {
  let records = parseBirthCertificates(input.rawText);
  if (records.length === 0) {
    // Text unreadable by label: fall back to the provider's single record.
    const e = input.extracted;
    const dob =
      parseCivilDate(e.date_of_birth, { dayFirst: true }) ??
      str(e.date_of_birth);
    const rec: BirthRecord = {
      full_name: str(e.full_name),
      date_of_birth: dob,
      sex: str(e.sex),
      place_of_birth: str(e.place_of_birth),
      country_of_birth: str(e.country_of_birth),
      father_name: str(e.father_name),
      mother_name: str(e.mother_name),
    };
    if (rec.full_name || rec.date_of_birth) records = [rec];
  }

  const applicant = applicantNameOf(w.next);
  for (const rec of records) {
    if (!rec.full_name) continue;

    // The applicant's own certificate.
    if (applicant && isSamePerson(rec.full_name, applicant)) {
      w.fill('date_of_birth', rec.date_of_birth);
      w.fill('place_of_birth', rec.place_of_birth);
      w.fill('country_of_birth', rec.country_of_birth);
      w.fill('father_name', rec.father_name);
      w.fill('mother_name', rec.mother_name);
      w.fill('sex', rec.sex);
      w.notes.push(`${rec.full_name}: the applicant's own birth certificate`);
      continue;
    }

    const match = parentMatch(rec, w.next);
    const people = peopleInProfile(w.next);
    const known = findByName(people, rec.full_name);
    const child = childFromRecord(rec);

    if (match === 'none') {
      w.notes.push(
        `${rec.full_name}: parents are neither the applicant nor the spouse — not added as the applicant's child`,
      );
      continue;
    }
    if (known) {
      const filled = enrichChild(known, child);
      if (filled.length) {
        w.noteAdded(`children[${rec.full_name}].${filled.join(',')}`);
      }
      continue;
    }
    if (match === 'unknown') {
      // Not verifiably the applicant's child, and not someone intake named.
      w.notes.push(
        `${rec.full_name}: parents could not be matched to the applicant — not added`,
      );
      continue;
    }
    childrenList(w.next).push(child);
    w.noteAdded(`children[${rec.full_name}]`);
  }
}

// ─── Marriage ────────────────────────────────────────────────────────────────

function mergeMarriageCertificate(input: FamilyMergeInput, w: ProfileWriter) {
  const e = input.extracted;
  const groom = str(e.bridegroom_name);
  const bride = str(e.bride_name);
  const applicant = applicantNameOf(w.next);
  const spouse = spouseNameOf(w.next);

  let spouseOnCert: string | undefined;
  let applicantIsParty: boolean;
  if (applicant && groom && isSamePerson(groom, applicant)) {
    spouseOnCert = bride;
    applicantIsParty = true;
  } else if (applicant && bride && isSamePerson(bride, applicant)) {
    spouseOnCert = groom;
    applicantIsParty = true;
  } else if (spouse && groom && isSamePerson(groom, spouse)) {
    // The applicant is the bride, printed under her maiden name.
    spouseOnCert = groom;
    applicantIsParty = true;
  } else if (spouse && bride && isSamePerson(bride, spouse)) {
    spouseOnCert = bride;
    applicantIsParty = true;
  } else if (applicant && (groom || bride)) {
    // Both parties are readable and neither is the applicant or the spouse:
    // a son's or daughter's marriage certificate, not the applicant's.
    applicantIsParty = false;
  } else {
    // Nothing to check against — the pre-existing behaviour.
    spouseOnCert = str(e.spouse_name);
    applicantIsParty = true;
  }

  if (!applicantIsParty) {
    w.notes.push(
      "marriage certificate: neither party is the applicant or the spouse — not the applicant's marriage",
    );
    return;
  }

  const date = str(e.marriage_date);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    w.correct('marriage_date', date, input.priorDocumentMarriageDates ?? []);
  } else if (date) {
    w.fill('marriage_date', date);
  }
  w.fill('spouse_name', spouseOnCert);
}

// ─── Relatives' identity cards ──────────────────────────────────────────────

function mergeRelativeIdCard(
  input: FamilyMergeInput,
  w: ProfileWriter,
): boolean {
  const e = input.extracted;
  const holder = str(e.full_name);
  const applicant = applicantNameOf(w.next);
  if (!holder || !applicant) return false;
  if (isSamePerson(holder, applicant)) return false;

  const spouse = spouseNameOf(w.next);
  const relative = relativeFromIdCardText(input.rawText);
  const idDigits = digits(e.national_id_number);
  const isSpouse =
    (spouse && isSamePerson(holder, spouse)) ||
    ((relative.relation === 'husband' || relative.relation === 'wife') &&
      !!relative.name &&
      isSamePerson(relative.name, applicant)) ||
    (!!idDigits && idDigits === spouseIdOf(w.next));

  // Identity cards print numeric dates day-first (CNIC: 09.10.1968).
  const dob =
    parseCivilDate(e.date_of_birth, { dayFirst: true }) ?? str(e.date_of_birth);

  if (isSpouse) {
    w.fill('spouse_date_of_birth', dob);
    w.fill('spouse_name', holder);
    w.fill('spouse_national_id_number', str(e.national_id_number));
    w.notes.push(`${holder}: the spouse's identity card`);
    return true;
  }

  const child = findByName(peopleInProfile(w.next), holder);
  if (child) {
    const filled = enrichChild(child, { date_of_birth: dob });
    if (filled.length) w.noteAdded(`children[${holder}].date_of_birth`);
    return true;
  }

  // Somebody else's card: none of its identity fields are the applicant's.
  w.notes.push(
    `${holder}: someone else's identity card — applicant fields untouched`,
  );
  return true;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function mergeFamilyDocument(
  input: FamilyMergeInput,
): FamilyMergeResult {
  const w = new ProfileWriter(input.profile, {
    id: input.documentId,
    type: input.documentType,
  });
  const kind = civilRecordKind(input.documentType, input.rawText);
  let handled = false;

  if (kind === 'birth_certificate') {
    mergeBirthCertificate(input, w);
    handled = true;
  } else if (kind === 'marriage_certificate') {
    mergeMarriageCertificate(input, w);
    handled = true;
  } else if (resolveExtractionType(input.documentType) === 'national_id') {
    handled = mergeRelativeIdCard(input, w);
  }

  return {
    handled,
    next: w.next,
    added: w.added,
    skipped: w.skipped,
    notes: w.notes,
  };
}

// ─── Consistency ─────────────────────────────────────────────────────────────

export interface ConsistencyFlag {
  code: 'marriage_after_child_birth';
  field: string;
  message: string;
}

const CHILD_RELATION = /^(son|daughter|child|step[-\s]?(son|daughter|child))$/i;

function childrenOf(profile: Record<string, unknown>): Person[] {
  const out: Person[] = [];
  for (const key of ['children', 'children_details']) {
    const list = profile[key];
    if (isPeopleList(list)) out.push(...list);
  }
  for (const p of peopleInProfile(profile)) {
    if (out.includes(p)) continue;
    const rel = str(p.relationship) ?? str(p.relation);
    if (rel && CHILD_RELATION.test(rel)) out.push(p);
  }
  return out;
}

/**
 * Cross-document checks a reviewer must see. Flags, never fixes: a marriage
 * date after a child's birth may be a misread certificate, or may simply be
 * true (a child from before the marriage) — only the applicant can say which,
 * so nothing is changed silently.
 */
export function familyConsistencyFlags(
  profile: Record<string, unknown>,
): ConsistencyFlag[] {
  const married = parseCivilDate(profile.marriage_date, { dayFirst: true });
  if (!married) return [];
  const flags: ConsistencyFlag[] = [];
  for (const child of childrenOf(profile)) {
    const raw = child.date_of_birth ?? child.dob ?? child.birth_date;
    const born = parseCivilDate(raw, { dayFirst: true });
    if (!born || married <= born) continue;
    const name = personName(child) || 'a child';
    flags.push({
      code: 'marriage_after_child_birth',
      field: 'marriage_date',
      message:
        `The marriage date (${married}) is after ${name}'s date of birth (${born}). ` +
        'Check the date on the marriage certificate; if it is correct, be ready to explain it.',
    });
  }
  return flags;
}

/**
 * Recompute the family flags onto a profile. Returns whether the stored flags
 * changed, so the caller knows a write is needed even when no field was added.
 */
export function applyConsistencyFlags(
  profile: Record<string, unknown>,
): boolean {
  const before = JSON.stringify(profile[CONSISTENCY_FLAGS_KEY] ?? []);
  const others = (
    Array.isArray(profile[CONSISTENCY_FLAGS_KEY])
      ? (profile[CONSISTENCY_FLAGS_KEY] as Array<{ code?: string }>)
      : []
  ).filter((f) => f?.code !== 'marriage_after_child_birth');
  const flags = [...others, ...familyConsistencyFlags(profile)];
  if (flags.length) profile[CONSISTENCY_FLAGS_KEY] = flags;
  else delete profile[CONSISTENCY_FLAGS_KEY];
  return JSON.stringify(flags) !== before;
}
