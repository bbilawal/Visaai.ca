/**
 * Other names the extractor returned, checked before they are stored.
 *
 * Live 2026-10-30 (TRV, app 945eb7f1): "Yes: my name is sometimes written as
 * <alias> (order differs). Full name on passport: family name <F>, given names
 * <G>." was stored as other_names = [{previous name, given <G>, family <F>}] —
 * the passport name, given only to say how the alias differs, recorded as the
 * other name. The tr-rt fill rightly refuses an other name equal to the
 * current name, so nothing reached IRCC.
 *
 * Removal only — a declaration is never inferred here:
 * - an other name equal to the applicant's current name (on file, or stated
 *   as the passport / current name in this answer) is dropped;
 * - when this answer, or the profile with no "Yes" in this answer, says the
 *   applicant has used no other name, no other name is stored (review of
 *   79e37f34: "No. My father is known as …" must not become a declaration).
 */

const LIST_KEYS = ['other_names', 'aliases', 'previous_names'] as const;
const DECLARATION_KEYS = ['has_other_names', 'used_other_names'] as const;

const words = (...parts: unknown[]) =>
  parts
    .filter((x): x is string => typeof x === 'string')
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const text = (o: Record<string, unknown>, ...keys: string[]) =>
  keys.map((k) => o[k]).find((v): v is string => typeof v === 'string' && !!v.trim());

/** true / false for a Yes/No declaration, undefined when not given. */
function declared(o: Record<string, unknown>): boolean | undefined {
  for (const k of DECLARATION_KEYS) {
    const v = o[k];
    if (v === true || (typeof v === 'string' && /^\s*(yes|true)\b/i.test(v))) return true;
    if (v === false || (typeof v === 'string' && /^\s*(no|false|none)\b/i.test(v))) return false;
  }
  return undefined;
}

interface CurrentName {
  family: string;
  given: string;
  whole: string;
}

/** The applicant's current name(s): on file, and stated in this answer. */
function currentNames(profile: Record<string, unknown>, answer: string): CurrentName[] {
  const out: CurrentName[] = [];
  const family = words(text(profile, 'family_name', 'last_name', 'surname'));
  const given = words(text(profile, 'given_name', 'given_names', 'first_name'));
  if (family) out.push({ family, given, whole: '' });
  const full = words(text(profile, 'full_name'));
  if (full) out.push({ family: '', given: '', whole: full });

  // "family name Hassan, given names Mirza Tariq" where the answer speaks of
  // the passport / legal / current name.
  if (/\b(passport|legal|current|official)\b/i.test(answer)) {
    const f = /\b(?:family name|surname|last name)\s*(?:is|:)?\s*([^,.;()]+)/i.exec(answer);
    const g = /\b(?:given names?|first names?)\s*(?:is|are|:)?\s*([^,.;()]+)/i.exec(answer);
    if (f) out.push({ family: words(f[1]), given: words(g?.[1]), whole: '' });
    const m = /\b(?:passport|legal|current|official) name\s*(?:is|:)\s*([^,.;()]+)/i.exec(answer);
    if (m && !/\b(family|given|surname|first|last)\b/i.test(m[1]))
      out.push({ family: '', given: '', whole: words(m[1]) });
  }
  return out;
}

/** Whether a recorded other name is one of the current names, in order. */
function isCurrent(v: unknown, current: CurrentName[]): boolean {
  const o: Record<string, unknown> =
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { name: v };
  const family = words(text(o, 'family_name', 'last_name', 'surname'));
  const given = words(text(o, 'given_name', 'given_names', 'first_name'));
  const whole = words(text(o, 'name', 'full_name')) || words(given, family);
  return current.some((c) => {
    if (c.family && family) return c.family === family && c.given === given;
    // The same words in another order are a real alias, not the current name.
    const forms = c.whole ? [c.whole] : [words(c.family, c.given), words(c.given, c.family)];
    return !!whole && forms.includes(whole);
  });
}

export function withStatedOtherNames(
  extracted: Record<string, unknown>,
  answer: string,
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const keys = LIST_KEYS.filter((k) => k in extracted);
  if (!keys.length) return extracted;
  const out = { ...extracted };

  const now = declared(extracted);
  if (now === false || (now === undefined && declared(profile) === false)) {
    for (const k of keys) delete out[k];
    return out;
  }

  const current = currentNames(profile, answer);
  let changed = false;
  for (const k of keys) {
    const v = extracted[k];
    if (!Array.isArray(v)) continue;
    const kept = v.filter((x) => !isCurrent(x, current));
    if (kept.length === v.length) continue;
    changed = true;
    if (kept.length) out[k] = kept;
    else delete out[k];
  }
  return changed ? out : extracted;
}
