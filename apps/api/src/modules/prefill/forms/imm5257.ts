import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import type { PrefilledFormPayload, PrefilledFormField } from '@visaai/types';

/**
 * IMM 5257 — Application for Temporary Resident Visa (IRCC, Canada).
 *
 * WHAT CHANGED AND WHY
 *
 * This module used to fetch a hardcoded canada.ca URL on every render. That
 * URL returns 200 text/html — not a PDF — so PDFDocument.load threw, the
 * renderer returned null, and every prefill silently degraded to the VisaAI
 * summary PDF. Nothing logged it, so it looked like a working feature.
 *
 * Templates now come from the forms module's cache (FormTemplateStore), which
 * discovers the current versioned URL from IRCC's stable landing page. The
 * loader is injected rather than imported to keep prefill free of a dependency
 * on the forms module and to let this file be tested without Supabase.
 *
 * REALITY CHECK: the live IMM 5257 is dynamic XFA — 0 AcroForm fields and
 * NeedsRendering true — so pdf-lib cannot fill it, and this renderer correctly
 * returns null for it. The AcroForm path below is not dead code: it is what
 * runs for portals that publish true AcroForms, and FormCapabilityProbe tells
 * the delivery layer which is which. Returning null here is now an honest
 * "cannot fill", not a masked fetch failure.
 */

export type TemplateLoader = (formCode: string) => Promise<Uint8Array | null>;

const FORM_CODE = 'IMM 5257';

let templateLoader: TemplateLoader | null = null;

/** Wired at boot by PrefillModule. Pass null to reset (tests). */
export function setTemplateLoader(loader: TemplateLoader | null): void {
  templateLoader = loader;
}

async function loadTemplate(): Promise<Uint8Array | null> {
  if (!templateLoader) return null;
  try {
    return await templateLoader(FORM_CODE);
  } catch {
    return null;
  }
}

// FIELD_MAP survives the XFA finding on purpose: probeFormCapability gates
// entry to this renderer, so these lines run only if IRCC ships an AcroForm
// revision. The XFA path costs them nothing at runtime.
const FIELD_MAP: Array<[string, string[]]> = [
  ['family_name', ['form1[0].Page1[0].FamilyName[0]', 'Names.FamilyName']],
  ['surname', ['form1[0].Page1[0].FamilyName[0]']],
  ['given_name', ['form1[0].Page1[0].GivenName[0]', 'Names.GivenName']],
  ['given_names', ['form1[0].Page1[0].GivenName[0]']],
  ['date_of_birth', ['form1[0].Page1[0].DOB[0]', 'DateOfBirth']],
  ['place_of_birth', ['form1[0].Page1[0].PlaceBirthCity[0]']],
  ['country_of_birth', ['form1[0].Page1[0].PlaceBirthCountry[0]']],
  ['nationality', ['form1[0].Page1[0].CountryCitizenship[0]', 'Citizenship']],
  ['citizenship', ['form1[0].Page1[0].CountryCitizenship[0]']],
  ['passport_number', ['form1[0].Page1[0].PassportNum[0]', 'PassportNumber']],
  ['passport_issue_date', ['form1[0].Page1[0].PassportIssueDate[0]']],
  ['passport_expiry_date', ['form1[0].Page1[0].PassportExpiryDate[0]']],
  ['expiry_date', ['form1[0].Page1[0].PassportExpiryDate[0]']],
  ['sex', ['form1[0].Page1[0].Sex[0]']],
  ['gender', ['form1[0].Page1[0].Sex[0]']],
  ['marital_status', ['form1[0].Page1[0].MaritalStatus[0]']],
  ['email', ['form1[0].Page2[0].Email[0]']],
  ['phone', ['form1[0].Page2[0].Phone[0]']],
  ['address_line1', ['form1[0].Page2[0].AddressLine1[0]']],
  ['address_city', ['form1[0].Page2[0].City[0]']],
  ['address_country', ['form1[0].Page2[0].Country[0]']],
  ['address_postal_code', ['form1[0].Page2[0].PostalCode[0]']],
  ['employer', ['form1[0].Page3[0].Employer[0]']],
  ['occupation', ['form1[0].Page3[0].Occupation[0]']],
  ['monthly_income', ['form1[0].Page3[0].MonthlyIncome[0]']],
  ['purpose_of_travel', ['form1[0].Page3[0].PurposeOfVisit[0]']],
  ['intended_arrival_date', ['form1[0].Page3[0].IntendedArrivalDate[0]']],
  ['intended_departure_date', ['form1[0].Page3[0].IntendedDepartureDate[0]']],
];

function byKey(fields: PrefilledFormField[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fields) {
    if (f.key && f.value) m.set(f.key, f.value);
  }
  return m;
}

export async function renderImm5257(
  payload: PrefilledFormPayload,
): Promise<Uint8Array | null> {
  const bytes = await loadTemplate();
  if (!bytes) return null;

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return null;
  }

  let form;
  try {
    form = pdf.getForm();
  } catch {
    return null;
  }

  const values = byKey(payload.fields);
  let filled = 0;

  for (const [prefillKey, acroNames] of FIELD_MAP) {
    const value = values.get(prefillKey);
    if (!value) continue;
    for (const name of acroNames) {
      try {
        const field = form.getField(name);
        if (field instanceof PDFTextField) {
          field.setText(value);
          filled++;
          break;
        }
        if (field instanceof PDFCheckBox && /^(yes|true|1)$/i.test(value)) {
          field.check();
          filled++;
          break;
        }
      } catch {
        // Field not present under this name in this template revision — keep
        // trying the other candidates.
      }
    }
  }

  if (filled === 0) return null;

  try {
    form.updateFieldAppearances();
  } catch {
    // Non-fatal: appearances may already be embedded.
  }

  return pdf.save();
}
