import { strategyRegistry } from './strategy.registry';
import {
  SCHENGEN_MEMBERS,
  SCHENGEN_MEMBER_CODES,
} from './country/schengen-members';

/**
 * Country-context helpers shared by every LLM node that asks the model for
 * country-specific guidance (intake checklist, VRI visa categories, …).
 *
 * Two jobs:
 *  1. resolveCountryName — turn an ISO-2 code into the country's NAME so prompts
 *     never feed a bare "FI" to the model (which drifts toward whatever country
 *     the prompt's examples over-represent — historically Canada's IMM forms).
 *  2. The foreign-form guard — a deterministic post-generation check that strips
 *     a form whose code clearly belongs to a DIFFERENT country than the
 *     destination (e.g. a Canadian "IMM 5257" leaking into a Finland flow).
 */

// Nicer article display forms for the big destinations (prompt readability).
const DISPLAY_NAMES: Record<string, string> = {
  US: 'the United States',
  GB: 'the United Kingdom',
  NL: 'the Netherlands',
  AE: 'the United Arab Emirates',
};

// The base destinations' canonical names (stable; no registry needed at import).
const BASE_NAMES: Record<string, string> = {
  CA: 'Canada',
  US: 'United States',
  GB: 'United Kingdom',
  AU: 'Australia',
  SCHENGEN: 'Schengen Area',
};

// The 27 Schengen members, from the single canonical source.
const MEMBER_NAMES: Record<string, string> = Object.fromEntries(
  SCHENGEN_MEMBERS.map(([code, name]) => [code, name]),
);

/**
 * Code -> human country name. Never returns a *wrong* country: unknown codes
 * fall back to the raw code, and null to a neutral phrase. Resolution order
 * keeps article forms first, then stable maps, then the live registry (covers
 * any future registered country), then the raw code.
 */
export function resolveCountryName(code: string | null | undefined): string {
  if (!code) return 'the destination country';
  const c = code.toUpperCase();
  return (
    DISPLAY_NAMES[c] ??
    BASE_NAMES[c] ??
    MEMBER_NAMES[c] ??
    strategyRegistry.getCountry(c)?.name ??
    code
  );
}

export type FormFamily = 'US' | 'CA' | 'GB' | 'AU' | 'SCHENGEN';

/**
 * Which country-family a DESTINATION code's official forms belong to. Every
 * Schengen member (and the bloc) maps to SCHENGEN — they share the uniform
 * Type C application. Unknown destinations return null so the guard never
 * false-blocks a country we don't have form signatures for.
 */
export function destinationFormFamily(
  code: string | null | undefined,
): FormFamily | null {
  if (!code) return null;
  const c = code.toUpperCase();
  if (c === 'US') return 'US';
  if (c === 'CA') return 'CA';
  if (c === 'GB') return 'GB';
  if (c === 'AU') return 'AU';
  if (c === 'SCHENGEN' || SCHENGEN_MEMBER_CODES.includes(c)) return 'SCHENGEN';
  return null;
}

/**
 * Recognise a FORM CODE by its country signature, or null if it is not a
 * country-specific government form (e.g. the Schengen uniform application, or a
 * plain document). Conservative: only matches clear, well-known code patterns.
 */
export function detectFormFamily(formCode: string): FormFamily | null {
  const s = (formCode ?? '').trim().toUpperCase();
  if (/^IMM\s*\d/.test(s)) return 'CA'; // IMM 5257, IMM1294
  if (/^(DS|I|G)-?\d/.test(s)) return 'US'; // DS-160, I-130, G-1145
  if (/^VAF\s*\d/.test(s) || /^APPENDIX\b/.test(s)) return 'GB'; // VAF1A, Appendix 2
  if (/^(FORM\s*\d{3,4}|SUBCLASS\s*\d)/.test(s)) return 'AU'; // Form 1419, subclass 600
  return null;
}

/**
 * The cross-country leakage guard. True when `formCode` clearly belongs to a
 * different country than `destCode`. Returns false when the destination is
 * unknown (don't block) or the form is not country-specific (allow Schengen
 * uniform app, generic items).
 */
export function isForeignForm(
  destCode: string | null | undefined,
  formCode: string,
): boolean {
  const dest = destinationFormFamily(destCode);
  if (!dest) return false;
  const fam = detectFormFamily(formCode);
  if (!fam) return false;
  return fam !== dest;
}
