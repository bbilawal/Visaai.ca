// CSS selectors mapped per document_type, in priority order. The extension joins
// them with commas and runs document.querySelector to find the first match. The
// patterns target attributes that government portals commonly set on their
// file-input widgets — `name`, `id`, `aria-label`, nearby label text, and
// data-* hooks. If nothing matches, the step fails gracefully and the plan
// continues so the user can attach that one file manually.

const SELECTORS_BY_TYPE: Record<string, string[]> = {
  passport: [
    'input[type="file"][name*="passport" i]',
    'input[type="file"][id*="passport" i]',
    'input[type="file"][aria-label*="passport" i]',
    'input[type="file"][data-doc-type*="passport" i]',
  ],
  passport_photo: [
    'input[type="file"][name*="photo" i]',
    'input[type="file"][id*="photo" i]',
    'input[type="file"][aria-label*="photo" i]',
  ],
  bank_statement: [
    'input[type="file"][name*="bank" i]',
    'input[type="file"][name*="statement" i]',
    'input[type="file"][id*="bank" i]',
    'input[type="file"][aria-label*="bank statement" i]',
  ],
  employment_letter: [
    'input[type="file"][name*="employment" i]',
    'input[type="file"][id*="employment" i]',
    'input[type="file"][aria-label*="employment" i]',
    'input[type="file"][name*="letter" i]',
  ],
  pay_stubs: [
    'input[type="file"][name*="pay" i]',
    'input[type="file"][name*="stub" i]',
    'input[type="file"][id*="payslip" i]',
    'input[type="file"][aria-label*="pay" i]',
  ],
  noa: [
    'input[type="file"][name*="noa" i]',
    'input[type="file"][name*="assessment" i]',
    'input[type="file"][id*="tax" i]',
    'input[type="file"][aria-label*="notice of assessment" i]',
  ],
  itinerary: [
    'input[type="file"][name*="itinerary" i]',
    'input[type="file"][name*="travel" i]',
    'input[type="file"][aria-label*="itinerary" i]',
  ],
  cover_letter: [
    'input[type="file"][name*="cover" i]',
    'input[type="file"][aria-label*="cover letter" i]',
    'input[type="file"][aria-label*="letter of explanation" i]',
  ],
  loe: [
    'input[type="file"][name*="loe" i]',
    'input[type="file"][aria-label*="letter of explanation" i]',
  ],
  invitation_letter: [
    'input[type="file"][name*="invitation" i]',
    'input[type="file"][aria-label*="invitation" i]',
    'input[type="file"][aria-label*="host letter" i]',
  ],
  property_deed: [
    'input[type="file"][name*="property" i]',
    'input[type="file"][name*="deed" i]',
    'input[type="file"][aria-label*="property" i]',
  ],
  // Same document under the name the documents pipeline files it as. Without
  // this row it fell through to the generic slug selectors only.
  property_document: [
    'input[type="file"][name*="property" i]',
    'input[type="file"][name*="deed" i]',
    'input[type="file"][aria-label*="property" i]',
  ],
  marriage_certificate: [
    'input[type="file"][name*="marriage" i]',
    'input[type="file"][aria-label*="marriage" i]',
  ],
  birth_certificate: [
    'input[type="file"][name*="birth" i]',
    'input[type="file"][aria-label*="birth" i]',
  ],
};

// Generic fallback uses the document_type slug itself — works when the portal
// names its input fields after the document. Always tried last.
function genericSelectorsFor(documentType: string): string[] {
  const slug = documentType.replace(/_/g, ' ');
  return [
    `input[type="file"][name*="${documentType}" i]`,
    `input[type="file"][id*="${documentType}" i]`,
    `input[type="file"][aria-label*="${slug}" i]`,
  ];
}

export function uploadSelectorsFor(
  documentType: string | null | undefined,
): string {
  if (!documentType) return 'input[type="file"]';
  const dedicated = SELECTORS_BY_TYPE[documentType] ?? [];
  const all = [...dedicated, ...genericSelectorsFor(documentType)];
  return all.join(', ');
}
