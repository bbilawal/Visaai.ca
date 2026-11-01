import { SupabaseClient } from '@supabase/supabase-js';
import type { PrefillState, PrefillContext } from '../prefill.state';
import { classifyDocumentSubject, holderNameOf } from './subject-attribution';
import { sanitizeProfile, type OtherPartyDocument } from './applicant-guards';

/**
 * Keys that live alongside `extracted_fields` inside `details_json` but describe
 * the VERIFICATION, not the applicant. They must never reach the form-field
 * generator: `raw_ocr_length` is not a value any government form asks for.
 */
const NON_APPLICANT_KEYS = new Set([
  'raw_ocr_length',
  'error',
  'dup_status',
  'duplicate_of',
  'basis',
  'policy',
  'reference_date',
  'reason',
]);

type VerificationRow = {
  verification_type?: string | null;
  details_json?: unknown;
  documents?: { document_type?: string | null } | null;
};

export function makeLoadContextNode(supabase: SupabaseClient) {
  return async function loadContext(
    state: PrefillState,
  ): Promise<Partial<PrefillState>> {
    const { data: app, error: appErr } = await supabase
      .from('applications')
      .select(
        'user_id, destination_country, visa_type_id, country_frameworks(country_code, visa_type, purpose)',
      )
      .eq('id', state.applicationId)
      .single();

    if (appErr || !app) {
      throw new Error(
        `Failed to load application: ${appErr?.message ?? 'not found'}`,
      );
    }

    const framework = app.country_frameworks as unknown as {
      country_code: string;
      visa_type: string;
      purpose: string;
    } | null;

    const { data: profile } = await supabase
      .from('application_profiles')
      .select('profile_json')
      .eq('application_id', state.applicationId)
      .single();

    const rawProfile = profile?.profile_json;
    // `_`-prefixed keys are document-pipeline bookkeeping (provenance), not
    // facts for a form.
    const safeProfile =
      rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? Object.fromEntries(
            Object.entries(rawProfile as Record<string, unknown>).filter(
              ([k]) => !k.startsWith('_'),
            ),
          )
        : {};

    const { data: verifications } = await supabase
      .from('document_verifications')
      .select(
        'verification_type, details_json, documents!inner(application_id, document_type)',
      )
      .eq('documents.application_id', state.applicationId);

    const userId = (app as { user_id?: string | null }).user_id ?? null;
    const accountProfile = await loadAccountProfile(supabase, userId);

    const {
      documentFields,
      documentFieldsByType,
      otherPartyDocuments,
      applicantName,
    } = collectDocumentFields(
      (verifications ?? []) as VerificationRow[],
      profileApplicantName(safeProfile),
    );

    // The intake profile can itself have absorbed a sponsor's employment facts
    // (prod: a retired father's profile held his son's job_title). Strip them
    // before the generator sees them.
    const { profile: cleanProfile } = sanitizeProfile(
      safeProfile,
      otherPartyDocuments,
    );

    const header = await resolveHeader(
      supabase,
      app as unknown as ApplicationHeaderRow,
      framework,
    );

    const context: PrefillContext = {
      ...header,
      profile: cleanProfile,
      documentFields,
      documentFieldsByType,
      otherPartyDocuments,
      applicantName,
      accountProfile,
    };

    return { context };
  };
}

type ApplicationHeaderRow = {
  destination_country?: string | null;
  visa_type_id?: string | null;
};

function profileApplicantName(profile: Record<string, unknown>): string | null {
  for (const k of ['applicant_name', 'full_name']) {
    const v = profile[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Country / visa / purpose for the payload header.
 *
 * Registry-era applications have no `framework_id` — they carry
 * `destination_country` + `visa_type_id` instead — so reading only
 * `country_frameworks` stored all three as "" and the prefill page header
 * rendered "— · — · —" (prod 2026-10-14). Fall back to the registry.
 */
export async function resolveHeader(
  supabase: SupabaseClient,
  app: ApplicationHeaderRow,
  framework: {
    country_code: string;
    visa_type: string;
    purpose: string;
  } | null,
): Promise<{
  countryCode: string;
  visaType: string;
  purpose: string;
  visaaiId: string | null;
}> {
  let countryCode = framework?.country_code ?? '';
  let visaType = framework?.visa_type ?? '';
  let purpose = framework?.purpose ?? '';
  let visaaiId: string | null = null;

  if (!countryCode && app.destination_country) {
    countryCode = app.destination_country;
  }
  // Always read for a registry route: besides filling a missing header, the
  // registry id selects the route's own form questions (finalize-fields).
  if (app.visa_type_id) {
    try {
      const { data } = await supabase
        .from('visa_types')
        .select('official_name, category, visaai_id')
        .eq('id', app.visa_type_id)
        .maybeSingle();
      const vt = data as {
        official_name?: string | null;
        category?: string | null;
        visaai_id?: string | null;
      } | null;
      if (!visaType && vt?.official_name) visaType = vt.official_name;
      if (!purpose && vt?.category) purpose = vt.category;
      visaaiId = vt?.visaai_id ?? null;
    } catch {
      // Header is cosmetic — never fail the prefill over it.
    }
  }
  return { countryCode, visaType, purpose, visaaiId };
}

/**
 * Account-level fields worth putting on a government form, and the snake_case
 * form key each maps to. Kept in step with the literal `select` below by
 * `load-context.spec.ts` — a column added here but not selected would silently
 * never arrive.
 */
export const ACCOUNT_FIELD_MAP: Array<[string, string]> = [
  ['first_name', 'given_name'],
  ['last_name', 'family_name'],
  ['phone', 'phone'],
  ['address_line1', 'address_line1'],
  ['address_line2', 'address_line2'],
  ['city', 'city'],
  ['region', 'region'],
  ['postal_code', 'postal_code'],
  ['country', 'country_of_residence'],
];

/**
 * Read what the applicant already told us on their ACCOUNT.
 *
 * Best-effort by design: a missing row, a column that does not exist on an
 * older deployment, or an RLS refusal must degrade to "no account data" rather
 * than fail the whole prefill. The applicant loses a few pre-filled fields;
 * they do not lose the form.
 */
async function loadAccountProfile(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<Record<string, unknown>> {
  if (!userId) return {};
  const out: Record<string, unknown> = {};

  try {
    const { data: user } = await supabase
      .from('users')
      .select('full_name, nationality, email')
      .eq('id', userId)
      .maybeSingle();
    if (user) {
      const u = user as Record<string, unknown>;
      if (isFilled(u.full_name)) out.full_name = u.full_name;
      if (isFilled(u.nationality)) out.nationality = u.nationality;
      if (isFilled(u.email)) out.email = u.email;
    }
  } catch {
    // Non-fatal — see above.
  }

  try {
    // Literal, not built from ACCOUNT_FIELD_MAP: supabase-js infers the row
    // type from the select STRING, and a computed one degrades to
    // GenericStringError. The spec below asserts the two stay in step.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select(
        'first_name, last_name, phone, address_line1, address_line2, city, region, postal_code, country',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (profile) {
      const p = profile as unknown as Record<string, unknown>;
      for (const [column, formKey] of ACCOUNT_FIELD_MAP) {
        if (isFilled(p[column]) && out[formKey] === undefined) {
          out[formKey] = p[column];
        }
      }
    }
  } catch {
    // Non-fatal — see above.
  }

  return out;
}

function isFilled(v: unknown): boolean {
  return typeof v === 'string'
    ? v.trim() !== ''
    : v !== null && v !== undefined;
}

/**
 * Flatten every uploaded document's OCR output into the prefill context.
 *
 * THE FIRST BUG THIS REPLACED: the previous version iterated the TOP-LEVEL keys
 * of `details_json` (`extracted_fields`, `raw_ocr_length`, `error`) and skipped
 * any key it had already seen, so every document after the first was dropped.
 * Each row is now unwrapped and merged. First non-empty value wins for a shared
 * key, and a genuine conflict is preserved under `<document_type>_<key>`.
 *
 * THE SECOND (prod 2026-10-14): the merge did not ask WHOSE document it was.
 * A retired applicant uploaded his son's employment letter and bank evidence as
 * sponsor proof, and his form came back with the son's HR signatory as his job
 * title and the other son's annual salary as his monthly income. Every document
 * now gets a subject (see subject-attribution.ts), anchored on the passport
 * name. Only the applicant's own documents reach `documentFields` /
 * `documentFieldsByType`; the rest come back as `otherPartyDocuments`, which
 * may fill sponsor/host fields and nothing else.
 */
export function collectDocumentFields(
  rows: VerificationRow[],
  fallbackApplicantName?: string | null,
): {
  documentFields: Record<string, unknown>;
  documentFieldsByType: Record<string, Record<string, unknown>>;
  otherPartyDocuments: OtherPartyDocument[];
  applicantName: string | null;
} {
  const extracted: Array<{ docType: string; fields: Record<string, unknown> }> =
    [];

  for (const row of rows) {
    // Only the identity row carries document data. Duplicate/expiry rows
    // describe the upload itself and would otherwise inject `dup_status` and
    // friends into a government form.
    if (row.verification_type && row.verification_type !== 'identity') continue;

    const details = row.details_json;
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      continue;
    }

    const raw = (details as { extracted_fields?: unknown }).extracted_fields;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === null || value === undefined || value === '') continue;
      if (NON_APPLICANT_KEYS.has(key)) continue;
      fields[key] = value;
    }
    extracted.push({
      docType: row.documents?.document_type?.trim() || 'document',
      fields,
    });
  }

  const applicantName =
    extracted
      .filter((d) => /passport/.test(d.docType))
      .map((d) => holderNameOf(d.fields))
      .find((n): n is string => !!n) ??
    (fallbackApplicantName?.trim() || null);

  const documentFields: Record<string, unknown> = {};
  const documentFieldsByType: Record<string, Record<string, unknown>> = {};
  const otherPartyDocuments: OtherPartyDocument[] = [];

  for (const { docType, fields } of extracted) {
    const subject = classifyDocumentSubject(docType, fields, applicantName);
    if (subject !== 'applicant') {
      if (Object.keys(fields).length > 0) {
        otherPartyDocuments.push({
          documentType: docType,
          subject,
          holderName: holderNameOf(fields),
          fields,
        });
      }
      continue;
    }

    const bucket = (documentFieldsByType[docType] ??= {});
    for (const [key, value] of Object.entries(fields)) {
      if (bucket[key] === undefined) bucket[key] = value;

      if (documentFields[key] === undefined) {
        documentFields[key] = value;
      } else if (documentFields[key] !== value) {
        // Two of the applicant's own documents disagree. Keep both so the
        // generator can reconcile instead of silently losing one.
        const namespaced = `${docType}_${key}`;
        if (documentFields[namespaced] === undefined) {
          documentFields[namespaced] = value;
        }
      }
    }
  }

  return {
    documentFields,
    documentFieldsByType,
    otherPartyDocuments,
    applicantName,
  };
}
