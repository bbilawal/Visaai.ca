import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState, ExtractedFields } from '../document.state';
import { safeLog } from '../../../shared/log/redact';
import {
  applyConsistencyFlags,
  DOCUMENT_SOURCES_KEY,
  mergeFamilyDocument,
} from './sync-family';
import { civilRecordKind } from '../../ocr/civil-records';

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
  'scholarship_amount',
  'property_value',
  'currency',
  'account_number', // document-scoped, not a profile fact
  'expiry_date', // means "this document expires", not a profile attribute
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
): { next: Record<string, unknown>; result: ProfileMergeResult } {
  const next = { ...profile };
  const added: string[] = [];
  const skipped: string[] = [];

  for (const [ocrKey, profileKey] of Object.entries(PROFILE_FIELD_MAP)) {
    const value = extracted[ocrKey];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' && value.trim() === '') continue;

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
    return out;
  } catch {
    return [];
  }
}

export function makeSyncProfileNode(supabase: SupabaseClient) {
  return async function syncProfile(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};
    const extracted = state.extractedFields;
    if (!extracted || Object.keys(extracted).length === 0) return {};

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
      const profile =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};

      // Family documents (birth / marriage certificates, a relative's ID)
      // describe somebody else: they are routed to the family section and
      // never through the identity map below (sync-family.ts).
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
      });
      let next = family.next;
      const result: ProfileMergeResult = {
        added: [...family.added],
        skipped: [...family.skipped],
      };
      if (!family.handled) {
        const generic = mergeExtractedIntoProfile(next, extracted);
        next = generic.next;
        result.added.push(...generic.result.added);
        result.skipped.push(...generic.result.skipped);
      }
      const flagsChanged = applyConsistencyFlags(next);
      if (result.added.length === 0 && !flagsChanged) return {};

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
          (flagsChanged ? '; consistency flags updated' : ''),
      );
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
