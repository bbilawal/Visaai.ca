import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { safeLog } from '../../../shared/log/redact';
import {
  resolveExpiryPolicy,
  evaluateExpiry,
  extractTravelDate,
  parseDate,
} from '../expiry-policy';

/**
 * evaluate_expiry node (GAPS.md §B). Extracted out of store_verification into a
 * dedicated, independently testable node placed AFTER store_verification (so the
 * identity row already exists) and BEFORE check_docs_ready.
 *
 * Fixes the original bug: the 6-month window is now measured against the
 * application's intended-travel date (when on file), not now(), and the rule is
 * type-aware via the expiry policy. Stores the real extracted expiry_date and a
 * verdict on the documents row, plus a standardized 'expiry' verification row.
 *
 * Best-effort persistence: an insert/update failure is logged, never fatal —
 * the expiry verdict is advisory and must not fail (or retry) the OCR job.
 */
export function makeEvaluateExpiryNode(supabase: SupabaseClient) {
  return async function evaluateExpiryNode(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};

    const policy = resolveExpiryPolicy(state.documentType);
    const expiry = parseDate(state.extractedFields.expiry_date);

    // No expiry extracted.
    if (!expiry) {
      if (!policy.requiresExpiry) return {}; // type has no expiry to track

      // Type REQUIRES an expiry but none could be read — warn loudly.
      await insertExpiryRow(supabase, state.documentId, 'warn', {
        expiry_date: null,
        days_until_expiry: null,
        policy_id: policy.id,
        required_valid_until: null,
        basis: 'expiry date could not be read — confirm manually',
      });
      await persistExpiry(supabase, state.documentId, null, 'unknown');
      return { expiryStatus: 'unknown', daysUntilExpiry: null };
    }

    // Resolve the intended-travel date from the intake profile.
    let travelDate: Date | null = null;
    try {
      const { data: profile } = await supabase
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', state.applicationId)
        .maybeSingle();
      const raw = profile?.profile_json;
      travelDate = extractTravelDate(
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null,
      );
    } catch (err) {
      safeLog.warn(
        'documents.expiry',
        `travel-date lookup failed for ${state.applicationId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }

    const verdict = evaluateExpiry({
      expiry,
      travelDate,
      now: new Date(),
      policy,
    });

    await insertExpiryRow(supabase, state.documentId, verdict.status, {
      expiry_date: expiry.toISOString().slice(0, 10),
      days_until_expiry: verdict.daysUntilExpiry,
      policy_id: policy.id,
      required_valid_until: verdict.requiredValidUntil,
      basis: verdict.basis,
      travel_date: travelDate ? travelDate.toISOString().slice(0, 10) : null,
    });
    await persistExpiry(
      supabase,
      state.documentId,
      expiry.toISOString().slice(0, 10),
      verdict.status,
    );

    return {
      expiryStatus: verdict.status,
      daysUntilExpiry: verdict.daysUntilExpiry,
    };
  };
}

async function insertExpiryRow(
  supabase: SupabaseClient,
  documentId: string,
  result: 'pass' | 'warn' | 'fail',
  details: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('document_verifications').insert({
    document_id: documentId,
    verification_type: 'expiry',
    result,
    details_json: details,
  });
  if (error) {
    safeLog.warn(
      'documents.expiry',
      `failed to store expiry verification for ${documentId}: ${error.message}`,
    );
  }
}

async function persistExpiry(
  supabase: SupabaseClient,
  documentId: string,
  expiryDate: string | null,
  status: 'pass' | 'warn' | 'fail' | 'unknown',
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ expiry_date: expiryDate, expiry_status: status })
    .eq('id', documentId);
  if (error) {
    safeLog.warn(
      'documents.expiry',
      `failed to persist expiry status for ${documentId}: ${error.message}`,
    );
  }
}
