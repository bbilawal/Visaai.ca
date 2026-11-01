import type { ExtractedFields } from '../document.state';
import { birthDateCandidates, identityRole } from './identity-compare';
import {
  applicantNameOf,
  DOCUMENT_SOURCES_KEY,
  spouseNameOf,
} from './sync-family';
import { resolveExtractionType } from '../../ocr/extraction-schema';
import {
  isSamePerson,
  normalizePersonName,
  peopleInProfile,
  personName,
} from '../../../shared/profile/family-members';

/**
 * WHOSE document is this? Decided before sync_profile writes a single
 * applicant field.
 *
 * Dry run 2026-10-16 (Canada super visa, prod app 61f16bb5): the applicant is
 * a mother, SUMERA AHMAD, born 1968. Her hosts are her twin sons in Canada. In
 * upload order she gave the host's passport (slot "proof of the host's
 * status"), the sons' birth certificates ("proof you are the host's parent"),
 * a son's T4, and only then her own passport. The profile ended up saying the
 * applicant was "MIAN MUHAMMAD", male, born 1989-10-14 in Rawalpindi, whose
 * mother is SUMERA AHMAD — her son — and the travel itinerary generated from
 * it said "Applicant: Mian Muhammad". Three faults, in order:
 *
 *  1. The generic identity merge ran on EVERY document, so the host's passport
 *     gap-filled the applicant's empty full_name and date_of_birth. The slot
 *     said plainly whose passport it was; nothing read the slot.
 *  2. With the applicant's name now "MIAN MUHAMMAD", the sons' birth
 *     certificate looked like the applicant's OWN (the name is a subset of both
 *     sons' names), so it filled her sex, father, mother and place of birth.
 *  3. Her own passport arrived last, and the merge only fills gaps — it could
 *     not displace any of it.
 *
 * The rules here:
 *  - A document in a third-party slot (host / sponsor / inviter / co-signer,
 *    host income proof, a family-request row, or any slot whose meta.owner is
 *    not the applicant) never writes an applicant identity key.
 *  - A document whose holder is someone the profile already names as another
 *    person (a child, the spouse, the inviter, the representative) is that
 *    person's, wherever it was uploaded.
 *  - A passport/ID whose number is the applicant's own (from intake) IS the
 *    applicant's, wherever it was uploaded, and its identity fields take
 *    precedence over anything another source wrote (see applyOwnIdentity).
 *
 * `meta.owner` is NOT relied on alone: the requirements registry does not
 * carry an owner, so registry-built checklists (super visa included) mark
 * every row `owner: "applicant"` — even "HOST: writes and signs a letter of
 * invitation". The slot's code is read as well.
 *
 * Pure: no I/O.
 */

/** Keys that describe the applicant as a person. Never written from someone else's document. */
export const APPLICANT_IDENTITY_KEYS = [
  'full_name',
  'given_name',
  'family_name',
  'date_of_birth',
  'sex',
  'nationality',
  'place_of_birth',
  'country_of_birth',
  'father_name',
  'mother_name',
  'passport_number',
  'national_id_number',
  'national_id_issue_date',
  'national_id_expiry_date',
] as const;

/** The checklist slot a document was uploaded into. */
export interface DocumentSlot {
  /** checklist_items.document_type — the slot's code. */
  slotType: string | null;
  /** checklist_items.meta.owner. */
  owner: string | null;
  /** checklist_items.meta.family_gap — a request for a named relative's document. */
  familyGap: boolean;
}

export type SlotSubject =
  /** The slot asks for somebody else's document. */
  | 'third_party'
  /** Relationship evidence: usually a relative's document, possibly the applicant's. */
  | 'relationship'
  /** An ordinary slot: nothing says it is someone else's. */
  | 'applicant'
  /** No slot (an "Additional document" upload). */
  | 'none';

/** Slot-code tokens that name a party other than the applicant. */
const THIRD_PARTY_TOKEN =
  /(^|_)(host|hosts|sponsor|sponsors|inviter|inviters|inviting|cosigner|co_signer|cosigners|guarantor)(_|$)/;
/** Slot codes that are the host's evidence without saying "host" (super visa). */
const THIRD_PARTY_PREFIXES = ['income_proof_option', 'letter_of_invitation'];

export function slotSubject(
  slot: DocumentSlot | null | undefined,
): SlotSubject {
  if (!slot) return 'none';
  const owner = (slot.owner ?? '').toLowerCase().trim();
  if (owner && owner !== 'applicant') return 'third_party';
  if (slot.familyGap) return 'third_party';
  const code = (slot.slotType ?? '').toLowerCase().trim();
  if (!code) return 'none';
  if (THIRD_PARTY_TOKEN.test(code)) return 'third_party';
  if (THIRD_PARTY_PREFIXES.some((p) => code.startsWith(p))) {
    return 'third_party';
  }
  if (/relationship|relation_proof/.test(code)) return 'relationship';
  return 'applicant';
}

/** Does this slot ask for the host's / inviter's own evidence? */
export function isHostSlot(slot: DocumentSlot | null | undefined): boolean {
  const code = (slot?.slotType ?? '').toLowerCase();
  const owner = (slot?.owner ?? '').toLowerCase();
  return (
    /(^|_)(host|hosts|inviter|inviters|inviting)(_|$)/.test(code) ||
    owner === 'host' ||
    owner === 'inviter'
  );
}

export type DocumentSubject = 'applicant' | 'other' | 'unknown';

export interface SubjectDecision {
  subject: DocumentSubject;
  /**
   * The applicant's own identity document, recognised with confidence (its
   * number matches, or its holder matches the applicant and nobody else).
   * Its identity fields take precedence — applyOwnIdentity.
   */
  ownIdentity: boolean;
  reason: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function alnum(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number'
    ? String(v)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
    : '';
}

type Sources = Record<
  string,
  { document_id?: string; document_type?: string; value?: unknown }
>;

export function sourcesOf(profile: Record<string, unknown>): Sources {
  const raw = profile[DOCUMENT_SOURCES_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Sources)
    : {};
}

/** The holder's name a document printed. */
export function holderName(extracted: ExtractedFields): string | undefined {
  const full = str(extracted.full_name);
  if (full) return full;
  const joined = [str(extracted.given_name), str(extracted.family_name)]
    .filter(Boolean)
    .join(' ');
  return joined || undefined;
}

const SELF_RELATION = /^(self|applicant|principal|main applicant)$/i;

/** Everyone the profile names who is NOT the applicant. */
export function otherPeopleNames(profile: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const p of peopleInProfile(profile)) {
    const rel = str(p.relationship) ?? str(p.relation);
    if (rel && SELF_RELATION.test(rel)) continue;
    const n = personName(p);
    if (n) out.push(n);
  }
  for (const k of [
    'spouse_name',
    'spouse_full_name',
    'inviter_name',
    'inviter_full_name',
    'host_name',
    'host_full_name',
    'second_inviter_name',
    'sponsor_name',
    'representative_name',
    'family_member_name',
  ]) {
    const v = str(profile[k]);
    if (v) out.push(v);
  }
  const inviter = [
    str(profile.inviter_given_name),
    str(profile.inviter_family_name),
  ]
    .filter(Boolean)
    .join(' ');
  if (inviter) out.push(inviter);
  return out;
}

/**
 * The applicant's passport / national ID number as the APPLICANT gave it —
 * a number some document wrote is not evidence of anything.
 */
function applicantNumbers(profile: Record<string, unknown>): string[] {
  const sources = sourcesOf(profile);
  const out: string[] = [];
  for (const k of ['passport_number', 'national_id_number']) {
    if (sources[k]) continue;
    const n = alnum(profile[k]);
    if (n.length >= 6) out.push(n);
  }
  return out;
}

export function documentSubject(input: {
  profile: Record<string, unknown>;
  extracted: ExtractedFields;
  documentType: string | null | undefined;
  slot: DocumentSlot | null | undefined;
}): SubjectDecision {
  const { profile, extracted } = input;
  const isIdentityDoc = identityRole(input.documentType) === 'identity';
  const slot = slotSubject(input.slot);

  // 1. The applicant's own number: the strongest evidence there is.
  const docNumbers = [extracted.passport_number, extracted.national_id_number]
    .map(alnum)
    .filter((n) => n.length >= 6);
  const mine = applicantNumbers(profile);
  if (docNumbers.some((n) => mine.includes(n))) {
    return {
      subject: 'applicant',
      ownIdentity: isIdentityDoc,
      reason: "document number matches the applicant's",
    };
  }

  // 2. The slot asks for someone else's document.
  if (slot === 'third_party') {
    return {
      subject: 'other',
      ownIdentity: false,
      reason: `uploaded to a third-party slot (${input.slot?.slotType ?? 'owner ' + input.slot?.owner})`,
    };
  }

  // 3. The holder is somebody the profile names as another person.
  const holder = holderName(extracted);
  if (holder) {
    const applicant = applicantNameOf(profile);
    const isApplicant = !!applicant && isSamePerson(holder, applicant);
    const isOther = otherPeopleNames(profile).some((n) =>
      isSamePerson(holder, n),
    );
    if (isOther && !isApplicant) {
      return {
        subject: 'other',
        ownIdentity: false,
        reason: 'the holder is another person on the profile',
      };
    }
    if (isApplicant && !isOther) {
      return {
        subject: 'applicant',
        ownIdentity: isIdentityDoc && !applicantNameFromDocument(profile),
        reason: 'the holder is the applicant',
      };
    }
  }

  // 4. An identity document offered as relationship evidence is the
  //    relative's (a host's passport, a child's ID). Civil records in such a
  //    slot are routed by sync-family, which reads whose they are.
  if (slot === 'relationship' && isIdentityDoc) {
    return {
      subject: 'other',
      ownIdentity: false,
      reason: 'an identity document offered as relationship evidence',
    };
  }

  return { subject: 'unknown', ownIdentity: false, reason: 'undetermined' };
}

// ─── Somebody else's document in the applicant's own slot ───────────────────

/**
 * The note shown on a document whose printed holder is plainly not the
 * applicant. Stored on the identity verification row
 * (`details_json.holder_mismatch`); the web vault renders it, translated, from
 * `holder` and `applicant`. `message` is the English fallback.
 */
export interface HolderMismatch {
  /** The name(s) the document prints. */
  holder: string;
  /** The applicant's name as the profile holds it. */
  applicant: string;
  message: string;
}

export interface HolderCheck extends HolderMismatch {
  /**
   * Clearly somebody else's, not merely a name that reads differently: its
   * passport / ID number differs from one already on the profile AND its
   * date of birth differs from the profile's; or a passport / ID whose
   * holder shares no name part with the applicant's (namesShareNothing) AND
   * whose DOB differs from one this document did not write. Never on the
   * name or a differing number alone. Only then does sync_profile
   * refuse to write from it (and retract what it wrote before); otherwise
   * the applicant is told and the document is merged as it always was.
   */
  clearlyOther: boolean;
  /**
   * A passport / ID whose holder shares no name part with the name the
   * applicant stated (or with the profile's name, its number differing too),
   * and no differing date of birth to say whose it is:
   * sync_profile writes nothing from it and retracts nothing, and it is not
   * attached to a portal until confirmed (consultant-approved).
   */
  needsConfirmation: boolean;
}

/** Document kinds that describe one person: the applicant, when in their own slot. */
type PersonalKind = 'identity' | 'birth' | 'police' | 'marriage';

function personalKind(
  documentType: string | null | undefined,
): PersonalKind | null {
  if (identityRole(documentType) === 'identity') return 'identity';
  const resolved = resolveExtractionType(documentType);
  if (resolved === 'passport' || resolved === 'national_id') return 'identity';
  if (resolved === 'birth_certificate') return 'birth';
  if (resolved === 'police_clearance') return 'police';
  if (resolved === 'marriage_certificate') return 'marriage';
  const t = (documentType ?? '').toLowerCase();
  if (/birth_cert|birth_registration/.test(t)) return 'birth';
  if (/marriage|nikah/.test(t)) return 'marriage';
  if (/police/.test(t)) return 'police';
  return null;
}

/**
 * Common transliteration variants of one name, folded to one spelling.
 * "Mohammad" on a passport and "MUHAMMAD" in intake are the same person.
 */
const NAME_VARIANTS: Record<string, string> = {
  muhammad: 'muhammad',
  muhammed: 'muhammad',
  muhamad: 'muhammad',
  mohammad: 'muhammad',
  mohammed: 'muhammad',
  mohamed: 'muhammad',
  mohamad: 'muhammad',
  mohd: 'muhammad',
  md: 'muhammad',
  syed: 'syed',
  sayed: 'syed',
  sayyid: 'syed',
  sayyed: 'syed',
  ali: 'ali',
  aly: 'ali',
};

function nameTokens(name: unknown): string[] {
  return normalizePersonName(name)
    .split(' ')
    .filter(Boolean)
    .map((t) => NAME_VARIANTS[t] ?? t);
}

/**
 * Name parts so common (or honorific) that sharing one says nothing about
 * being the same person. Live 2026-10-29: a relative's passport, "MIAN
 * MUHAMMAD …", read as the applicant's father "Muhammad … Chaudhary" on the
 * one shared part "Muhammad", so nobody was told it was not theirs.
 */
const COMMON_NAME_PARTS = new Set([
  'muhammad',
  'syed',
  'mian',
  'sheikh',
  'shaikh',
  'chaudhary',
  'chaudhry',
  'choudhary',
  'choudhry',
  'chaudhri',
  'malik',
  'rana',
  'raja',
  'abdul',
  'begum',
  'bibi',
]);

/** At most one insertion, deletion or substitution apart. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
  );
}

/**
 * One name part folded across romanisations: doubled letters collapsed, an
 * "h" after a consonant dropped (ch/sh/kh/dh), and every run of vowels
 * (y included) read as one "a". So yusuf / yousef / yousaf, aisha / ayesha
 * and zeeshan / zishan fold alike; chaudhry / chaudhary land one letter apart.
 */
function foldPart(t: string): string {
  return t
    .replace(/(.)\1+/g, '$1')
    .replace(/([^aeiouy])h/g, '$1')
    .replace(/[aeiouy]+/g, 'a');
}

/**
 * Could two name parts be the same name? Both distinctive (three letters or
 * more, not a COMMON_NAME_PARTS entry). Four letters or more: equal once
 * folded, or (five folded letters or more) one letter apart once folded. A shorter part that begins the
 * longer one is a nickname ("Zee" / "Zeeshan").
 */
function partsMatch(a: string, b: string): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 3 && s.length < l.length && l.startsWith(s)) return true;
  if (s.length < 4) return false;
  if (s === l) return true;
  const fs = foldPart(s);
  const fl = foldPart(l);
  return (
    fs === fl || (fs.length >= 5 && fl.length >= 5 && withinOneEdit(fs, fl))
  );
}

function distinctiveParts(name: unknown): string[] {
  return nameTokens(name).filter(
    (t) => t.length >= 3 && !COMMON_NAME_PARTS.has(t),
  );
}

/**
 * Do these two names share NOTHING a person could be recognised by? Not the
 * same person by namesMayMatch, and no distinctive part in common even
 * exactly at three letters ("Ali"). Only such a holder is ever weighed as
 * someone else's on its name.
 */
export function namesShareNothing(a: unknown, b: unknown): boolean {
  if (namesMayMatch(a, b)) return false;
  const ta = distinctiveParts(a);
  const tb = distinctiveParts(b);
  if (!ta.length || !tb.length) return false;
  return !ta.some((x) => tb.includes(x));
}

/**
 * Could these two printed names be the same person? Deliberately lenient: a
 * false "this is not you" on the applicant's own passport is worse than a
 * missed one. Same person per isSamePerson (order, spacing, one OCR slip),
 * after folding transliteration variants, or sharing any distinctive name
 * part per partsMatch (a married vs maiden surname still shares a given
 * name; "Yusuf" / "YOUSAF"; "Zee" / "ZEESHAN").
 */
export function namesMayMatch(a: unknown, b: unknown): boolean {
  if (isSamePerson(a, b)) return true;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const da = distinctiveParts(a);
  const db = distinctiveParts(b);
  if (da.some((x) => db.some((y) => partsMatch(x, y)))) return true;
  return isSamePerson(ta.join(' '), tb.join(' '));
}

/** A login handle or e-mail, not a name ("bilawal.m", "a@b.c", "user123"). */
const HANDLE_LIKE = /[.@\d]/;

/**
 * The applicant's name for this check: applicantNameOf's fields, skipping any
 * value that looks like a username fallback rather than a name.
 */
function applicantNameForCheck(
  profile: Record<string, unknown>,
): string | undefined {
  for (const k of [
    'full_name',
    'applicant_name',
    'name',
    'applicant_full_name',
  ]) {
    const v = str(profile[k]);
    if (v && !HANDLE_LIKE.test(v) && normalizePersonName(v)) return v;
  }
  const given = str(profile.given_name) ?? str(profile.first_name);
  const family =
    str(profile.family_name) ?? str(profile.last_name) ?? str(profile.surname);
  const joined = [given, family].filter(Boolean).join(' ');
  return joined && !HANDLE_LIKE.test(joined) && normalizePersonName(joined)
    ? joined
    : undefined;
}

/**
 * The applicant's name as the APPLICANT gave it: applicantNameForCheck over
 * only the name keys no document wrote (no `_document_sources` entry).
 * Aliases (`other_names`) are never read.
 */
function statedApplicantName(
  profile: Record<string, unknown>,
): string | undefined {
  const sources = sourcesOf(profile);
  const own: Record<string, unknown> = {};
  for (const k of NAME_KEYS) {
    if (!sources[k]) own[k] = profile[k];
  }
  return applicantNameForCheck(own);
}

const NAME_KEYS = [
  'full_name',
  'applicant_name',
  'name',
  'applicant_full_name',
  'given_name',
  'first_name',
  'family_name',
  'last_name',
  'surname',
] as const;

const NUMBER_KEYS = ['passport_number', 'national_id_number'] as const;

/** Profile keys holderMismatch weighs as evidence of who the applicant is. */
const EVIDENCE_KEYS = [...NAME_KEYS, 'date_of_birth', ...NUMBER_KEYS];

/**
 * The profile without the evidence keys `documentId` itself wrote and nobody
 * has changed since (provenance value still equal to the profile's).
 */
function withoutOwnEvidence(
  profile: Record<string, unknown>,
  documentId: string | null | undefined,
): Record<string, unknown> {
  if (!documentId) return profile;
  const sources = sourcesOf(profile);
  let out: Record<string, unknown> | null = null;
  for (const key of EVIDENCE_KEYS) {
    const src = sources[key];
    if (
      src?.document_id === documentId &&
      JSON.stringify(src.value) === JSON.stringify(profile[key])
    ) {
      out ??= { ...profile };
      delete out[key];
    }
  }
  return out ?? profile;
}

/**
 * Is this upload, in a slot that asks for the APPLICANT's own document,
 * plainly somebody else's?
 *
 * Live E2E 2026-10-20 (Canada spousal sponsorship): another person's passport,
 * birth certificate and police certificate went into the applicant's own
 * slots. documentSubject called each 'unknown', nothing told the applicant,
 * and every one showed "Identity ✓ Pass".
 *
 * Warns only when ALL hold:
 *  - the document is a personal one (passport / national ID, birth, police or
 *    marriage certificate);
 *  - the slot is the applicant's (or none) — never a host, sponsor, family
 *    request or relationship-evidence slot;
 *  - the holder's name was read, and the applicant's is a real name (not a
 *    username fallback);
 *  - no passport / ID number on it matches one on the profile;
 *  - its date of birth does not match the profile's;
 *  - the holder is neither the applicant nor anyone else the profile names
 *    (namesMayMatch: order-, spelling-variant- and OCR-tolerant);
 *  - a birth certificate does not name the applicant as a parent;
 *  - a marriage certificate names neither the applicant nor their spouse /
 *    sponsor as either party.
 *
 * Non-blocking: the document still verifies. See `clearlyOther` for when it
 * also stops writing to the profile.
 *
 * `documentId`: profile names, numbers and DOB that THIS document wrote (and
 * nobody has changed since) are not evidence about it — a stranger's passport
 * that filled passport_number before this check existed would otherwise
 * "match itself" on every re-read and never be noticed. With them set aside,
 * a re-read of the applicant's own passport whose number and DOB came only
 * from itself has nothing left to differ from, so it is never clearlyOther.
 * Pure.
 */
export function holderMismatch(input: {
  profile: Record<string, unknown>;
  extracted: ExtractedFields;
  documentType: string | null | undefined;
  slot: DocumentSlot | null | undefined;
  documentId?: string | null;
}): HolderCheck | null {
  const { extracted } = input;
  const profile = withoutOwnEvidence(input.profile, input.documentId);
  const kind = personalKind(input.documentType);
  if (!kind) return null;
  const where = slotSubject(input.slot);
  if (where === 'third_party' || where === 'relationship') return null;
  if ((extracted as Record<string, unknown>).holder_unknown === true) {
    return null;
  }

  const applicant = applicantNameForCheck(profile);
  if (!applicant) return null;

  // Numbers: any match is the applicant's own document.
  const docNumbers = NUMBER_KEYS.map((k) => alnum(extracted[k])).filter(
    (n) => n.length >= 6,
  );
  const mine = NUMBER_KEYS.map((k) => alnum(profile[k])).filter(
    (n) => n.length >= 6,
  );
  if (docNumbers.some((n) => mine.includes(n))) return null;
  const numberDiffers = NUMBER_KEYS.some((k) => {
    const d = alnum(extracted[k]);
    const p = alnum(profile[k]);
    return d.length >= 6 && p.length >= 6 && d !== p;
  });

  // Date of birth: a match is the applicant's own document.
  const docDob = birthDateCandidates(extracted.date_of_birth);
  const myDob = birthDateCandidates(profile.date_of_birth);
  if (docDob.length && myDob.length && docDob.some((d) => myDob.includes(d))) {
    return null;
  }
  const dobDiffers = docDob.length > 0 && myDob.length > 0;

  const known = [applicant, ...otherPeopleNames(profile)];
  const spouse = spouseNameOf(profile);
  if (spouse) known.push(spouse);
  // Independent evidence first: a number AND a date of birth that both
  // differ from ones this document did not write make it someone else's
  // however alike the names read — a relative shares a surname ("KHAN"), and
  // folded given names can coincide (Umar / Amir). Checked before the name.
  const independentOther = numberDiffers && dobDiffers;
  const isKnown = (name: string) =>
    !independentOther && known.some((k) => namesMayMatch(name, k));

  let holder: string | undefined;
  if (kind === 'marriage') {
    const parties = [
      str(extracted.bridegroom_name),
      str(extracted.bride_name),
      str(extracted.spouse_name),
    ].filter((p): p is string => !!p && !!normalizePersonName(p));
    if (!parties.length) return null;
    if (parties.some(isKnown)) return null;
    holder = parties.slice(0, 2).join(' & ');
  } else {
    holder = holderName(extracted);
    if (!holder || !normalizePersonName(holder)) return null;
    if (isKnown(holder)) return null;
    if (
      kind === 'birth' &&
      [extracted.father_name, extracted.mother_name].some((p) =>
        isSamePerson(p, applicant),
      )
    ) {
      // The applicant's child's certificate.
      return null;
    }
  }

  // A passport / ID whose holder's name shares nothing with the applicant's
  // (live 2026-10-29: a relative's passport became the applicant's
  // identity). The name alone never retracts anything — a romanisation, a
  // nickname or a married name must not wipe the applicant's own passport —
  // and neither does a differing number (a renewal). Retraction needs a date
  // of birth this document did not write that differs. Otherwise a name
  // sharing nothing with the stated name, or with the profile's name when
  // the number differs too, is held until confirmed.
  const stated = statedApplicantName(profile);
  const identity = kind === 'identity';
  const nameIsOther = identity && namesShareNothing(holder, applicant);
  const clearlyOther = independentOther || (nameIsOther && dobDiffers);
  const needsConfirmation =
    !clearlyOther &&
    identity &&
    ((!!stated && namesShareNothing(holder, stated)) ||
      (nameIsOther && numberDiffers));
  const givenName =
    stated && namesShareNothing(holder, stated) ? stated : applicant;

  return {
    holder,
    applicant: needsConfirmation ? givenName : applicant,
    message: needsConfirmation
      ? `This passport's name (${holder}) doesn't match the name you gave (${givenName}). Confirm it's yours before it is used, or upload your own.`
      : `This document seems to name ${holder}, not ${applicant}. If it is not yours, upload your own.`,
    clearlyOther,
    needsConfirmation,
  };
}

/** Was the profile's applicant name written by a document (not the applicant)? */
function applicantNameFromDocument(profile: Record<string, unknown>): boolean {
  return !!sourcesOf(profile).full_name;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export interface IdentityChange {
  key: string;
  from: unknown;
  to: unknown;
}

function sexKey(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 'm' || s === 'male') return 'm';
  if (s === 'f' || s === 'female') return 'f';
  return s;
}

/** Do two values of an identity key say the same thing? */
export function sameIdentityValue(
  key: string,
  a: unknown,
  b: unknown,
): boolean {
  if (a === b) return true;
  if (key === 'date_of_birth') {
    const ca = birthDateCandidates(a);
    const cb = birthDateCandidates(b);
    if (ca.length && cb.length) return ca.some((d) => cb.includes(d));
  }
  if (key === 'sex') return sexKey(a) !== '' && sexKey(a) === sexKey(b);
  if (key === 'full_name' || key === 'father_name' || key === 'mother_name') {
    return isSamePerson(a, b);
  }
  if (key === 'passport_number' || key === 'national_id_number') {
    return alnum(a) !== '' && alnum(a) === alnum(b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return normalizePersonName(a) === normalizePersonName(b);
  }
  return false;
}

/**
 * Keys the applicant's own passport / ID overrides outright. A passport is the
 * legal statement of who the applicant is, and every form must match it.
 */
const OWN_IDENTITY_OVERRIDES = [
  'full_name',
  'given_name',
  'family_name',
  'date_of_birth',
  'sex',
] as const;

/**
 * The applicant's own identity document takes precedence for identity keys,
 * even when it is uploaded last. `full_name`, names, DOB and sex are replaced
 * when they disagree; other identity keys (nationality, place of birth, …)
 * only replace a value another document wrote. Mutates `profile`.
 */
export function applyOwnIdentity(
  profile: Record<string, unknown>,
  extracted: ExtractedFields,
  doc: { id: string; type: string },
): IdentityChange[] {
  const changes: IdentityChange[] = [];
  const sources = sourcesOf(profile);
  const write = (key: string, value: unknown) => {
    const from = profile[key];
    profile[key] = value;
    sources[key] = {
      document_id: doc.id,
      document_type: doc.type,
      value,
      ...(from !== undefined && from !== null && from !== ''
        ? { replaced: from }
        : {}),
    };
    profile[DOCUMENT_SOURCES_KEY] = sources;
    changes.push({ key, from, to: value });
  };

  for (const key of APPLICANT_IDENTITY_KEYS) {
    const value = extracted[key];
    if (value === undefined || value === null || String(value).trim() === '')
      continue;
    const current = profile[key];
    const empty =
      current === undefined ||
      current === null ||
      (typeof current === 'string' && current.trim() === '');
    if (empty) continue; // gap-fill is the generic merge's job
    if (sameIdentityValue(key, current, value)) continue;
    const overridable =
      (OWN_IDENTITY_OVERRIDES as readonly string[]).includes(key) ||
      (!!sources[key] && sources[key].document_id !== doc.id);
    if (overridable) write(key, value);
  }
  return changes;
}

/**
 * Null out applicant identity keys that came from somebody else's document.
 *
 *  - Keys this very document wrote (provenance) when it is now known not to
 *    be the applicant's.
 *  - Values written before provenance existed: a distinctive key (name, DOB,
 *    document number) holding exactly what this third-party document printed.
 *  - Keys written by a birth certificate that names the APPLICANT as a parent
 *    — that certificate was the applicant's child's, never their own.
 *
 * Nulled rather than deleted: the intake chat's checkpoint holds its own copy
 * of the profile and is overlaid by the row each turn, so a deleted key would
 * come back on the applicant's next answer; a null one does not, and is still
 * an open gap for the next document or question. Mutates `profile`.
 */
export function retractForeignIdentity(
  profile: Record<string, unknown>,
  opts: {
    /**
     * The current document, when it is someone else's. `provenanceOnly`: only
     * what provenance proves it wrote (a civil record re-read and found not
     * to be the applicant's own — its names may legitimately equal theirs).
     */
    foreignDoc?: {
      id: string;
      extracted: ExtractedFields;
      provenanceOnly?: boolean;
    };
  },
): IdentityChange[] {
  const changes: IdentityChange[] = [];
  const sources = sourcesOf(profile);
  const retract = (key: string) => {
    const from = profile[key];
    if (from === undefined || from === null) return;
    profile[key] = null;
    delete sources[key];
    changes.push({ key, from, to: null });
  };

  const foreign = opts.foreignDoc;
  if (foreign) {
    for (const key of APPLICANT_IDENTITY_KEYS) {
      const src = sources[key];
      if (src?.document_id === foreign.id && src.value === profile[key]) {
        retract(key);
      }
    }
    for (const key of foreign.provenanceOnly
      ? []
      : [
          'full_name',
          'date_of_birth',
          'passport_number',
          'national_id_number',
        ]) {
      if (sources[key]) continue;
      const printed = foreign.extracted[key];
      if (printed === undefined || printed === null || printed === '') continue;
      const current = profile[key];
      if (current === undefined || current === null || current === '') continue;
      const exact =
        key === 'full_name'
          ? normalizePersonName(current) === normalizePersonName(printed)
          : sameIdentityValue(key, current, printed);
      if (exact) retract(key);
    }
  }

  // A child's birth certificate mistaken for the applicant's own.
  const applicant = applicantNameOf(profile);
  if (applicant) {
    const badDocs = new Set<string>();
    for (const key of ['father_name', 'mother_name']) {
      const src = sources[key];
      if (
        src?.document_id &&
        /birth/.test(String(src.document_type ?? '')) &&
        src.value === profile[key] &&
        isSamePerson(profile[key], applicant)
      ) {
        badDocs.add(src.document_id);
      }
    }
    for (const key of APPLICANT_IDENTITY_KEYS) {
      const src = sources[key];
      if (src?.document_id && badDocs.has(src.document_id)) retract(key);
    }
  }

  if (changes.length) {
    if (Object.keys(sources).length) profile[DOCUMENT_SOURCES_KEY] = sources;
    else delete profile[DOCUMENT_SOURCES_KEY];
  }
  return changes;
}

/**
 * The host's passport / citizenship document → the inviter fields, never the
 * applicant's. Gap-fill only. Mutates `profile`; returns the keys it filled.
 */
export function routeHostIdentity(
  profile: Record<string, unknown>,
  extracted: ExtractedFields,
): string[] {
  const filled: string[] = [];
  const empty = (k: string) =>
    profile[k] === undefined ||
    profile[k] === null ||
    (typeof profile[k] === 'string' && !profile[k].trim());
  const name = holderName(extracted);
  const known = str(profile.inviter_name);
  if (name && empty('inviter_name')) {
    profile.inviter_name = name;
    filled.push('inviter_name');
  }
  const sameHost = !known || (name && isSamePerson(name, known));
  const nat = (str(extracted.nationality) ?? '').toUpperCase();
  if (
    sameHost &&
    /^(CAN|CANADA|CANADIAN)$/.test(nat) &&
    empty('inviter_status')
  ) {
    profile.inviter_status = 'Canadian citizen';
    filled.push('inviter_status');
  }
  return filled;
}
