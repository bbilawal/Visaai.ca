import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortalDocument } from '../automation/portal-fills/ircc-uploads';
import {
  latestDocumentDecision,
  loadApplicantConfirmedDocumentIds,
  type ItemDecisionRow,
} from '../prefill/graphs/nodes/held-identity';

/**
 * The application's documents a portal fill may attach: uploaded and read
 * successfully, not a byte-for-byte duplicate, and not rejected or sent back
 * for re-upload by the consultant (their latest decision counts). Server state
 * only, ordered deterministically — it feeds the locked review, whose hash
 * must reproduce at execution time.
 */
export async function loadPortalDocuments(
  db: SupabaseClient,
  applicationId: string,
): Promise<PortalDocument[]> {
  // A failed read is "nothing to attach", never a partial list: the slots are
  // then left for the applicant, which is safe.
  let docs: unknown[] | null = null;
  let decisions: unknown[] | null = null;
  let identities: unknown[] | null = null;
  // The applicant's own "this passport is mine" (document_holder_confirmations):
  // releases a name hold the way an approval does. Unreadable → none.
  const confirmedByApplicant = loadApplicantConfirmedDocumentIds(
    db,
    applicationId,
  );
  try {
    const [d, r, v] = await Promise.all([
      db
        .from('documents')
        .select(
          'id, document_type, file_name, mime_type, upload_status, ocr_status, dup_status, created_at',
        )
        .eq('application_id', applicationId),
      db
        .from('application_item_reviews')
        .select('item_kind, item_id, decision, created_at')
        .eq('application_id', applicationId),
      db
        .from('document_verifications')
        .select(
          'document_id, verification_type, details_json, documents!inner(application_id)',
        )
        .eq('documents.application_id', applicationId),
    ]);
    if (d.error || r.error || v.error) return [];
    docs = d.data;
    decisions = r.data;
    identities = v.data;
  } catch {
    return [];
  }

  const latest = latestDocumentDecision((decisions ?? []) as ItemDecisionRow[]);
  const confirmed = await confirmedByApplicant;

  // An identity card whose holder could not be read (classify-document marks
  // it holder_unknown) is not the applicant's to attach — a tenancy
  // agreement's CNIC copies went into IRCC's national ID slot (live E2E
  // 2026-10-18) — unless the consultant approved it.
  const holderUnknown = new Set<string>();
  // A passport whose name doesn't match the name the applicant gave
  // (needs_confirmation): held until the consultant approves it or the
  // applicant confirms it is theirs.
  const heldForConfirmation = new Set<string>();
  // Clearly someone else's (sync_profile: number AND DOB differ): never the
  // applicant's to attach. Approval does not release it — it only releases a
  // hold (needs_confirmation), the same rule the prefill applies.
  const clearlyOther = new Set<string>();
  for (const x of (identities ?? []) as Array<{
    document_id: string;
    verification_type: string;
    details_json: unknown;
  }>) {
    if (x.verification_type !== 'identity') continue;
    const fields = (x.details_json as { extracted_fields?: unknown } | null)
      ?.extracted_fields as Record<string, unknown> | undefined;
    if (fields?.holder_unknown === true) holderUnknown.add(x.document_id);
    // A passport whose name doesn't match the name the applicant gave is
    // held the same way until confirmed (sync_profile, live 2026-10-29).
    const mismatch = (x.details_json as { holder_mismatch?: unknown } | null)
      ?.holder_mismatch as
      | { needs_confirmation?: unknown; clearly_other?: unknown }
      | undefined;
    if (mismatch?.needs_confirmation === true) {
      heldForConfirmation.add(x.document_id);
    }
    if (mismatch?.clearly_other === true) clearlyOther.add(x.document_id);
  }

  type Row = {
    id: string;
    document_type: string | null;
    file_name: string;
    mime_type: string;
    upload_status: string;
    ocr_status: string;
    dup_status: string | null;
    created_at: string;
  };
  return ((docs ?? []) as Row[])
    .filter(
      (d) =>
        !!d.document_type &&
        d.upload_status === 'complete' &&
        d.ocr_status === 'complete' &&
        d.dup_status !== 'exact_dup' &&
        latest.get(d.id) !== 'rejected' &&
        latest.get(d.id) !== 'needs_reupload' &&
        !clearlyOther.has(d.id) &&
        (!holderUnknown.has(d.id) || latest.get(d.id) === 'approved') &&
        (!heldForConfirmation.has(d.id) ||
          latest.get(d.id) === 'approved' ||
          confirmed.has(d.id)),
    )
    .map((d) => ({
      id: d.id,
      documentType: d.document_type as string,
      fileName: d.file_name,
      mimeType: d.mime_type,
      approved: latest.get(d.id) === 'approved',
      createdAt: d.created_at,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
