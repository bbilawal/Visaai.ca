import type { SupabaseClient } from '@supabase/supabase-js';
import type { PrefilledFormField } from '@visaai/types';
import { comparableValue } from './applicant-guards';

/**
 * A passport sync_profile held (holder_mismatch.needs_confirmation) or found
 * to be clearly someone else's (clearly_other) must not put its holder's
 * identity on the applicant's form (prod 2026-10-30, after #299).
 *
 * Shared by load-context (skip it), sync_profile (clear it from a form saved
 * before the hold) and store-prefill (re-check right before writing, for a
 * Regenerate that read the verifications before the hold landed).
 */

export type IdentityKind =
  | 'family'
  | 'given'
  | 'full'
  | 'dob'
  | 'number'
  | 'issue'
  | 'expiry';

/**
 * The applicant's OWN identity keys, matched whole: a relative's name
 * (father_family_name), a place or a nationality is never one — a brother
 * or a spouse shares those (review 2026-10-30).
 */
const KIND_BY_KEY: Record<string, IdentityKind> = {
  family_name: 'family',
  surname: 'family',
  last_name: 'family',
  given_name: 'given',
  given_names: 'given',
  first_name: 'given',
  full_name: 'full',
  name: 'full',
  date_of_birth: 'dob',
  dob: 'dob',
  birth_date: 'dob',
  passport_number: 'number',
  passport_no: 'number',
  document_number: 'number',
  id_number: 'number',
  national_id_number: 'number',
  issue_date: 'issue',
  date_of_issue: 'issue',
  passport_issue_date: 'issue',
  passport_date_of_issue: 'issue',
  expiry_date: 'expiry',
  date_of_expiry: 'expiry',
  expiration_date: 'expiry',
  passport_expiry_date: 'expiry',
  passport_date_of_expiry: 'expiry',
};

export function identityKind(key: string): IdentityKind | null {
  const k = key.toLowerCase().replace(/^applicant_/, '');
  return KIND_BY_KEY[k] ?? null;
}

function valuesByKind(
  records: ReadonlyArray<Record<string, unknown>>,
): Map<IdentityKind, Set<string>> {
  const out = new Map<IdentityKind, Set<string>>();
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      const kind = identityKind(k);
      if (!kind) continue;
      const c = comparableValue(v);
      if (c.length < 2) continue;
      if (!out.has(kind)) out.set(kind, new Set());
      out.get(kind)!.add(c);
    }
  }
  return out;
}

/**
 * Clear, in place, the form's document-sourced identity fields whose whole
 * value is a held document's value for the same kind of key — unless the
 * applicant's own profile or one of their non-held documents holds that
 * same value (a shared surname stays). Returns how many were cleared.
 */
export function scrubHeldIdentity(
  fields: PrefilledFormField[],
  held: ReadonlyArray<Record<string, unknown>>,
  own: ReadonlyArray<Record<string, unknown>>,
): number {
  const heldVals = valuesByKind(held);
  if (heldVals.size === 0) return 0;
  const ownVals = valuesByKind(own);
  let cleared = 0;
  for (const f of fields) {
    if (f.source !== 'document') continue;
    const kind = identityKind(f.key);
    if (!kind) continue;
    const c = comparableValue(f.value);
    if (!c || !heldVals.get(kind)?.has(c)) continue;
    if (ownVals.get(kind)?.has(c)) continue;
    f.value = '';
    f.needsReview = true;
    f.note =
      "Removed: this came from a passport that may not be the applicant's.";
    cleared++;
  }
  return cleared;
}

/**
 * Whether sync_profile's holder note withholds a document: clearly someone
 * else's always; held for confirmation until the consultant approves it (the
 * rule portal-documents.ts applies to attachments). `approved` is
 * documentHolds().released: a consultant approval or the applicant's own
 * confirmation. `revoked` (documentHolds().revoked): an applicant
 * confirmation the consultant has since rejected or sent back — held again
 * whatever the row's notes say (sync_profile replaced the hold note with
 * holder_confirmation, and details_json is owner-writable).
 */
export function holdOf(
  details: unknown,
  documentId: string | null | undefined,
  approved: ReadonlySet<string>,
  revoked: ReadonlySet<string> = new Set(),
): 'third_party' | 'unattributed' | null {
  const m =
    details && typeof details === 'object'
      ? ((details as { holder_mismatch?: unknown }).holder_mismatch as
          | { needs_confirmation?: unknown; clearly_other?: unknown }
          | null
          | undefined)
      : undefined;
  if (m && typeof m === 'object' && m.clearly_other === true) {
    return 'third_party';
  }
  if (documentId && revoked.has(documentId)) return 'unattributed';
  if (!m || typeof m !== 'object') return null;
  if (m.needs_confirmation === true) {
    return documentId && approved.has(documentId) ? null : 'unattributed';
  }
  return null;
}

/**
 * The applicant's own "this passport is mine" (POST
 * /documents/item/:id/confirm-holder): append-only rows in
 * document_holder_confirmations, service-role written. Not details_json —
 * that is rewritten on every re-read and writable by the owner.
 */
export const HOLDER_CONFIRMATIONS_TABLE = 'document_holder_confirmations';

/** Documents the applicant confirmed as theirs. Unreadable → none (held stays held). */
export async function loadApplicantConfirmedDocumentIds(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from(HOLDER_CONFIRMATIONS_TABLE)
      .select('document_id')
      .eq('application_id', applicationId);
    if (error || !Array.isArray(data)) return new Set();
    return new Set(
      (data as Array<{ document_id?: unknown }>)
        .map((r) => (typeof r.document_id === 'string' ? r.document_id : ''))
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

export interface ItemDecisionRow {
  item_kind: string;
  item_id: string;
  decision: string;
  created_at: string;
}

/** The latest consultant decision per document id. */
export function latestDocumentDecision(
  rows: ReadonlyArray<ItemDecisionRow>,
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const r of rows
    .filter((x) => x.item_kind === 'document')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))))
    latest.set(r.item_id, r.decision);
  return latest;
}

export interface DocumentHolds {
  /** Hold released: consultant-approved, or applicant-confirmed and not sent back. */
  released: Set<string>;
  /**
   * Applicant-confirmed, but the consultant's latest decision is rejected /
   * needs_reupload: held again, and what the confirmation wrote to the
   * profile is not used (withoutHeldDocumentValues).
   */
  revoked: Set<string>;
}

/**
 * Which held documents are released: the consultant's latest decision is
 * 'approved', or the applicant confirmed it and the consultant has not
 * rejected it or asked for a re-upload since (then it is revoked). holdOf
 * still never releases a clearly-someone-else's document.
 */
export function documentHolds(
  decisions: ReadonlyArray<ItemDecisionRow>,
  applicantConfirmed: ReadonlySet<string>,
): DocumentHolds {
  const latest = latestDocumentDecision(decisions);
  const released = new Set(
    [...latest].filter(([, d]) => d === 'approved').map(([id]) => id),
  );
  const revoked = new Set<string>();
  for (const id of applicantConfirmed) {
    const d = latest.get(id);
    if (d === 'rejected' || d === 'needs_reupload') revoked.add(id);
    else released.add(id);
  }
  return { released, revoked };
}

/** documentHolds().released. */
export function releasedDocumentIds(
  decisions: ReadonlyArray<ItemDecisionRow>,
  applicantConfirmed: ReadonlySet<string>,
): Set<string> {
  return documentHolds(decisions, applicantConfirmed).released;
}

/**
 * documentHolds for an application. Unreadable decisions: nothing released,
 * and every applicant-confirmed document revoked (held) — safe.
 */
export async function loadDocumentHolds(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<DocumentHolds> {
  const [{ data, error }, confirmed] = await Promise.all([
    supabase
      .from('application_item_reviews')
      .select('item_kind, item_id, decision, created_at')
      .eq('application_id', applicationId),
    loadApplicantConfirmedDocumentIds(supabase, applicationId),
  ]);
  if (error || !Array.isArray(data)) {
    return { released: new Set(), revoked: new Set(confirmed) };
  }
  const rows: ItemDecisionRow[] = data;
  return documentHolds(rows, confirmed);
}

/** loadDocumentHolds().released. */
export async function loadApprovedDocumentIds(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<Set<string>> {
  return (await loadDocumentHolds(supabase, applicationId)).released;
}

/**
 * The profile without the values a held document wrote (provenance in
 * `_document_sources`) that nobody has changed since. Used by the prefill so
 * an applicant-confirmed passport the consultant later rejected stops
 * feeding the form. The profile row itself is not rewritten.
 */
export function withoutHeldDocumentValues(
  profile: Record<string, unknown>,
  heldIds: ReadonlySet<string>,
): Record<string, unknown> {
  if (heldIds.size === 0) return profile;
  const sources = profile._document_sources;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    return profile;
  }
  let out: Record<string, unknown> | null = null;
  for (const [key, src] of Object.entries(sources as Record<string, unknown>)) {
    const s = src as { document_id?: unknown; value?: unknown } | null;
    if (
      s &&
      typeof s.document_id === 'string' &&
      heldIds.has(s.document_id) &&
      JSON.stringify(s.value) === JSON.stringify(profile[key])
    ) {
      out ??= { ...profile };
      delete out[key];
    }
  }
  return out ?? profile;
}

const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The application's held documents' extracted fields, and the applicant's
 * own evidence: the profile (minus what a held document wrote, by
 * provenance) and every non-held document's fields. `extraHeldIds` counts a
 * document as held even if its note could not be written. Null when anything
 * could not be read — the caller then changes nothing.
 */
export async function loadHeldIdentity(
  supabase: SupabaseClient,
  applicationId: string,
  opts: { extraHeldIds?: string[]; profile?: Record<string, unknown> } = {},
): Promise<{
  held: Array<Record<string, unknown>>;
  own: Array<Record<string, unknown>>;
} | null> {
  try {
    const { data: docs, error: docErr } = await supabase
      .from('documents')
      .select('id')
      .eq('application_id', applicationId);
    if (docErr || !Array.isArray(docs)) return null;
    const ids = (docs as Array<{ id: string }>).map((d) => d.id);
    if (ids.length === 0) return { held: [], own: [] };
    const { data: rows, error: verErr } = await supabase
      .from('document_verifications')
      .select('document_id, verification_type, details_json')
      .in('document_id', ids);
    if (verErr || !Array.isArray(rows)) return null;
    const holds = await loadDocumentHolds(supabase, applicationId);
    const extra = new Set(opts.extraHeldIds ?? []);

    const held: Array<Record<string, unknown>> = [];
    const heldIds = new Set<string>();
    const ownDocs: Array<Record<string, unknown>> = [];
    for (const r of rows as Array<{
      document_id: string;
      verification_type?: string | null;
      details_json?: unknown;
    }>) {
      if (r.verification_type && r.verification_type !== 'identity') continue;
      const fields = plainObject(r.details_json)
        ? (r.details_json as { extracted_fields?: unknown }).extracted_fields
        : undefined;
      if (!plainObject(fields)) continue;
      if (
        extra.has(r.document_id) ||
        holdOf(r.details_json, r.document_id, holds.released, holds.revoked)
      ) {
        held.push(fields);
        heldIds.add(r.document_id);
      } else {
        ownDocs.push(fields);
      }
    }
    if (held.length === 0) return { held, own: ownDocs };

    let profile = opts.profile;
    if (!profile) {
      const { data, error } = await supabase
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', applicationId)
        .maybeSingle();
      if (error) return null;
      const pj = (data as { profile_json?: unknown } | null)?.profile_json;
      profile = plainObject(pj) ? pj : {};
    }
    const sources = plainObject(profile._document_sources)
      ? (profile._document_sources as Record<string, unknown>)
      : {};
    const ownProfile: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(profile)) {
      const src = sources[k] as { document_id?: unknown } | undefined;
      if (src && heldIds.has(String(src.document_id))) continue;
      ownProfile[k] = v;
    }
    return { held, own: [ownProfile, ...ownDocs] };
  } catch {
    return null;
  }
}
