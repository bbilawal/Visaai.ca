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
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  return sameName(na, nb) || sameNameAllowingOcrSlip(na, nb);
}

/** Levenshtein distance capped at 2 (only "0, 1 or more" matters here). */
function editDistanceUpTo1(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  // One substitution, insertion or deletion at i, then the rest must agree.
  return a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
    ? 1
    : 2;
}

/**
 * OCR drops or swaps a letter in a printed name — prod 2026-10-16 read the
 * groom on a nikah nama as "uzaffar Ahmad" — and transliterations differ by a
 * letter ("Ahmed" / "Ahmad"). Tokens of five or more letters may differ by one
 * edit; the shorter name needs at least two tokens, so a lone common name is
 * never stretched onto someone else.
 */
function sameNameAllowingOcrSlip(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ta = a.split(' ');
  const tb = b.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return false;
  const used = new Set<number>();
  return short.every((t) => {
    const j = long.findIndex(
      (u, k) =>
        !used.has(k) &&
        (u === t ||
          (t.length >= 5 && u.length >= 5 && editDistanceUpTo1(t, u) <= 1)),
    );
    if (j < 0) return false;
    used.add(j);
    return true;
  });
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
 * - a named update item marked `remove: true` takes that person out, and is
 *   never itself added.
 *
 * If any update item has no name it cannot be matched safely, and the update
 * is taken as a full replacement — the extractor restated the whole list —
 * rather than being lined up by position.
 */
export function mergePeopleByName(
  existing: Person[],
  update: Person[],
  opts: { keepRecorded?: boolean } = {},
): Person[] {
  if (!update.every((p) => personName(p) !== '')) {
    return update.filter((p) => !isRemoval(p));
  }
  let out = existing.map((p) => ({ ...p }));
  for (const u of update) {
    const match = findByName(out, personName(u));
    if (isRemoval(u)) {
      if (match) out = out.filter((p) => p !== match);
      continue;
    }
    // `keepRecorded` (children): an update re-states a person with the
    // details it is about; a key it carries empty (null, "") is not an answer
    // and never wipes a recorded one (prod 2026-10-21: a correction to one
    // daughter re-emitted her). Other people lists keep plain assignment, so
    // an explicit null still clears a value there (e.g. a date of death).
    if (match) Object.assign(match, opts.keepRecorded ? presentEntries(u) : u);
    else out.push({ ...u });
  }
  return out;
}

function presentEntries(p: Person): Person {
  return Object.fromEntries(
    Object.entries(p).filter(
      ([, v]) =>
        v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()),
    ),
  );
}

/**
 * Answers that are a list of the applicant's children's NAMES ("Which of
 * your children live with you?" → `children_living_with_you: ["Ali Khan"]`).
 * The portal fills (canada-ircc.ts `listAnswer`) and the intake requirements
 * read them as a list of name strings.
 */
const NAME_LIST_KEYS = new Set([
  'children_living_with_you',
  'children_accompanying',
]);

export function isNameListKey(key: string): boolean {
  return NAME_LIST_KEYS.has(key);
}

/**
 * Index of `name` in `names` — strict, for lists of the applicant's own
 * children, where siblings share a family name: an exact normalized match;
 * else a token-subset match ("Ali Khan" ↔ "Ali Khan Example") only when it is
 * the one such name in the list AND the name is not ambiguous among the
 * children on the roster ("Ali Khan" next to a brother "Ali Raza Khan" is
 * never loosely matched). Never the one-letter OCR allowance of
 * `isSamePerson`: "Aliya Khan" and "Aliza Khan" are sisters, not a typo.
 */
function strictNameIndex(
  names: string[],
  name: string,
  roster: string[] = [],
): number {
  const n = normalizePersonName(name);
  if (!n) return -1;
  const norm = names.map(normalizePersonName);
  const exact = norm.flatMap((x, i) => (x === n ? [i] : []));
  if (exact.length > 0) return exact[0];
  const loose = norm.flatMap((x, i) => (sameName(x, n) ? [i] : []));
  if (loose.length !== 1) return -1;
  const onRoster = roster
    .map(normalizePersonName)
    .filter((r) => r && sameName(r, n));
  if (new Set(onRoster).size > 1) return -1;
  return loose[0];
}

/** A name-list item's name ('' when it has none). */
function listItemName(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (isPlainObject(v)) return personName(v).trim();
  return '';
}

/**
 * Merge an update to a list of names. Prod 2026-10-21 (spousal sponsorship):
 * `children_living_with_you` held ["<first daughter>"]; a correction that only
 * ADDED a second daughter came back as `[{"name": "<second daughter>"}]` and
 * replaced the list, so the first daughter no longer lived with the applicant.
 * Same rule as the `children` list (`mergePeopleByName`): a name in the update
 * is added (once, matched by name), a name it leaves out is kept, and a name
 * goes only when the update says so (`{"name": "...", "remove": true}`) or
 * the child is removed from `children` in the same update. An empty update
 * (`[]`, "none of them") replaces the list. The result is always plain name
 * strings, whatever shape either side had.
 */
export function mergeNameList(
  existing: unknown[],
  update: unknown[],
  removedNames: string[] = [],
  roster: string[] = [],
): unknown[] {
  if (update.length === 0) return [];
  const named = (xs: unknown[]) => xs.map(listItemName).filter((n) => n !== '');
  const removals = [
    ...update
      .filter((u) => isPlainObject(u) && isRemoval(u))
      .map(listItemName)
      .filter((n) => n !== ''),
    ...removedNames,
  ];
  const additions = named(
    update.filter((u) => !(isPlainObject(u) && isRemoval(u))),
  );
  const out: string[] = [];
  for (const n of [...named(existing), ...additions]) {
    const at = strictNameIndex(out, n, roster);
    // The later spelling (the update's) wins; the position is kept.
    if (at >= 0) out[at] = n;
    else out.push(n);
  }
  return withoutNames(out, removals, roster);
}

/** `names` without each name in `removals`, matched strictly. */
function withoutNames(
  names: string[],
  removals: string[],
  roster: string[],
): string[] {
  let out = names;
  for (const r of removals) {
    const at = strictNameIndex(out, r, roster);
    if (at >= 0) out = out.filter((_, i) => i !== at);
  }
  return out;
}

/**
 * Keys of a child that say where the child lives now. intake-children.ts
 * folds the same flat keys into the child's `residence`, from this list.
 */
export const CHILD_RESIDENCE_KEYS = [
  'residence',
  'current_residence',
  'lives_in',
  'location',
  'country_of_residence',
  'residence_country',
  'city_of_residence',
];

const RESIDENCE_KEYS = [
  ...CHILD_RESIDENCE_KEYS,
  'address',
  'residential_address',
  'home_address',
];

/**
 * A child update must not flip where the child lives (`in_home_country`)
 * unless it says where the child lives now. Prod 2026-10-21: "she is
 * accompanying me to Canada" came back as `in_home_country: false` on a
 * daughter recorded as living in Pakistan with the applicant — a travel plan
 * read as a move. A real move is stated with the new country.
 */
function withoutResidenceFlip(existing: Person[], update: Person[]): Person[] {
  return update.map((u) => {
    if (!isPlainObject(u) || isRemoval(u) || !('in_home_country' in u))
      return u;
    const name = personName(u);
    const match = name ? findByName(existing, name) : null;
    if (!match) return u;
    const before = intakeYesNo(match.in_home_country);
    const after = intakeYesNo(u.in_home_country);
    if (before === undefined || after === undefined || before === after)
      return u;
    if (
      RESIDENCE_KEYS.some((k) => {
        const v = u[k];
        return typeof v === 'string'
          ? !!v.trim()
          : v !== undefined && v !== null;
      })
    )
      return u;
    const rest = { ...u };
    delete rest.in_home_country;
    return rest;
  });
}

function intakeYesNo(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (['yes', 'y', 'true'].includes(t)) return true;
  if (['no', 'n', 'false'].includes(t)) return false;
  return undefined;
}

/** Lists of periods (work history) matched by their start month. */
const PERIOD_LIST_KEYS = new Set([
  'work_history',
  'employment_history',
  'previous_jobs',
  'previous_employment',
  'work_experience',
  // Schools (IRCC post-secondary education): a missing piece re-asked by the
  // interview comes back as that school with its start month.
  'education_history',
]);

const MONTH_NAMES = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** "2016-10", "2016-10-01", "Oct 2016", "October 2016" → "2016-10"; else ''. */
function periodMonth(v: unknown): string {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  const iso = /^(\d{4})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const named = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(t);
  const m = named ? MONTH_NAMES.indexOf(named[1]) : -1;
  return m >= 0 ? `${named![2]}-${String(m + 1).padStart(2, '0')}` : '';
}

const periodStart = (p: Person) =>
  periodMonth(p.from ?? p.from_date ?? p.start_date ?? p.start);

const squash = (v: unknown) =>
  typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';

/** Same employer, or — when the update names none — the same activity. */
function sameWho(e: Person, u: Person): boolean {
  const uEmp = squash(u.employer ?? u.employer_name ?? u.company);
  if (uEmp) return uEmp === squash(e.employer ?? e.employer_name ?? e.company);
  const uAct = squash(u.activity ?? u.job_title);
  return !!uAct && uAct === squash(e.activity ?? e.job_title);
}

/** A period that stands on its own: a start and an end or what it was. */
const isWholePeriod = (p: Person) =>
  !!periodStart(p) &&
  !!(p.to ?? p.to_date ?? p.end_date ?? p.end ?? p.activity ?? p.job_title);

/** The one recorded period `u` is about, or -1 when none or not certain. */
function matchPeriod(existing: Person[], u: Person): number {
  const start = periodStart(u);
  const all = existing.map((e, i) => ({ e, i }));
  // No usable start month on either side: only the employer or activity can say.
  const same = start
    ? all.filter(({ e }) => periodStart(e) === start)
    : all.filter(({ e }) => !periodStart(e));
  if (start && same.length === 1) return same[0].i;
  // Two periods began that month: tell them apart by employer or activity.
  const named = same.filter(({ e }) => sameWho(e, u));
  return named.length === 1 ? named[0].i : -1;
}

/**
 * Merge an update to a list of periods BY START MONTH. When the interview
 * re-asks the pieces an earlier job still lacks (live E2E 2026-10-19: no
 * street address, no duties), the extractor returns that period with the new
 * pieces; a plain overwrite dropped every other period. Each update item that
 * matches one recorded period merges into it (`remove: true` takes it out); a
 * whole new period is added; a fragment that matches no period with certainty
 * is not applied, rather than guessed onto the wrong one. Recorded periods the
 * update does not mention are kept. A list of whole periods at least as long
 * as the record restates it and replaces it (a corrected start month included).
 */
export function mergePeriodsByStart(existing: Person[], update: Person[]): Person[] {
  const matches = update.map((u) => matchPeriod(existing, u));
  if (update.every(isWholePeriod) && update.length >= existing.length) {
    return update.filter((p) => !isRemoval(p));
  }
  const out: (Person | null)[] = existing.map((p) => ({ ...p }));
  const added: Person[] = [];
  update.forEach((u, n) => {
    const m = matches[n];
    if (m >= 0) {
      if (isRemoval(u)) out[m] = null;
      else if (out[m])
        Object.assign(
          out[m]!,
          Object.fromEntries(
            Object.entries(u).filter(([, v]) => v !== null && v !== undefined && v !== ''),
          ),
        );
    } else if (isWholePeriod(u) && !isRemoval(u)) added.push({ ...u });
  });
  return [...out.filter((p): p is Person => p !== null), ...added].sort((a, b) =>
    periodStart(a) < periodStart(b) ? -1 : periodStart(a) > periodStart(b) ? 1 : 0,
  );
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
  // Children taken off `children` in this update leave the name lists too.
  const childRemovals = Array.isArray(update.children)
    ? (update.children as unknown[])
        .filter((c): c is Person => isPlainObject(c) && isRemoval(c))
        .map((c) => personName(c))
        .filter((n) => n.trim() !== '')
    : [];
  // Every child named on either side: a loose name match is refused when it
  // could be more than one of them.
  const roster = [existing.children, update.children].flatMap((l) =>
    Array.isArray(l)
      ? l
          .filter(isPlainObject)
          .map((c) => personName(c))
          .filter((n) => n.trim() !== '')
      : [],
  );
  for (const [k, v] of Object.entries(update)) {
    const prev = existing[k];
    if (isNameListKey(k) && Array.isArray(v)) {
      out[k] = mergeNameList(
        Array.isArray(prev) ? prev : [],
        v,
        childRemovals,
        roster,
      );
      continue;
    }
    if (
      k === 'children' &&
      isPeopleList(prev) &&
      Array.isArray(v) &&
      v.every(isPlainObject)
    ) {
      out[k] = mergePeopleByName(prev, withoutResidenceFlip(prev, v), {
        keepRecorded: true,
      });
      continue;
    }
    if (
      PERIOD_LIST_KEYS.has(k) &&
      Array.isArray(prev) &&
      prev.every(isPlainObject) &&
      Array.isArray(v) &&
      v.length > 0 &&
      v.every(isPlainObject)
    ) {
      out[k] = mergePeriodsByStart(prev, v);
    } else if (isPeopleList(prev) && Array.isArray(v) && v.every(isPlainObject)) {
      out[k] = mergePeopleByName(prev, v);
    } else if (Array.isArray(v) && v.every(isPlainObject)) {
      out[k] = v.filter((p) => !isRemoval(p));
    }
  }
  if (childRemovals.length > 0) {
    for (const [k, prev] of Object.entries(existing)) {
      if (!isNameListKey(k) || k in update || !Array.isArray(prev)) continue;
      const names = prev.map(listItemName);
      // Only a list of names is rewritten (as names); anything else is kept.
      if (names.some((n) => n === '')) continue;
      const kept = withoutNames(names, childRemovals, roster);
      if (kept.length !== prev.length) out[k] = kept;
    }
  }
  const children = update.children;
  if (Array.isArray(children) && children.every(isPlainObject)) {
    const removed = children
      .filter((c) => isRemoval(c))
      .map((c) => personName(c))
      .filter((n) => n.trim() !== '');
    const restated = children
      .filter((c) => !isRemoval(c))
      .map((c) => personName(c));
    // A child named again (not as a removal) is back on the list.
    const kept = removedChildNames(existing).filter(
      (r) => !restated.some((n) => isSamePerson(r, n)),
    );
    for (const n of removed) {
      if (!kept.some((r) => isSamePerson(r, n))) kept.push(n);
    }
    if (JSON.stringify(kept) !== JSON.stringify(removedChildNames(existing))) {
      out[REMOVED_CHILDREN_KEY] = kept;
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

/**
 * Children the applicant told us to remove, by name.
 *
 * Dry run 2026-10-16: the applicant asked the intake chat to "remove Mian
 * Talha from my children" and nothing happened. Every path that writes
 * `children` merges BY NAME and keeps whoever an update does not mention
 * (the row's list, the checkpoint's list, flat `youngest_son_name` keys left
 * from earlier turns), so a child could be added or corrected but never
 * taken off. Dropping him from the list alone would not hold either: the next
 * merge would bring him back from one of those sources. The removal is
 * recorded here and every reader of `children` filters by it.
 */
export const REMOVED_CHILDREN_KEY = 'removed_children';

/** The names on the profile's removal list. */
export function removedChildNames(profile: Record<string, unknown>): string[] {
  const v = profile?.[REMOVED_CHILDREN_KEY];
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is string => typeof n === 'string' && !!n.trim());
}

/** Did the applicant remove the child with this name? */
export function isRemovedChild(
  profile: Record<string, unknown>,
  name: unknown,
): boolean {
  const n = normalizePersonName(name);
  if (!n) return false;
  return removedChildNames(profile).some(
    (r) => normalizePersonName(r) === n || isSamePerson(r, name),
  );
}

/** `people` without anyone the applicant removed. */
export function withoutRemovedChildren<T extends Person>(
  profile: Record<string, unknown>,
  people: T[],
): T[] {
  if (removedChildNames(profile).length === 0) return people;
  return people.filter(
    (p) => !isPlainObject(p) || !isRemovedChild(profile, personName(p)),
  );
}

/** An update item that asks for the person to be removed, not merged. */
export function isRemoval(p: Person): boolean {
  return p.remove === true || p.removed === true || p.delete === true;
}
