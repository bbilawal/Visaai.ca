import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState, ExtractedFields } from '../document.state';
import { safeLog } from '../../../shared/log/redact';
import {
  applyConsistencyFlags,
  DOCUMENT_SOURCES_KEY,
  mergeFamilyDocument,
} from './sync-family';
import { civilRecordKind } from '../../ocr/civil-records';
import { isPhotoDocumentType } from '../../ocr/extraction-schema';
import {
  isAgreementType,
  isIdCardType,
  isPassportType,
} from './classify-document';
import { syncFamilyGapsForApplication } from '../../family-gaps/family-gaps.sync';
import {
  applyOwnIdentity,
  documentSubject,
  holderMismatch,
  isHostSlot,
  retractForeignIdentity,
  routeHostIdentity,
  slotSubject,
  sourcesOf,
  type DocumentSlot,
  type HolderMismatch,
} from './document-subject';
import { dedupePlaceholderChildren } from '../../../shared/profile/intake-children';
import { isBusinessVisitorRoute } from '@visaai/types';
import type { PrefilledFormPayload } from '@visaai/types';
import {
  HOLDER_CONFIRMATIONS_TABLE,
  latestDocumentDecision,
  loadHeldIdentity,
  scrubHeldIdentity,
  type ItemDecisionRow,
} from '../../../prefill/graphs/nodes/held-identity';
import {
  isSamePerson,
  normalizePersonName,
} from '../../../shared/profile/family-members';

/**
 * sync_profile — fold what a document told us back into the applicant profile.
 *
 * THE GAP THIS CLOSES. Document extraction wrote to
 * `document_verifications.details_json.extracted_fields` and nothing else. The
 * only consumer was prefill, which merged it into a prompt at generation time
 * and never persisted it. So the intake chat — which builds its questions from
 * `application_profiles.profile_json` alone — could not see a single fact from
 * a document the applicant had already uploaded, and went on asking for their
 * name, date of birth, employer and course start date with the answers sitting
 * in the database.
 *
 * TWO RULES GOVERN THIS MERGE, and both matter more than the convenience:
 *
 * 1. IT ONLY FILLS GAPS. A key the applicant has already answered is never
 *    overwritten. They are the authority on their own history; an OCR read of a
 *    scanned document is not, and silently rewriting a user's stated fact is
 *    the failure mode this product can least afford.
 *
 * 2. IT COPIES, IT DOES NOT CONVERT. The allowlist below carries only fields
 *    whose meaning survives the move unchanged. Monetary amounts are
 *    deliberately excluded: `monthly_income` from a payslip is in the
 *    document's own currency, while the profile's `monthly_salary_usd` is not,
 *    and quietly treating one as the other would put a wrong number in front of
 *    a visa officer. Financial values already reach the scoring and prefill
 *    paths directly from `extracted_fields`, where their document context
 *    travels with them.
 *
 * Best-effort: a failure here leaves the profile untouched and the document
 * pipeline unaffected. Nothing downstream depends on it having run.
 */

/**
 * OCR field -> profile key. Identity mappings are listed explicitly rather than
 * defaulted, so adding an extraction field never silently starts writing to the
 * profile without someone deciding that it should.
 */
const PROFILE_FIELD_MAP: Record<string, string> = {
  // Identity — same meaning either side.
  full_name: 'full_name',
  given_name: 'given_name',
  family_name: 'family_name',
  date_of_birth: 'date_of_birth',
  nationality: 'nationality',
  place_of_birth: 'place_of_birth',
  sex: 'sex',
  passport_number: 'passport_number',
  // Prefill's national-ID lookup reads this profile key first (#34).
  national_id_number: 'national_id_number',

  // Employment — names and titles, no amounts.
  employer: 'employer_name',
  job_title: 'job_title',
  employment_type: 'employment_type',
  employment_start_date: 'employment_start_date',

  // A job offer / LMIA: the work permit's own questions (IRCC_WORK_FACTS),
  // never the current job's keys above. Answers the applicant gave win.
  offered_employer_name: 'work_employer_name',
  offered_employer_address: 'work_employer_address',
  offered_job_title: 'work_job_title',
  offered_start_date: 'work_start_date',
  offered_end_date: 'work_end_date',
  lmia_number: 'lmia_number',
  offer_of_employment_number: 'offer_of_employment_number',

  // Study.
  institution_name: 'institution_name',
  program_name: 'program_name',
  program_level: 'program_level',
  program_start_date: 'program_start_date',
  program_end_date: 'program_end_date',

  // Family.
  father_name: 'father_name',
  mother_name: 'mother_name',
  spouse_name: 'spouse_name',
  marriage_date: 'marriage_date',

  // Ties.
  property_address: 'property_address',
  property_type: 'property_type',
};

/** Extra fields an identity card maps (see mergeExtractedIntoProfile). */
const NATIONAL_ID_DATE_MAP: Record<string, string> = {
  issue_date: 'national_id_issue_date',
  expiry_date: 'national_id_expiry_date',
};

/**
 * On a passport, issue and expiry are the PASSPORT's dates, which IRCC asks
 * for (/travel-doc). Only a YYYY-MM-DD value is copied: an ambiguous print
 * ("03/04/2026") is the applicant's to read, and stored under this key it
 * would count as answered and stop the interview from asking.
 */
const PASSPORT_DATE_MAP: Record<string, string> = {
  issue_date: 'passport_issue_date',
  expiry_date: 'passport_expiry_date',
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The "Ties" keys mean property the applicant OWNS (VRI home ties). A lease's
 * premises are rented — often from somebody else entirely — so a lease or
 * other agreement never fills them.
 */
const OWNED_PROPERTY_KEYS = new Set(['property_address', 'property_type']);

/**
 * Deliberately NOT mapped, with the reason, so the next person does not "fix"
 * the omission: every one of these is either currency-bearing or
 * document-scoped, and only means something alongside the document it came
 * from.
 */
export const INTENTIONALLY_UNMAPPED = [
  'monthly_income', // document currency != profile's *_usd
  'annual_income',
  'account_balance',
  'average_monthly_balance',
  'tuition_amount',
  'offered_wage', // document currency and period
  'offered_wage_period',
  'offered_currency',
  'offered_noc_code', // not asked by the interview
  'scholarship_amount',
  'property_value',
  'currency',
  'account_number', // document-scoped, not a profile fact
  // Mean "this document expires"; mapped only on an identity card or a
  // passport, to that document's own keys.
  'expiry_date',
  'issue_date',
] as const;

export interface ProfileMergeResult {
  /** Profile keys this document newly filled. */
  added: string[];
  /** Keys the document also knew, but the applicant had already answered. */
  skipped: string[];
}

/**
 * Pure merge: decide what a document adds to a profile. Exported for tests —
 * the decision, not the database call, is what has to be right.
 */
export function mergeExtractedIntoProfile(
  profile: Record<string, unknown>,
  extracted: ExtractedFields,
  documentType?: string | null,
): { next: Record<string, unknown>; result: ProfileMergeResult } {
  const next = { ...profile };
  const added: string[] = [];
  const skipped: string[] = [];

  // On an identity card, issue and expiry are the CARD's dates, which IRCC
  // asks for (/national-id-doc); on a passport, the passport's. On any other
  // document they stay unmapped.
  const passport = !!documentType && isPassportType(documentType);
  const map: Record<string, string> =
    documentType && isIdCardType(documentType)
      ? { ...PROFILE_FIELD_MAP, ...NATIONAL_ID_DATE_MAP }
      : passport
        ? { ...PROFILE_FIELD_MAP, ...PASSPORT_DATE_MAP }
        : PROFILE_FIELD_MAP;

  const agreement = isAgreementType(documentType);
  for (const [ocrKey, profileKey] of Object.entries(map)) {
    if (agreement && OWNED_PROPERTY_KEYS.has(ocrKey)) continue;
    const value = extracted[ocrKey];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (
      passport &&
      ocrKey in PASSPORT_DATE_MAP &&
      !(typeof value === 'string' && ISO_DAY.test(value.trim()))
    )
      continue;

    if (hasAnswer(profile[profileKey])) {
      // The applicant already told us. Their answer stands.
      skipped.push(profileKey);
      continue;
    }
    next[profileKey] = value;
    added.push(profileKey);
  }

  return { next, result: { added, skipped } };
}

function hasAnswer(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/**
 * A business visitor's invitation letter, from a Canadian company → the keys
 * the business intake asks (#185). Mapped only when the letter names an
 * organization and describes no person host (a relationship or immigration
 * status): a company letter's signatory is often read as host_name, and is
 * the contact person.
 */
interface OrganizationTarget {
  /** Profile key written. */
  key: string;
  /** OCR keys read, in order: a company letter's contact is often read as host_*. */
  from: string[];
  /** Profile keys that already answer the same fact (the intake's aliases). */
  answeredBy: string[];
  /** An `inviter` / `host` object on the profile already answers it. */
  inviterFact?: boolean;
}

const INVITING_ORGANIZATION_TARGETS: readonly OrganizationTarget[] = [
  {
    key: 'canadian_business_name',
    from: ['organization_name'],
    answeredBy: [
      'canadian_company_name',
      'host_company_name',
      'inviting_company_name',
    ],
  },
  {
    key: 'inviter_name',
    from: ['contact_name', 'host_name'],
    answeredBy: [
      'inviter_full_name',
      'host_name',
      'host_full_name',
      'family_member_name',
      'business_contact_name',
    ],
    inviterFact: true,
  },
  {
    key: 'inviter_phone',
    from: ['contact_phone', 'host_phone'],
    answeredBy: ['host_phone', 'host_telephone', 'business_contact_phone'],
    inviterFact: true,
  },
  {
    key: 'inviter_email',
    from: ['contact_email', 'host_email'],
    answeredBy: ['host_email', 'business_contact_email'],
    inviterFact: true,
  },
  {
    key: 'inviter_address',
    from: ['organization_address', 'host_address'],
    answeredBy: [
      'host_address',
      'host_home_address',
      'canadian_business_address',
      'company_address',
    ],
    inviterFact: true,
  },
  { key: 'event_code', from: ['event_code'], answeredBy: ['ircc_event_code'] },
];

/** A relative's or friend's letter: the host describes a person, not a company. */
const PERSON_HOST_KEYS = ['host_relationship', 'host_status'];
const INVITER_OBJECT_KEYS = ['inviter', 'host', 'host_in_canada'];

function nonEmptyObject(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).some(hasAnswer)
  );
}

export function isInvitationLetter(
  documentType: string | null | undefined,
  slot: DocumentSlot | null | undefined,
): boolean {
  return [documentType, slot?.slotType].some((t) =>
    /invitation/.test((t ?? '').toLowerCase()),
  );
}

/**
 * Business visitor route only: the IRCC fill reads inviter_* before host_*,
 * so a company contact written to inviter_name on a family route would
 * outrank the applicant's real host. Gap-fill only — any alias of the fact,
 * or an `inviter` / `host` object, counts as answered; a value this same
 * document wrote earlier does not, so a re-read can correct it. Each value
 * is recorded in the document sources. Mutates `profile`; returns the keys
 * it filled.
 */
export function routeInvitingOrganization(
  profile: Record<string, unknown>,
  extracted: ExtractedFields,
  doc: { id: string; type: string; visaaiId: string | null | undefined },
): string[] {
  if (!isBusinessVisitorRoute(doc.visaaiId)) return [];
  if (!hasAnswer(extracted.organization_name)) return [];
  if (PERSON_HOST_KEYS.some((k) => hasAnswer(extracted[k]))) return [];

  const sources = sourcesOf(profile);
  const ours = (k: string) =>
    sources[k]?.document_id === doc.id && sources[k]?.value === profile[k];
  const answered = (k: string) => hasAnswer(profile[k]) && !ours(k);
  const inviterObject = INVITER_OBJECT_KEYS.some((k) =>
    nonEmptyObject(profile[k]),
  );

  const filled: string[] = [];
  for (const t of INVITING_ORGANIZATION_TARGETS) {
    if (answered(t.key) || t.answeredBy.some(answered)) continue;
    if (t.inviterFact && inviterObject) continue;
    const raw = t.from.map((k) => extracted[k]).find(hasAnswer);
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (profile[t.key] === value) continue;
    profile[t.key] = value;
    sources[t.key] = { document_id: doc.id, document_type: doc.type, value };
    filled.push(t.key);
  }
  if (filled.length) profile[DOCUMENT_SOURCES_KEY] = sources;
  return filled;
}

/** The application's registry route (`visa_types.visaai_id`), or null. Best effort. */
async function applicationRoute(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('applications')
      .select('visa_types(visaai_id)')
      .eq('id', applicationId)
      .maybeSingle();
    if (error || !data) return null;
    const vt = (data as { visa_types?: unknown }).visa_types;
    const one: unknown = Array.isArray(vt) ? (vt as unknown[])[0] : vt;
    const id = (one as { visaai_id?: unknown } | null | undefined)?.visaai_id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * marriage_date values earlier extractions on this application produced —
 * only looked up when it matters: a marriage certificate arriving on a
 * profile whose marriage_date has no provenance record (written before
 * provenance existed, e.g. prod's "16-9-1999"). Any failure means "none", so
 * the applicant's value is kept.
 */
async function priorMarriageDates(
  supabase: SupabaseClient,
  state: DocumentState,
  profile: Record<string, unknown>,
): Promise<string[]> {
  if (
    civilRecordKind(state.documentType, state.rawOcrText) !==
    'marriage_certificate'
  ) {
    return [];
  }
  const current = profile.marriage_date;
  if (typeof current !== 'string' || !current.trim()) return [];
  const sources = profile[DOCUMENT_SOURCES_KEY] as
    | Record<string, unknown>
    | undefined;
  if (sources && typeof sources === 'object' && sources.marriage_date)
    return [];
  try {
    const { data, error } = await supabase
      .from('document_verifications')
      .select('details_json, documents!inner(application_id)')
      .eq('documents.application_id', state.applicationId)
      .eq('verification_type', 'identity');
    if (error || !Array.isArray(data)) return [];
    const out: string[] = [];
    for (const row of data as Array<{ details_json?: unknown }>) {
      const details = row.details_json as {
        extracted_fields?: Record<string, unknown>;
        field_adjustments?: Record<string, unknown>;
      } | null;
      const v = details?.extracted_fields?.marriage_date;
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
      // Re-processing a document replaces its row, so the earlier read now
      // survives only as the value classify_document replaced — which this
      // run just recorded (store_verification runs before sync_profile).
      const adj = details?.field_adjustments?.marriage_date;
      const replaced =
        typeof adj === 'string' ? /^replaced "([^"]+)"/.exec(adj) : null;
      if (replaced) out.push(replaced[1].trim());
    }
    // Every OCR read ever made is also kept as an immutable provenance
    // version — the only record of an earlier read that survives a re-read
    // whose new extraction no longer mentions the old value.
    const { data: versions, error: provErr } = await supabase
      .from('field_provenance')
      .select('value_snapshot')
      .eq('application_id', state.applicationId)
      .eq('field_key', 'marriage_date')
      .eq('origin', 'ocr');
    if (!provErr && Array.isArray(versions)) {
      for (const v of versions as Array<{ value_snapshot?: unknown }>) {
        if (typeof v.value_snapshot === 'string' && v.value_snapshot.trim()) {
          out.push(v.value_snapshot.trim());
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * A Forms page generated before a passport was held (or found to be someone
 * else's) carries that person's name, DOB and number as source 'document',
 * and the consultant review and the IRCC fill read the saved form
 * (prod 2026-10-30). Clear those — only the applicant's own identity keys,
 * only on a same-kind whole-value match, and never a value the applicant's
 * own profile or other documents also hold (a brother's or spouse's
 * passport shares a surname and birthplace: review 2026-10-30). See
 * held-identity.ts. The field stays, empty and flagged for review; an empty
 * generated field never overrides the profile (applyPrefillOverrides).
 * Best-effort, like the note. No revision row: generated_document_revisions
 * only records a person's edit (edited_role applicant/consultant/admin).
 */
export async function clearHeldDocumentFromSavedForm(
  supabase: SupabaseClient,
  applicationId: string,
  documentId: string,
  profile: Record<string, unknown>,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('generated_documents')
      .select('id, content_md')
      .eq('application_id', applicationId)
      .eq('doc_type', 'prefilled_form_json')
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { id?: string; content_md?: string | null } | null;
    if (!row?.id || !row.content_md) return;
    const payload = JSON.parse(row.content_md) as PrefilledFormPayload;
    if (!payload || !Array.isArray(payload.fields)) return;
    const evidence = await loadHeldIdentity(supabase, applicationId, {
      extraHeldIds: [documentId],
      profile,
    });
    if (!evidence) return;
    if (scrubHeldIdentity(payload.fields, evidence.held, evidence.own) === 0)
      return;
    const { error: updErr } = await supabase
      .from('generated_documents')
      .update({ content_md: JSON.stringify(payload) })
      .eq('id', row.id);
    if (updErr) throw new Error(updErr.message);
  } catch (err) {
    safeLog.warn(
      'documents.sync_profile',
      `could not clear a held document from the saved form of ${applicationId}: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }
}

/**
 * Put the "this document seems to name someone else" note on the document's
 * identity verification row, where the Documents vault reads it. The row was
 * written fresh by store_verification earlier in this run, so a re-read that
 * no longer finds a mismatch starts from a row without the note. Best-effort:
 * a failure here never fails the document or the profile sync.
 */
async function recordHolderMismatch(
  supabase: SupabaseClient,
  documentId: string,
  mismatch: HolderMismatch & {
    needs_confirmation?: true;
    clearly_other?: true;
  },
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('document_verifications')
      .select('id, details_json')
      .eq('document_id', documentId)
      .eq('verification_type', 'identity')
      .order('verified_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : null) as {
      id?: string;
      details_json?: unknown;
    } | null;
    if (!row?.id) return;
    const details =
      row.details_json &&
      typeof row.details_json === 'object' &&
      !Array.isArray(row.details_json)
        ? (row.details_json as Record<string, unknown>)
        : {};
    const { error: updErr } = await supabase
      .from('document_verifications')
      .update({ details_json: { ...details, holder_mismatch: mismatch } })
      .eq('id', row.id);
    if (updErr) throw new Error(updErr.message);
  } catch (err) {
    safeLog.warn(
      'documents.sync_profile',
      `could not record holder mismatch for ${documentId}: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }
}

/** The applicant's own "this passport is mine", as stored on the identity row. */
export interface HolderConfirmation {
  confirmed_at: string;
  holder: string | null;
  stated_name: string | null;
}

/**
 * The applicant's latest confirmation that this held document is theirs
 * (document_holder_confirmations), unless the consultant has since rejected
 * it or asked for a re-upload. Null when there is none or it cannot be read
 * — the hold then stands.
 */
async function applicantConfirmation(
  supabase: SupabaseClient,
  applicationId: string,
  documentId: string,
): Promise<HolderConfirmation | null> {
  try {
    const [c, r] = await Promise.all([
      supabase
        .from(HOLDER_CONFIRMATIONS_TABLE)
        .select('created_at, holder_name, stated_name')
        .eq('application_id', applicationId)
        .eq('document_id', documentId),
      supabase
        .from('application_item_reviews')
        .select('item_kind, item_id, decision, created_at')
        .eq('application_id', applicationId)
        .eq('item_id', documentId),
    ]);
    if (c.error || r.error || !Array.isArray(c.data) || !c.data.length) {
      return null;
    }
    const decisionRows: ItemDecisionRow[] = Array.isArray(r.data) ? r.data : [];
    const latest = latestDocumentDecision(decisionRows).get(documentId);
    if (latest === 'rejected' || latest === 'needs_reupload') return null;
    const row = (
      c.data as Array<{
        created_at?: unknown;
        holder_name?: unknown;
        stated_name?: unknown;
      }>
    )
      .slice()
      .sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )[0];
    return {
      confirmed_at: typeof row.created_at === 'string' ? row.created_at : '',
      holder: typeof row.holder_name === 'string' ? row.holder_name : null,
      stated_name: typeof row.stated_name === 'string' ? row.stated_name : null,
    };
  } catch {
    return null;
  }
}

/**
 * Put the applicant's confirmation on the identity row in place of the hold,
 * for the vault and the consultant's review to show. Best-effort.
 */
async function recordHolderConfirmation(
  supabase: SupabaseClient,
  documentId: string,
  confirmation: HolderConfirmation,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('document_verifications')
      .select('id, details_json')
      .eq('document_id', documentId)
      .eq('verification_type', 'identity')
      .order('verified_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : null) as {
      id?: string;
      details_json?: unknown;
    } | null;
    if (!row?.id) return;
    const details =
      row.details_json &&
      typeof row.details_json === 'object' &&
      !Array.isArray(row.details_json)
        ? { ...(row.details_json as Record<string, unknown>) }
        : {};
    delete details.holder_mismatch;
    const { error: updErr } = await supabase
      .from('document_verifications')
      .update({
        details_json: { ...details, holder_confirmation: confirmation },
      })
      .eq('id', row.id);
    if (updErr) throw new Error(updErr.message);
  } catch (err) {
    safeLog.warn(
      'documents.sync_profile',
      `could not record holder confirmation for ${documentId}: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }
}

const STATED_NAME_KEYS = ['full_name', 'given_name', 'family_name'] as const;

/** The applicant's own (no document provenance) name keys. */
function statedNameParts(
  profile: Record<string, unknown>,
): Partial<Record<(typeof STATED_NAME_KEYS)[number], string>> {
  const sources = sourcesOf(profile);
  const out: Partial<Record<(typeof STATED_NAME_KEYS)[number], string>> = {};
  for (const k of STATED_NAME_KEYS) {
    const v = profile[k];
    if (!sources[k] && typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

const joinName = (
  p: Partial<Record<(typeof STATED_NAME_KEYS)[number], string>>,
): string =>
  p.full_name ?? [p.given_name, p.family_name].filter(Boolean).join(' ');

/**
 * The name the applicant gave, replaced by their confirmed passport's, is
 * still a name they use: kept in `other_names` (once), unless it is the same
 * person's name spelled differently. Mutates `profile`; true when it added one.
 */
export function keepStatedNameAsOtherName(
  profile: Record<string, unknown>,
  stated: Partial<Record<(typeof STATED_NAME_KEYS)[number], string>>,
  holder: string,
): boolean {
  const name = joinName(stated);
  if (!name || !normalizePersonName(name)) return false;
  if (holder && isSamePerson(name, holder)) return false;
  const current = profile.other_names;
  const list: unknown[] = Array.isArray(current)
    ? [...(current as unknown[])]
    : typeof current === 'string' && current.trim()
      ? [current]
      : [];
  const already = list.some((o) => {
    const r =
      o && typeof o === 'object' && !Array.isArray(o)
        ? (o as Record<string, unknown>)
        : { full_name: o };
    const n =
      typeof r.full_name === 'string' && r.full_name.trim()
        ? r.full_name
        : [r.given_name, r.family_name]
            .filter((x) => typeof x === 'string' && x)
            .join(' ');
    return !!n && isSamePerson(n, name);
  });
  if (already) return false;
  list.push({
    ...(stated.given_name || stated.family_name
      ? {
          ...(stated.given_name ? { given_name: stated.given_name } : {}),
          ...(stated.family_name ? { family_name: stated.family_name } : {}),
        }
      : { full_name: name }),
    source: 'stated_before_confirmed_passport',
  });
  profile.other_names = list;
  return true;
}

/**
 * The checklist slot the document was uploaded into, or null (an
 * "Additional document" upload, or the lookup failed). The slot is read from
 * the checklist row, not from `documents.document_type`: classify_document
 * re-types a civil record found in a relationship slot, and the job's type
 * for a host's passport is the slot code only by accident.
 */
async function documentSlot(
  supabase: SupabaseClient,
  documentId: string,
): Promise<DocumentSlot | null> {
  try {
    const { data: doc, error } = await supabase
      .from('documents')
      .select('checklist_item_id')
      .eq('id', documentId)
      .maybeSingle();
    const itemId = (doc as { checklist_item_id?: unknown } | null)
      ?.checklist_item_id;
    if (error || typeof itemId !== 'string' || !itemId) return null;
    const { data: item, error: itemErr } = await supabase
      .from('checklist_items')
      .select('document_type, meta')
      .eq('id', itemId)
      .maybeSingle();
    if (itemErr || !item) return null;
    const row = item as { document_type?: unknown; meta?: unknown };
    const meta =
      row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    return {
      slotType:
        typeof row.document_type === 'string' ? row.document_type : null,
      owner: typeof meta.owner === 'string' ? meta.owner : null,
      familyGap: !!meta.family_gap,
    };
  } catch {
    return null;
  }
}

/**
 * The profile without the values this document wrote on an earlier read and
 * that nobody has changed since (provenance value still equal). The merge
 * then re-adds whatever the new read supports. A value the applicant or a
 * consultant changed no longer equals its provenance, and stays.
 */
/** JSON with object keys sorted, so a re-ordered map is not a change. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

export function forgetOwnDocumentValues(
  profile: Record<string, unknown>,
  documentId: string | null | undefined,
  extracted?: Record<string, unknown>,
): Record<string, unknown> {
  const sources = profile[DOCUMENT_SOURCES_KEY];
  if (!documentId || !sources || typeof sources !== 'object') return profile;
  // A degraded re-read (a rate-limited fallback, a partial OCR) returns a
  // handful of fields; it must not wipe what a good read wrote. Refresh only
  // when the new read is at least half the size of what this document wrote.
  if (extracted) {
    const own = Object.values(sources as Record<string, unknown>).filter(
      (src) =>
        (src as { document_id?: unknown } | null)?.document_id === documentId,
    ).length;
    const fresh = Object.values(extracted).filter(
      (v) => v !== undefined && v !== null && v !== '',
    ).length;
    if (fresh * 2 < own) return profile;
  }
  const kept: Record<string, unknown> = {};
  const next: Record<string, unknown> = { ...profile };
  let forgot = false;
  for (const [key, src] of Object.entries(sources as Record<string, unknown>)) {
    const s = src as { document_id?: unknown; value?: unknown } | null;
    if (
      s?.document_id === documentId &&
      JSON.stringify(s.value) === JSON.stringify(profile[key])
    ) {
      // null, as retractForeignIdentity leaves it: "no value" that the merge
      // below may fill again.
      next[key] = null;
      forgot = true;
      continue;
    }
    kept[key] = src;
  }
  if (!forgot) return profile;
  next[DOCUMENT_SOURCES_KEY] = kept;
  return next;
}

export function makeSyncProfileNode(supabase: SupabaseClient) {
  return async function syncProfile(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};
    // A photograph states no facts about anyone; whatever a read of it
    // returned (a studio stamp, a date) is not the applicant's passport
    // (prod 2026-10-24, `passport_photos`).
    if (isPhotoDocumentType(state.documentType)) return {};
    // A lease or other contract describes nobody's identity (classify_document
    // strips what it quotes from its parties), so its read may be empty — and
    // an empty read used to return here, keeping whatever an earlier misread
    // of it as an ID card wrote (prod 2026-10-19).
    const agreement = isAgreementType(state.documentType);
    const extracted = state.extractedFields ?? {};
    if (!agreement && Object.keys(extracted).length === 0) return {};

    try {
      // The `error` here is LOAD-BEARING, not decoration.
      //
      // supabase-js resolves a failed read as `{ data: null, error }` rather
      // than rejecting. Dropping it made a failed read indistinguishable from
      // "this application has no profile row yet": `profile` fell back to `{}`,
      // the merge below produced ONLY the newly-extracted OCR fields, and the
      // upsert then replaced `profile_json` wholesale — destroying every answer
      // the applicant had already given during intake.
      //
      // That is the exact inverse of rule 1 at the top of this file. It would
      // also be invisible: with an empty `profile`, nothing is ever `skipped`,
      // so the log line reports "left 0 already answered" and reads as normal.
      //
      // `maybeSingle()` returns `{ data: null, error: null }` for a genuinely
      // missing row, which is legitimate and still merges into `{}` — only a
      // real failure aborts, into the catch below that leaves the profile
      // untouched, as this file's contract promises.
      const { data: row, error: readErr } = await supabase
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', state.applicationId)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);

      const raw = (row as { profile_json?: unknown } | null)?.profile_json;
      const stored =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      // A re-read replaces what this document itself wrote, so a corrected
      // extraction can correct the profile (live E2E 2026-10-18: an address
      // line read as the name, and a landlord's card date as the date of
      // birth, survived every re-read because the merge only gap-fills).
      //
      // An agreement's read is small because it is complete, not degraded:
      // what it wrote before is retracted without the degraded-read guard,
      // and the merge below re-adds whatever non-identity fields it still has.
      const profile = forgetOwnDocumentValues(
        stored,
        state.documentId,
        agreement ? undefined : extracted,
      );

      // Family documents (birth / marriage certificates, a relative's ID)
      // describe somebody else: they are routed to the family section and
      // never through the identity map below (sync-family.ts).
      //
      // Whose document is it? A host's passport, a son's T4 or a child's
      // birth certificate must never write the applicant's identity
      // (document-subject.ts, prod 2026-10-16 super visa).
      const slot = await documentSlot(supabase, state.documentId);
      const decision = documentSubject({
        profile,
        extracted,
        documentType: state.documentType,
        slot,
      });
      // Somebody else's personal document in the applicant's own slot (live
      // E2E 2026-10-20): the applicant is told on the document itself.
      // documentSubject calls it 'unknown', which gap-fills as before — a
      // name that merely reads differently ("Mohammad" / "MUHAMMAD", a
      // maiden name) must not stop the applicant's own passport filling
      // their profile. Only a document that is CLEARLY someone else's (its
      // number AND its date of birth differ from the profile's) writes
      // nothing and has what it wrote before retracted.
      //
      // Judged against the profile as stored, minus what THIS document wrote
      // (documentId): even a degraded re-read, which forgetOwnDocumentValues
      // leaves untouched, must not find a stranger's passport "matching" the
      // number and DOB it filled itself before this check existed.
      const mismatch = holderMismatch({
        profile: stored,
        extracted,
        documentType: state.documentType,
        slot,
        documentId: state.documentId,
      });
      // The applicant confirmed this held passport is theirs ("This is my
      // passport", document_holder_confirmations): no hold, and it fills the
      // profile as their own passport. Never for one that is clearly someone
      // else's, nor in a slot that asks for somebody else's document.
      const confirmation =
        mismatch?.clearlyOther === true ||
        slotSubject(slot) === 'third_party' ||
        decision.subject === 'other'
          ? null
          : await applicantConfirmation(
              supabase,
              state.applicationId,
              state.documentId,
            );
      if (confirmation) {
        await recordHolderConfirmation(
          supabase,
          state.documentId,
          confirmation,
        );
      } else if (mismatch) {
        await recordHolderMismatch(supabase, state.documentId, {
          holder: mismatch.holder,
          applicant: mismatch.applicant,
          message: mismatch.message,
          ...(mismatch.needsConfirmation ? { needs_confirmation: true } : {}),
          // Stored so the prefill (load-context) skips it as well.
          ...(mismatch.clearlyOther ? { clearly_other: true } : {}),
        });
      }
      const clearlyOther = mismatch?.clearlyOther === true;
      // Held for confirmation: only the name says it may not be the
      // applicant's. Nothing written from it, nothing retracted.
      const held = mismatch?.needsConfirmation === true && !confirmation;
      if (clearlyOther || held) {
        await clearHeldDocumentFromSavedForm(
          supabase,
          state.applicationId,
          state.documentId,
          stored as Record<string, unknown>,
        );
      }
      const priorDocumentMarriageDates = await priorMarriageDates(
        supabase,
        state,
        profile,
      );
      const family = mergeFamilyDocument({
        profile,
        documentId: state.documentId,
        documentType: state.documentType ?? '',
        rawText: state.rawOcrText ?? '',
        extracted,
        priorDocumentMarriageDates,
        applicantOwnAllowed:
          decision.subject !== 'other' &&
          !clearlyOther &&
          !held &&
          slotSubject(slot) !== 'third_party',
      });
      let next = family.next;
      const result: ProfileMergeResult = {
        added: [...family.added],
        skipped: [...family.skipped],
      };
      const doc = {
        id: state.documentId,
        type: state.documentType ?? '',
      };
      const decisions: string[] = [
        `subject=${decision.subject} (${decision.reason})`,
        ...(confirmation
          ? ['the applicant confirmed this passport is theirs']
          : []),
        ...(mismatch && !confirmation
          ? [
              clearlyOther
                ? 'holder is clearly not the applicant: nothing written, applicant told'
                : held
                  ? "holder's name shares nothing with the applicant's: held for confirmation, nothing written"
                  : 'holder name differs from the applicant: applicant told',
            ]
          : []),
      ];
      // A card whose holder could not be read writes the applicant's identity
      // only when its number matched theirs (decision 'applicant').
      const unknownHolder =
        (extracted as Record<string, unknown>).holder_unknown === true &&
        decision.subject !== 'applicant';
      if (!family.handled) {
        if (
          decision.subject === 'other' ||
          unknownHolder ||
          clearlyOther ||
          held
        ) {
          // Someone else's document: none of its fields describe the
          // applicant. A host's own identity goes to the inviter fields.
          if (isHostSlot(slot)) {
            result.added.push(...routeHostIdentity(next, extracted));
          }
        } else {
          const generic = mergeExtractedIntoProfile(
            next,
            extracted,
            state.documentType,
          );
          next = generic.next;
          result.added.push(...generic.result.added);
          result.skipped.push(...generic.result.skipped);
          // Provenance, so a later re-read can tell a document's value from
          // the applicant's own answer.
          if (generic.result.added.length) {
            const sources = sourcesOf(next);
            for (const key of generic.result.added) {
              sources[key] = {
                document_id: doc.id,
                document_type: doc.type,
                value: next[key],
              };
            }
            next[DOCUMENT_SOURCES_KEY] = sources;
          }
          if (decision.ownIdentity || confirmation) {
            const statedBefore = confirmation ? statedNameParts(next) : {};
            const changes = applyOwnIdentity(next, extracted, doc);
            if (
              confirmation &&
              changes.some((c) =>
                (STATED_NAME_KEYS as readonly string[]).includes(c.key),
              ) &&
              keepStatedNameAsOtherName(
                next,
                statedBefore,
                String(extracted.full_name ?? confirmation.holder ?? ''),
              )
            ) {
              result.added.push('other_names');
              decisions.push(
                "other_names: kept the name the applicant gave, replaced by their confirmed passport's",
              );
            }
            for (const c of changes) {
              result.added.push(c.key);
              decisions.push(
                `${c.key}: the applicant's own document replaced an earlier value`,
              );
            }
          }
        }
        // Whoever the letter is "about", a company's invitation names the
        // company and its contact — never the applicant's own identity.
        if (isInvitationLetter(state.documentType, slot)) {
          const visaaiId = await applicationRoute(
            supabase,
            state.applicationId,
          );
          result.added.push(
            ...routeInvitingOrganization(next, extracted, { ...doc, visaaiId }),
          );
        }
      }
      // Repair: identity a foreign document wrote earlier (this one, re-read,
      // or a child's certificate taken for the applicant's own).
      const isBirthRecord =
        family.handled &&
        civilRecordKind(state.documentType, state.rawOcrText) ===
          'birth_certificate';
      const retracted = retractForeignIdentity(next, {
        foreignDoc:
          decision.subject === 'other'
            ? { id: state.documentId, extracted }
            : unknownHolder || clearlyOther
              ? // Undo what such a card wrote before it was marked.
                { id: state.documentId, extracted, provenanceOnly: true }
              : isBirthRecord && !family.applicantOwnRecord
                ? { id: state.documentId, extracted, provenanceOnly: true }
                : undefined,
      });
      for (const c of retracted) {
        decisions.push(`${c.key}: removed a value that was someone else's`);
      }
      if (Array.isArray(next.children)) {
        next.children = dedupePlaceholderChildren(next.children);
      }
      applyConsistencyFlags(next);
      const changed = stableJson(next) !== stableJson(stored);
      if (changed) {
        // Upsert, not update: the row exists for every application created
        // through intake, but a document can arrive on an application whose
        // profile row was never written.
        const { error } = await supabase.from('application_profiles').upsert(
          {
            application_id: state.applicationId,
            profile_json: next,
            last_updated_at: new Date().toISOString(),
          },
          { onConflict: 'application_id' },
        );
        if (error) throw new Error(error.message);

        safeLog.warn(
          'documents.sync_profile',
          `document ${state.documentId} filled ${result.added.length} profile ` +
            `field(s); left ${result.skipped.length} already answered by the applicant` +
            (family.notes.length
              ? ` (${family.notes.length} family decision(s))`
              : '') +
            `; ${decisions.join('; ')}`,
        );
      }

      // The checklist's family requests follow the profile: a birth
      // certificate that just supplied a child's date of birth closes that
      // child's request; a newly flagged marriage date marks the certificate
      // for attention. Runs even when nothing changed, so re-reading a
      // document reconciles a checklist synced before this existed.
      // Never throws.
      await syncFamilyGapsForApplication(supabase, state.applicationId, next);
      return {};
    } catch (err) {
      // Never fail a document over profile enrichment.
      safeLog.warn(
        'documents.sync_profile',
        `profile sync skipped for ${state.documentId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
      return {};
    }
  };
}
