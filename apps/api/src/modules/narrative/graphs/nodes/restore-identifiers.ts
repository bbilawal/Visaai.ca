/**
 * Letters must quote government identifiers exactly as the applicant gave
 * them. The model "helpfully" regroups them — the 2026-10-15 dry run printed
 * UCI 1147908458 as `1147-9084-58`, a number IRCC would not recognise. Prompt
 * rules alone don't hold, so after drafting, any copy of a profile identifier
 * whose characters match but whose spacing or dashes differ is put back
 * verbatim.
 */

/** Profile keys holding identifiers that must never be reformatted. */
const IDENTIFIER_KEY =
  /(^|_)(uci|client_id|passport_number|national_id_number|application_number|file_number)$/;

const MIN_LENGTH = 6;

function escape(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identifiers(profile: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(profile)) {
    if (!IDENTIFIER_KEY.test(key) || typeof value !== 'string') continue;
    const v = value.trim();
    if (v.replace(/[\s-]/g, '').length >= MIN_LENGTH) out.add(v);
  }
  return [...out];
}

export function restoreIdentifiers(
  text: string,
  profile: Record<string, unknown>,
): string {
  let result = text;
  for (const id of identifiers(profile)) {
    const chars = [...id.replace(/[\s-]/g, '')];
    // Same characters in order, optionally separated by spaces or dashes, not
    // embedded in a longer alphanumeric run.
    const pattern = new RegExp(
      `(?<![A-Za-z0-9])${chars.map(escape).join('[\\s-]?')}(?![A-Za-z0-9])`,
      'gi',
    );
    result = result.replace(pattern, id);
  }
  return result;
}
