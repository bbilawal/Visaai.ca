/**
 * Family members are matched by NAME, never by their position in a list.
 *
 * Dry run 2026-10-14 (#35): an applicant with two sons got each son's
 * occupation on the other son. Lists of people reach us from two directions —
 * the intake extractor re-emitting `children` with one son's new detail, and
 * the prefill generator writing `child_1_*` / `child_2_*` fields from that list
 * — and neither ordering is stable. Index 0 of one is not index 0 of the other.
 * The only identity a person has across those hops is their name.
 */

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mx', 'sir']);

/** Lower-case, accent-free, punctuation-free tokens, honorifics dropped. */
export function normalizePersonName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t))
    .join(' ');
}

type Person = Record<string, unknown>;

function isPlainObject(v: unknown): v is Person {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The person's name as written on the record, or '' when it has none. */
export function personName(p: Person): string {
  for (const k of ['name', 'full_name', 'fullName']) {
    if (typeof p[k] === 'string' && p[k].trim()) return p[k];
  }
  const given = p.given_name ?? p.first_name ?? p.given_names;
  const family = p.family_name ?? p.last_name ?? p.surname;
  const joined = [given, family]
    .filter((x) => typeof x === 'string' && x.trim())
    .join(' ');
  return joined;
}

/**
 * Same person? Exact normalized match, or one name's tokens all appear in the
 * other ("Ali" ↔ "Ali Khan"). A one-token match is only accepted when that
 * token is unambiguous among the candidates — see `findByName`.
 */
function sameName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(' ');
  const tb = b.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

/**
 * Do two printed names refer to the same person? Normalized, order-free, and
 * tolerant of an extra name on one side ("Muzaffar Ahmad" ↔ "Mian Muzaffar
 * Ahmad"). For deciding whose document something is, not for picking one of
 * several candidates — use `findByName` for that.
 */
export function isSamePerson(a: unknown, b: unknown): boolean {
  return sameName(normalizePersonName(a), normalizePersonName(b));
}

/** The one candidate whose name matches `name`, or null when none or several do. */
export function findByName<T extends Person>(
  people: T[],
  name: string,
): T | null {
  const n = normalizePersonName(name);
  if (!n) return null;
  const exact = people.filter((p) => normalizePersonName(personName(p)) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = people.filter((p) =>
    sameName(normalizePersonName(personName(p)), n),
  );
  return loose.length === 1 ? loose[0] : null;
}

/** An array of person records, at least one of them named. */
export function isPeopleList(v: unknown): v is Person[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(isPlainObject) &&
    v.some((p) => personName(p) !== '')
  );
}

/**
 * Merge an updated list of people into the existing one BY NAME.
 *
 * - an update item that names an existing person merges into THAT person;
 * - a named update item that matches nobody is appended;
 * - existing people the update does not mention are kept, in their order.
 *
 * If any update item has no name it cannot be matched safely, and the update
 * is taken as a full replacement — the extractor restated the whole list —
 * rather than being lined up by position.
 */
export function mergePeopleByName(
  existing: Person[],
  update: Person[],
): Person[] {
  if (!update.every((p) => personName(p) !== '')) return update;
  const out = existing.map((p) => ({ ...p }));
  for (const u of update) {
    const match = findByName(out, personName(u));
    if (match) Object.assign(match, u);
    else out.push({ ...u });
  }
  return out;
}

/**
 * Apply an extracted profile update, merging people lists by name. Every other
 * key keeps the plain overwrite semantics of the intake state reducer.
 */
export function mergeProfileUpdate(
  existing: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...update };
  for (const [k, v] of Object.entries(update)) {
    const prev = existing[k];
    if (isPeopleList(prev) && Array.isArray(v) && v.every(isPlainObject)) {
      out[k] = mergePeopleByName(prev, v);
    }
  }
  return out;
}

/** Every named person record anywhere at the top level of a profile. */
export function peopleInProfile(profile: Record<string, unknown>): Person[] {
  const out: Person[] = [];
  for (const v of Object.values(profile)) {
    if (isPeopleList(v)) out.push(...v.filter((p) => personName(p) !== ''));
  }
  return out;
}
