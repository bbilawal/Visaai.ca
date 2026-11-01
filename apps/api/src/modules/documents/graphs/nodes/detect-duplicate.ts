import { createHash } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState, ExtractedFields } from '../document.state';
import { safeLog } from '../../../shared/log/redact';

/**
 * Duplicate detection (GAPS.md §A). Reads back the content/identity hashes that
 * the pipeline already computes (ocr_runs.raw_text_hash, field_provenance
 * value_hash) — until now never used for dedup — to flag the same document
 * uploaded twice within one application.
 *
 * Placement: after run_ocr (needs extractedFields + rawOcrText), before
 * store_verification (which persists dup_status / duplicate_of / hashes).
 *
 * Two signals:
 *  - exact_dup  — identical OCR content hash (sha256 of rawOcrText, the SAME
 *                 algorithm as ocr_runs.raw_text_hash). Catches literal re-uploads.
 *  - likely_dup — same identity fingerprint (document_type|id|name|dob) or the
 *                 same passport_number value_hash. Catches a re-photographed /
 *                 re-scanned copy (different bytes, same person/document).
 *
 * Best-effort: a read failure must NOT fail the OCR job — it degrades to
 * 'unique' (dedup is augmentation, not a gate). The computed hashes are always
 * returned so store_verification can persist them for future comparisons.
 */

/** sha256 hex of the full text — identical to provenance.recordOcrRun. */
export function contentHash(text: string): string | undefined {
  if (!text) return undefined;
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** value_hash spine: trim + NFC for strings, String() for numbers. */
function normalizeValue(value: string | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  return value.trim().normalize('NFC');
}

export function valueHash(value: string | number | null | undefined): string {
  return createHash('sha256')
    .update(normalizeValue(value), 'utf8')
    .digest('hex');
}

/**
 * Stable identity fingerprint over (document_type, id-number, name, dob).
 * Returns undefined when there is not enough identity signal to be meaningful
 * (avoids false "likely_dup" hits on near-empty extractions).
 */
export function identityFingerprint(
  documentType: string | undefined,
  fields: ExtractedFields,
): string | undefined {
  const idNumber =
    fields.passport_number ??
    fields.national_id_number ??
    (fields.id_number as string | undefined);
  const name = fields.full_name;
  const dob = fields.date_of_birth;

  // Need an identifier OR (name + dob) to fingerprint with confidence.
  const hasIdentity = !!idNumber || (!!name && !!dob);
  if (!hasIdentity) return undefined;

  const tuple = [
    normalizeValue(documentType ?? '').toLowerCase(),
    normalizeValue(idNumber ?? '').toLowerCase(),
    normalizeValue(name ?? '').toLowerCase(),
    normalizeValue(dob ?? '').toLowerCase(),
  ].join('|');
  return createHash('sha256').update(tuple, 'utf8').digest('hex');
}

export function makeDetectDuplicateNode(supabase: SupabaseClient) {
  return async function detectDuplicate(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};

    const cHash = contentHash(state.rawOcrText);
    const fpHash = identityFingerprint(
      state.documentType,
      state.extractedFields,
    );

    const base: Partial<DocumentState> = {
      contentHash: cHash,
      identityFphash: fpHash,
      dupStatus: 'unique',
      duplicateOf: null,
    };

    try {
      // --- exact: same OCR content hash (documents column OR ocr_runs) ---
      if (cHash) {
        const { data: exactDoc } = await supabase
          .from('documents')
          .select('id')
          .eq('application_id', state.applicationId)
          .eq('raw_text_hash', cHash)
          .neq('id', state.documentId)
          .limit(1)
          .maybeSingle();
        if (exactDoc?.id) {
          return { ...base, dupStatus: 'exact_dup', duplicateOf: exactDoc.id };
        }

        // Read back ocr_runs.raw_text_hash (computed today, never used for dedup).
        const { data: exactRun } = await supabase
          .from('ocr_runs')
          .select('document_id')
          .eq('application_id', state.applicationId)
          .eq('raw_text_hash', cHash)
          .neq('document_id', state.documentId)
          .limit(1)
          .maybeSingle();
        if (exactRun?.document_id) {
          return {
            ...base,
            dupStatus: 'exact_dup',
            duplicateOf: exactRun.document_id,
          };
        }
      }

      // --- likely: same identity fingerprint ---
      if (fpHash) {
        const { data: fpDoc } = await supabase
          .from('documents')
          .select('id')
          .eq('application_id', state.applicationId)
          .eq('identity_fphash', fpHash)
          .neq('id', state.documentId)
          .limit(1)
          .maybeSingle();
        if (fpDoc?.id) {
          return { ...base, dupStatus: 'likely_dup', duplicateOf: fpDoc.id };
        }
      }

      // --- likely: same passport_number value_hash (field_provenance) ---
      const passport = state.extractedFields.passport_number;
      if (passport) {
        const pnHash = valueHash(passport);
        const { data: provRow } = await supabase
          .from('field_provenance')
          .select('source_document_id')
          .eq('application_id', state.applicationId)
          .eq('field_key', 'passport_number')
          .eq('value_hash', pnHash)
          .is('superseded_by', null)
          .neq('source_document_id', state.documentId)
          .limit(1)
          .maybeSingle();
        if (provRow?.source_document_id) {
          return {
            ...base,
            dupStatus: 'likely_dup',
            duplicateOf: provRow.source_document_id,
          };
        }
      }
    } catch (err) {
      safeLog.warn(
        'documents.dedup',
        `duplicate lookup failed for ${state.documentId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }

    return base;
  };
}
