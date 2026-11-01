import {
  CHILD_RESIDENCE_KEYS,
  findByName,
  isPeopleList,
  isRemovedChild,
  normalizePersonName,
  personName,
  withoutRemovedChildren,
} from './family-members';

/**
 * Children the applicant names in the interview → the structured `children`
 * list.
 *
 * Dry run 2026-10-15 (Canada visitor visa, app 71ad0c29): the applicant named
 * his sons, and the extractor stored them under flat keys it made up on the
 * spot — `youngest_son_name: "Mian Talha"`, `youngest_son_birth_year: 2000`,
 * `youngest_son_in_home_country: true`, `other_son_name`,
 * `family_member_name` + `relationship_to_family_in_destination: "son"`. The
 * IRCC children page (automation/portal-fills/canada-ircc.ts) and the
 * document pipeline (documents/graphs/nodes/sync-family.ts) both read and
 * write ONLY `children`, so none of those sons existed for either of them.
 *
 * Rules, all of them about not corrupting what a document already proved:
 *  - a child is matched BY NAME (family-members.ts), never by position, and is
 *    never added twice;
 *  - a full date of birth is only ever an ISO date someone actually gave; a
 *    year stays `birth_year`, and never displaces a certificate's full date;
 *  - an existing child's detail is only overwritten by a flat key the
 *    applicant gave THIS turn (`fresh`); a stale flat key left on the profile
 *    from an earlier turn only fills gaps, so it cannot undo a later
 *    correction made through the list itself.
 *
 * The flat keys are left where they are: deleting them cannot be expressed
 * through the intake state's merge reducer, and folding is idempotent.
 *
 * Pure: no I/O.
 */

type Person = Record<string, unknown>;

/** Words that may precede `son` / `daughter` / `child` in a flat key. */
const QUALIFIERS = new Set([
  'youngest',
  'younger',
  'eldest',
  'elder',
  'oldest',
  'older',
  'middle',
  'other',
  'another',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
  'step',
  'little',
  'big',
]);

const FLAT_CHILD_KEY =
  /^((?:[a-z0-9]+_)*?)(son|daughter|child)(?:_(\d+))?_(.+)$/;

/** Flat attribute → the child attribute it is recorded as. */
const ATTRIBUTE: Record<string, string> = {
  name: 'name',
  full_name: 'name',
  given_name: 'given_name',
  first_name: 'given_name',
  family_name: 'family_name',
  last_name: 'family_name',
  surname: 'family_name',
  birth_year: 'birth_year',
  year_of_birth: 'birth_year',
  yob: 'birth_year',
  date_of_birth: 'date_of_birth',
  dob: 'date_of_birth',
  birth_date: 'date_of_birth',
  age: 'age',
  sex: 'sex',
  gender: 'sex',
  occupation: 'occupation',
  job: 'occupation',
  profession: 'occupation',
  in_home_country: 'in_home_country',
  lives_in_home_country: 'in_home_country',
  // Where the child lives now: the same keys family-members.ts treats as a
  // stated residence (CHILD_RESIDENCE_KEYS), so the two cannot drift.
  ...Object.fromEntries(CHILD_RESIDENCE_KEYS.map((k) => [k, 'residence'])),
  marital_status: 'marital_status',
  accompanying: 'accompanying',
  coming_to_canada: 'accompanying',
  country_of_birth: 'country_of_birth',
  place_of_birth: 'place_of_birth',
};

/** Same fact, other spellings: a child "has" an attribute under any of them. */
const ALIASES: Record<string, string[]> = {
  date_of_birth: ['date_of_birth', 'dob', 'birth_date'],
  sex: ['sex', 'gender'],
  relationship: ['relationship', 'relation'],
  occupation: ['occupation', 'job', 'profession'],
  residence: ['residence', 'country_of_residence', 'lives_in'],
};

/** A family member in the destination, recorded as a name + a relationship. */
const RELATIVE_PAIRS: Array<[string, string]> = [
  ['family_member_name', 'relationship_to_family_in_destination'],
  ['family_member_name', 'family_member_relationship'],
  ['family_in_destination_name', 'relationship_to_family_in_destination'],
  ['relative_in_destination_name', 'relationship_to_family_in_destination'],
  ['relative_name', 'relative_relationship'],
];

const CHILD_RELATIONSHIP = /^(step[-\s]?)?(son|daughter)$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function isPlainObject(v: unknown): v is Person {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A bare year (2000, "2000"), or null. */
function yearOnly(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v > 1900 && v < 2100)
    return v;
  if (typeof v === 'string' && /^\s*(19|20)\d{2}\s*$/.test(v))
    return Number(v.trim());
  return null;
}

function isFullDate(v: unknown): boolean {
  return typeof v === 'string' && ISO_DAY.test(v.trim().slice(0, 10));
}

function yesNo(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim().toLowerCase();
  if (['yes', 'y', 'true'].includes(t)) return true;
  if (['no', 'n', 'false'].includes(t)) return false;
  return v;
}

function sexFor(relationship: unknown): 'Male' | 'Female' | undefined {
  if (typeof relationship !== 'string') return undefined;
  const r = relationship.toLowerCase();
  if (/daughter/.test(r)) return 'Female';
  if (/\bson\b|stepson/.test(r)) return 'Male';
  return undefined;
}

function has(child: Person, attr: string): boolean {
  return (ALIASES[attr] ?? [attr]).some((a) => hasValue(child[a]));
}

/**
 * One child entry in its canonical shape: a year-only `date_of_birth` becomes
 * `birth_year`, and `sex` is filled from a son/daughter relationship.
 */
export function normalizeChildEntry(child: Person): Person {
  const out: Person = { ...child };
  for (const k of ['date_of_birth', 'dob', 'birth_date']) {
    const year = yearOnly(out[k]);
    if (year === null) continue;
    delete out[k];
    if (!hasValue(out.birth_year)) out.birth_year = year;
  }
  if (!has(out, 'sex')) {
    const sex = sexFor(out.relationship ?? out.relation);
    if (sex) out.sex = sex;
  }
  // `name` stays the full name every other reader uses; a child given only
  // as family name + given names gets one.
  if (!hasValue(out.name) && !hasValue(out.full_name)) {
    const full = [out.given_name ?? out.given_names, out.family_name]
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .map((x) => x.trim())
      .join(' ');
    if (full) out.name = full;
  }
  return out;
}

/**
 * Set one attribute on a child. `overwrite` is for what the applicant said
 * this turn; otherwise it only fills a gap. A year never touches a full date.
 */
function setAttr(
  child: Person,
  attr: string,
  value: unknown,
  overwrite: boolean,
): void {
  if (!hasValue(value)) return;
  if (attr === 'name') return;
  if (attr === 'date_of_birth') {
    const year = yearOnly(value);
    if (year !== null) {
      setAttr(child, 'birth_year', year, overwrite);
      return;
    }
    if (!isFullDate(value)) return;
  }
  if (attr === 'birth_year') {
    // The certificate's full date is the better fact; a year beside it adds
    // nothing and could only contradict it.
    if (isFullDate(child.date_of_birth)) return;
    const year = yearOnly(value);
    if (year === null) return;
    value = year;
  }
  if (attr === 'in_home_country') value = yesNo(value);
  if (has(child, attr) && !overwrite) return;
  child[attr] = value;
}

interface FlatGroup {
  relationship?: string;
  attrs: Record<string, { value: unknown; fresh: boolean }>;
  /** The profile keys this child was recorded under. */
  keys: string[];
}

/** Flat `<qualifier>_son_<attr>` keys, grouped per child. */
function flatGroups(
  profile: Record<string, unknown>,
  fresh: Set<string>,
): Map<string, FlatGroup> {
  const groups = new Map<string, FlatGroup>();
  for (const [key, value] of Object.entries(profile)) {
    const m = FLAT_CHILD_KEY.exec(key);
    if (!m) continue;
    const qualifiers = m[1] ? m[1].slice(0, -1).split('_') : [];
    if (!qualifiers.every((q) => QUALIFIERS.has(q))) continue;
    const role = m[2];
    const rawAttr = m[4];
    if (/^in_law/.test(rawAttr)) continue;
    const attr = ATTRIBUTE[rawAttr] ?? rawAttr;
    const id = `${m[1]}${role}${m[3] ? `_${m[3]}` : ''}`;
    const group = groups.get(id) ?? {
      relationship:
        role === 'child'
          ? undefined
          : qualifiers.includes('step')
            ? `step${role}`
            : role,
      attrs: {},
      keys: [],
    };
    group.attrs[attr] = { value, fresh: fresh.has(key) };
    group.keys.push(key);
    groups.set(id, group);
  }
  return groups;
}

/** The current list `children` stands for, or [] when it is not a list. */
function currentChildren(profile: Record<string, unknown>): Person[] {
  const out: Person[] = [];
  for (const key of ['children', 'children_details']) {
    const v = profile[key];
    if (!Array.isArray(v)) continue;
    for (const c of v) {
      if (!isPlainObject(c)) continue;
      // `children_details` exists only because `children` once held a
      // non-list; fold its people in, by name.
      if (key === 'children_details' && personName(c)) {
        const known = findByName(out, personName(c));
        if (known) {
          for (const [k, val] of Object.entries(c))
            if (!hasValue(known[k])) known[k] = val;
          continue;
        }
      }
      out.push({ ...c });
    }
  }
  return out;
}

function nameFrom(attrs: FlatGroup['attrs']): string {
  const name = attrs.name?.value;
  if (typeof name === 'string' && name.trim()) return name.trim();
  const parts = [attrs.given_name?.value, attrs.family_name?.value].filter(
    (x): x is string => typeof x === 'string' && x.trim() !== '',
  );
  return parts.join(' ');
}

/**
 * The `children` list with every child named in flat intake keys folded in,
 * or null when nothing would change.
 *
 * `fresh` holds the profile keys the applicant gave this turn; only those may
 * overwrite a detail a child entry already has.
 */
export function foldIntakeChildren(
  profile: Record<string, unknown>,
  opts: { fresh?: Set<string> } = {},
): Person[] | null {
  const fresh = opts.fresh ?? new Set<string>();
  const before = Array.isArray(profile.children) ? profile.children : [];
  // A child the applicant removed stays removed: the flat keys that named
  // him in an earlier turn are still on the profile and would re-add him.
  const children = withoutRemovedChildren(
    profile,
    currentChildren(profile),
  ).map(normalizeChildEntry);

  const upsert = (
    name: string,
    relationship: string | undefined,
    attrs: FlatGroup['attrs'],
    extra: Person = {},
  ) => {
    if (isRemovedChild(profile, name)) return;
    let child = findByName(children, name);
    if (!child) {
      child = { name };
      children.push(child);
    }
    if (relationship) setAttr(child, 'relationship', relationship, false);
    for (const [attr, { value, fresh: isFresh }] of Object.entries(attrs)) {
      setAttr(child, attr, value, isFresh);
    }
    for (const [attr, value] of Object.entries(extra)) {
      setAttr(child, attr, value, false);
    }
    const sex = sexFor(child.relationship ?? child.relation);
    if (sex) setAttr(child, 'sex', sex, false);
  };

  const groups = flatGroups(profile, fresh);
  const unnamed: FlatGroup[] = [];
  for (const group of groups.values()) {
    const name = nameFrom(group.attrs);
    if (!name) {
      unnamed.push(group);
      continue;
    }
    upsert(name, group.relationship, group.attrs);
  }

  for (const [nameKey, relKey] of RELATIVE_PAIRS) {
    const name = profile[nameKey];
    const rel = profile[relKey];
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof rel !== 'string' || !CHILD_RELATIONSHIP.test(rel.trim()))
      continue;
    // Family IN THE DESTINATION: this child does not live in the home country.
    upsert(
      name.trim(),
      rel.trim().toLowerCase().replace(/[-\s]/g, ''),
      {},
      { in_home_country: false },
    );
  }

  // `son_occupation` with no name: it belongs to a child only when exactly
  // one child could own it. Guessing between two sons is how a detail lands
  // on the wrong one (#35).
  for (const group of unnamed) {
    const candidates = children.filter((c) => {
      const rel = c.relationship ?? c.relation;
      const r = typeof rel === 'string' ? rel.toLowerCase() : '';
      return group.relationship ? r === group.relationship : true;
    });
    if (candidates.length !== 1) continue;
    for (const [attr, { value, fresh: isFresh }] of Object.entries(
      group.attrs,
    )) {
      setAttr(candidates[0], attr, value, isFresh);
    }
  }

  if (children.length === 0 && !isPeopleList(profile.children)) return null;
  if (
    isPeopleList(profile.children) &&
    JSON.stringify(children) === JSON.stringify(before)
  ) {
    return null;
  }
  return children;
}

/**
 * The row's children and the interview's, merged BY NAME. The interview's
 * details win on a key both hold (it is the applicant speaking, this turn or
 * earlier); a detail only the row has — a certificate's full date of birth —
 * is kept. Unmatched children from either side are kept; nobody is dropped.
 */
export function mergeChildLists(row: Person[], state: Person[]): Person[] {
  const out = row.filter(isPlainObject).map((c) => ({ ...c }));
  for (const c of state) {
    if (!isPlainObject(c)) continue;
    const match = sameChildIn(out, c);
    if (match) {
      for (const [k, v] of Object.entries(c)) {
        // An empty value is not an answer: it never wipes a recorded one.
        if (!hasValue(v)) continue;
        // A year never displaces a full date the row already has.
        if (
          ['date_of_birth', 'dob', 'birth_date'].includes(k) &&
          !isFullDate(v) &&
          isFullDate(match[k])
        )
          continue;
        match[k] = v;
      }
      continue;
    }
    const dup = out.some((o) => JSON.stringify(o) === JSON.stringify(c));
    if (!dup) out.push({ ...c });
  }
  return out;
}

/**
 * The child in `list` that `c` is: by name, else — when one side has no name
 * — by the same full date of birth held by exactly one child. Two named
 * children are never matched by date alone (twins).
 */
function sameChildIn(list: Person[], c: Person): Person | null {
  const name = personName(c);
  const byName = name ? findByName(list, name) : null;
  if (byName) return byName;
  const dob = firstValue(c, ['date_of_birth', 'dob', 'birth_date']);
  if (!isFullDate(dob)) return null;
  const day = String(dob).trim().slice(0, 10);
  const same = list.filter((o) => {
    const d = firstValue(o, ['date_of_birth', 'dob', 'birth_date']);
    return isFullDate(d) && String(d).trim().slice(0, 10) === day;
  });
  if (same.length !== 1) return null;
  if (name && personName(same[0])) return null;
  // A son is not a daughter born the same day.
  if (!sameKind(c, same[0])) return null;
  return same[0];
}

/** Relationship and sex do not contradict each other ("son" vs "daughter"). */
function sameKind(a: Person, b: Person): boolean {
  const ra = relationOf(a).replace(/[-\s]/g, '');
  const rb = relationOf(b).replace(/[-\s]/g, '');
  if (ra && rb && ra !== 'child' && rb !== 'child' && ra !== rb) return false;
  const sex = (p: Person) =>
    norm(firstValue(p, ['sex', 'gender']) ?? sexFor(relationOf(p)))[0] ?? '';
  const sa = sex(a);
  const sb = sex(b);
  return !sa || !sb || sa === sb;
}

/**
 * The profile keys to write so `children` holds every child the interview
 * named, or null when nothing changes. When `children` held something other
 * than a list (a count, a yes/no, a sentence), that fact moves to the key that
 * means it instead of being overwritten.
 */
export function childrenUpdate(
  profile: Record<string, unknown>,
  opts: { fresh?: Set<string> } = {},
): Record<string, unknown> | null {
  const children = foldIntakeChildren(profile, opts);
  if (!children) return null;
  const out: Record<string, unknown> = { children };
  const prev = profile.children;
  if (!Array.isArray(prev) && hasValue(prev)) {
    if (typeof prev === 'number' && !hasValue(profile.number_of_children))
      out.number_of_children = prev;
    else if (typeof prev === 'boolean' && !hasValue(profile.has_children))
      out.has_children = prev;
    else if (typeof prev === 'string' && !hasValue(profile.children_note))
      out.children_note = prev;
  }
  return out;
}

// ─── Placeholder children ────────────────────────────────────────────────────

const PLACEHOLDER_NAME =
  /^(unknown|unnamed|na|n a|none|not provided|not known|not given|tbd|tba|placeholder)$/;
const ORDINAL_CHILD =
  /^((first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|eldest|elder|older|oldest|youngest|younger|middle|other|another)\s+)?(son|daughter|child)(\s+\d+)?$/;

/** A child entry intake recorded before it knew the child's name. */
export function isPlaceholderChild(child: Person): boolean {
  const n = normalizePersonName(personName(child));
  return !n || PLACEHOLDER_NAME.test(n) || ORDINAL_CHILD.test(n);
}

/** Attributes that must agree for a placeholder to be the same child. */
const IDENTIFYING: Array<{ attr: string; keys: string[] }> = [
  { attr: 'sex', keys: ['sex', 'gender'] },
  { attr: 'date_of_birth', keys: ['date_of_birth', 'dob', 'birth_date'] },
  { attr: 'birth_year', keys: ['birth_year'] },
  {
    attr: 'residence',
    keys: ['country_of_residence', 'residence', 'lives_in'],
  },
  { attr: 'in_home_country', keys: ['in_home_country'] },
];

function firstValue(child: Person, keys: string[]): unknown {
  for (const k of keys) if (hasValue(child[k])) return child[k];
  return undefined;
}

function norm(v: unknown): string {
  return typeof v === 'string'
    ? v.trim().toLowerCase()
    : v === undefined
      ? ''
      : JSON.stringify(v);
}

function relationOf(child: Person): string {
  const r = child.relationship ?? child.relation;
  return typeof r === 'string' ? r.trim().toLowerCase() : '';
}

function compatible(placeholder: Person, named: Person): boolean {
  const rp = relationOf(placeholder);
  const rn = relationOf(named);
  if (rp && rn && rp !== 'child' && rn !== 'child' && rp !== rn) return false;
  for (const { attr, keys } of IDENTIFYING) {
    const a = firstValue(placeholder, keys);
    const b = firstValue(named, keys);
    if (!hasValue(a) || !hasValue(b)) continue;
    if (attr === 'sex') {
      if (norm(a)[0] !== norm(b)[0]) return false;
      continue;
    }
    if (attr === 'birth_year') {
      if (yearOnly(a) !== yearOnly(b)) return false;
      continue;
    }
    if (norm(a) !== norm(b)) return false;
  }
  // A placeholder with a birth year must fit a named child's full date.
  const year = yearOnly(placeholder.birth_year);
  const dob = firstValue(named, ['date_of_birth', 'dob', 'birth_date']);
  if (
    year !== null &&
    isFullDate(dob) &&
    String(dob).slice(0, 4) !== String(year)
  )
    return false;
  return true;
}

const COMPARED_KEYS = new Set([
  'name',
  'full_name',
  'relationship',
  'relation',
  ...IDENTIFYING.flatMap((i) => i.keys),
]);

/**
 * Fold placeholder children ("Unknown", "son 2") into the named children they
 * stand for.
 *
 * Prod 2026-10-16 (super visa, app 61f16bb5): intake recorded "two sons in
 * Canada" as two `{ name: "Unknown", relationship: "son",
 * country_of_residence: "Canada" }` entries before it learned their names,
 * then added Mian Muhammad Bilawal and Mian Muhammad Sajawal as new entries —
 * by-name merging cannot match "Unknown" — and the profile listed four sons in
 * Canada. Each placeholder is matched to a distinct named child whose
 * relationship, sex, dates and residence do not contradict it; a placeholder
 * with no such child is kept (it may be a child whose name is still to come).
 * A placeholder's extra details move onto the named child only when exactly
 * one named child fits and only into gaps; when several fit, a placeholder
 * carrying such details is kept rather than guessing.
 */
export function dedupePlaceholderChildren(children: unknown[]): unknown[] {
  if (!Array.isArray(children)) return children;
  const merged = children.map((c) => (isPlainObject(c) ? { ...c } : c));
  const namedCopies = merged.filter(
    (c): c is Person => isPlainObject(c) && !isPlaceholderChild(c),
  );
  if (namedCopies.length === 0) return children;
  const absorbed = new Set<Person>();
  const out: unknown[] = [];
  for (const c of merged) {
    if (!isPlainObject(c) || !isPlaceholderChild(c)) {
      out.push(c);
      continue;
    }
    const candidates = namedCopies.filter(
      (n) => !absorbed.has(n) && compatible(c, n),
    );
    if (candidates.length === 0) {
      out.push(c);
      continue;
    }
    const extras = Object.keys(c).filter(
      (k) => !COMPARED_KEYS.has(k) && hasValue(c[k]),
    );
    if (extras.length > 0 && candidates.length > 1) {
      out.push(c);
      continue;
    }
    const target = candidates[0];
    absorbed.add(target);
    for (const [k, v] of Object.entries(c)) {
      if (k === 'name' || k === 'full_name' || !hasValue(v)) continue;
      const keys = IDENTIFYING.find((i) => i.keys.includes(k))?.keys ??
        ALIASES[k] ?? [k];
      if (keys.some((a) => hasValue(target[a]))) continue;
      target[k] = v;
    }
  }
  return out;
}

/**
 * Flat interview keys that describe a child the applicant removed
 * (`youngest_son_name: "Mian Talha"`, `youngest_son_birth_year`, …).
 *
 * Removing a child (family-members.ts, `removed_children`) took him off
 * `children`, but these keys stayed on the profile and in what the interview
 * model is shown, so it later told the applicant his answer "differs from
 * earlier information that your youngest son lived in Pakistan" (dry run
 * 2026-10-16). update_profile drops them from the row; the prompts never show
 * them.
 */
export function removedChildFlatKeys(
  profile: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const group of flatGroups(profile, new Set()).values()) {
    const name = nameFrom(group.attrs);
    if (name && isRemovedChild(profile, name)) out.push(...group.keys);
  }
  for (const [nameKey, relKey] of RELATIVE_PAIRS) {
    const name = profile[nameKey];
    const rel = profile[relKey];
    if (typeof name !== 'string' || !isRemovedChild(profile, name)) continue;
    if (typeof rel !== 'string' || !CHILD_RELATIONSHIP.test(rel.trim()))
      continue;
    out.push(nameKey, relKey);
  }
  return [...new Set(out)];
}

/** The profile without the flat keys of removed children (for prompts). */
export function withoutRemovedChildFacts(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const drop = removedChildFlatKeys(profile ?? {});
  if (drop.length === 0) return profile;
  const out = { ...profile };
  for (const k of drop) delete out[k];
  return out;
}
