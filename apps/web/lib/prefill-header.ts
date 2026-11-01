import { localizeCountryName } from './localize-country-name'

interface HeaderField {
  key: string
  value: string
}

interface HeaderPayload {
  visaType: string
  countryCode: string
  fields: HeaderField[]
}

function valueOf(fields: HeaderField[], ...keys: string[]): string {
  for (const k of keys) {
    const v = fields.find((f) => f.key === k)?.value?.trim()
    if (v) return v
  }
  return ''
}

/**
 * Applicant name · visa · destination for the prefill header. Parts the draft
 * does not have are dropped rather than printed as "—" — a row of dashes read
 * as a broken page (prod 2026-10-14).
 */
export function prefillHeaderParts(payload: HeaderPayload, locale: string): string[] {
  const fields = payload.fields ?? []
  const name =
    valueOf(fields, 'full_name', 'applicant_name') ||
    [valueOf(fields, 'given_name', 'given_names', 'first_name'), valueOf(fields, 'family_name', 'surname', 'last_name')]
      .filter(Boolean)
      .join(' ')
  const visa = payload.visaType?.trim() || valueOf(fields, 'visa_type')
  const code = payload.countryCode?.trim() ?? ''
  const country = code
    ? localizeCountryName(code.toUpperCase(), code, locale)
    : valueOf(fields, 'application_country', 'destination_country')
  return [name, visa, country].filter(Boolean)
}
