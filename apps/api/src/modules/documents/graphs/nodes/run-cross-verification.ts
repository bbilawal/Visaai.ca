import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import {
  GENERIC_MISMATCH_NOTE,
  compareIdentityField,
  genericDobIsAnotherDate,
  identityRole,
} from './identity-compare';

const COMPARABLE_FIELDS = [
  'full_name',
  'date_of_birth',
  'passport_number',
  'nationality',
];

const MISMATCH_SUGGESTIONS: Record<string, string> = {
  full_name:
    'Your full legal name differs across these documents. Use the spelling from your passport everywhere — re-issue or correct the other document so they match.',
  date_of_birth:
    'Your date of birth differs across these documents. Confirm the correct date from your passport and request a correction on the document that disagrees.',
  passport_number:
    'The passport number differs. Re-upload the document that references the wrong passport, or ask the issuer to update it before submitting your application.',
  nationality:
    'Your nationality differs across these documents. Make sure every document lists the citizenship that matches your passport.',
};

interface DocRow {
  id: string;
  document_type: string | null;
}
interface VerificationRow {
  document_id: string;
  details_json: unknown;
}
interface CrossRow {
  id: string;
  doc_a_id: string;
  doc_b_id: string;
  field_compared: string;
}

export function makeRunCrossVerificationNode(supabase: SupabaseClient) {
  return async function runCrossVerification(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, document_type')
      .eq('application_id', state.applicationId);

    // Only the applicant's identity documents (and untyped uploads, which may
    // be an ID scan) take part. Supporting evidence — a host's invitation, a
    // sponsor's bank statement or employment letter, insurance, a marriage
    // certificate — is legitimately in someone else's name and is never
    // compared (dry run 2026-10-14).
    const eligible = ((docs ?? []) as DocRow[]).filter(
      (d) => identityRole(d.document_type) !== 'supporting',
    );

    const latestByDoc = new Map<string, Record<string, unknown>>();
    // Documents whose identity type came from their OCR text, not the slot the
    // user chose (classify_document). An ID found in the "Additional document"
    // slot may be a spouse's or parent's card, so it is compared tolerantly.
    const typedFromContent = new Set<string>();
    if (eligible.length >= 2) {
      // Batch-fetch all identity verifications (avoids N+1), keep the latest per document
      const { data: allVerifications } = await supabase
        .from('document_verifications')
        .select('document_id, details_json, verified_at')
        .in(
          'document_id',
          eligible.map((d) => d.id),
        )
        .eq('verification_type', 'identity')
        .order('verified_at', { ascending: false });

      for (const v of (allVerifications ?? []) as VerificationRow[]) {
        if (!latestByDoc.has(v.document_id)) {
          const details = v.details_json as {
            extracted_fields?: Record<string, unknown>;
            classified_from_content?: unknown;
          } | null;
          latestByDoc.set(v.document_id, details?.extracted_fields ?? {});
          if (details?.classified_from_content) {
            typedFromContent.add(v.document_id);
          }
        }
      }
    }

    const docFields = eligible.map((doc) => ({
      docId: doc.id,
      docType: doc.document_type,
      role:
        typedFromContent.has(doc.id) &&
        identityRole(doc.document_type) === 'identity'
          ? ('generic' as const)
          : identityRole(doc.document_type),
      fields: latestByDoc.get(doc.id) ?? {},
    }));

    const crossResults: Array<{
      doc_a_id: string;
      doc_b_id: string;
      field: string;
      result: 'match' | 'mismatch' | 'warning';
      details: Record<string, unknown>;
    }> = [];

    const now = new Date();
    for (let i = 0; i < docFields.length; i++) {
      for (let j = i + 1; j < docFields.length; j++) {
        const docA = docFields[i];
        const docB = docFields[j];
        // An untyped upload is only checked against a real identity document.
        if (docA.role !== 'identity' && docB.role !== 'identity') continue;

        for (const field of COMPARABLE_FIELDS) {
          const valA = docA.fields[field];
          const valB = docB.fields[field];
          let cmp = compareIdentityField(field, valA, valB, now);
          // Not comparable (missing, or not a plausible value for the field —
          // e.g. a letter date read as a DOB): record nothing.
          if (!cmp) continue;
          // An untyped upload's "DOB" years away from the passport's is some
          // other date (a refusal date on an IMM 5621), not a misread DOB.
          if (
            field === 'date_of_birth' &&
            (docA.role === 'generic' || docB.role === 'generic') &&
            genericDobIsAnotherDate(String(valA), String(valB), now)
          ) {
            continue;
          }
          // An untyped upload, or one typed only from its text, is not known
          // to be the applicant's own document: a difference is a warning to
          // review, not a mismatch that costs consistency (prod 2026-10-14).
          if (
            cmp.result === 'mismatch' &&
            (docA.role === 'generic' || docB.role === 'generic')
          ) {
            cmp = { result: 'warning', note: GENERIC_MISMATCH_NOTE };
          }

          crossResults.push({
            doc_a_id: docA.docId,
            doc_b_id: docB.docId,
            field,
            result: cmp.result,
            details: {
              value_a: valA,
              value_b: valB,
              doc_type_a: docA.docType,
              doc_type_b: docB.docType,
              ...(cmp.note ? { note: cmp.note } : {}),
              ...(cmp.result === 'mismatch'
                ? { suggestion: MISMATCH_SUGGESTIONS[field] }
                : {}),
            },
          });
        }
      }
    }

    if (crossResults.length > 0) {
      // Upsert on the unique (application_id, doc_a_id, doc_b_id, field_compared) constraint.
      // Race-safe under concurrent graph runs — no delete-then-insert window.
      await supabase.from('cross_verifications').upsert(
        crossResults.map((r) => ({
          application_id: state.applicationId,
          doc_a_id: r.doc_a_id,
          doc_b_id: r.doc_b_id,
          field_compared: r.field,
          result: r.result,
          details_json: r.details,
        })),
        { onConflict: 'application_id,doc_a_id,doc_b_id,field_compared' },
      );
    }

    // Reconcile: a pair/field this run no longer compares (supporting
    // document, implausible value) must not keep showing an old mismatch.
    const keep = new Set(
      crossResults.map((r) => `${r.doc_a_id}|${r.doc_b_id}|${r.field}`),
    );
    const byId = new Map(docFields.map((d) => [d.docId, d]));
    const { data: existing } = await supabase
      .from('cross_verifications')
      .select('id, doc_a_id, doc_b_id, field_compared')
      .eq('application_id', state.applicationId);
    const stale = ((existing ?? []) as CrossRow[])
      .filter((r) => {
        if (keep.has(`${r.doc_a_id}|${r.doc_b_id}|${r.field_compared}`)) {
          return false;
        }
        const a = byId.get(r.doc_a_id);
        const b = byId.get(r.doc_b_id);
        // Pair no longer eligible (supporting document, removed document,
        // or no identity document in it): always stale.
        if (!a || !b || (a.role !== 'identity' && b.role !== 'identity')) {
          return true;
        }
        // Both sides were readable this run and the pair yielded nothing:
        // stale. If a side's verification is not visible yet (a concurrent
        // run still writing it), leave the row for that run to settle.
        return latestByDoc.has(a.docId) && latestByDoc.has(b.docId);
      })
      .map((r) => r.id);
    if (stale.length > 0) {
      await supabase.from('cross_verifications').delete().in('id', stale);
    }

    return {};
  };
}
