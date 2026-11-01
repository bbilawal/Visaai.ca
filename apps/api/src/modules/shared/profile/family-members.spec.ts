import {
  REMOVED_CHILDREN_KEY,
  isRemovedChild,
  withoutRemovedChildren,
  findByName,
  isSamePerson,
  mergePeopleByName,
  mergeProfileUpdate,
  normalizePersonName,
} from './family-members';

/**
 * #35 (dry run 2026-10-14): two sons' occupations swapped. People are matched by
 * name; an update that lists them in a different order must not move anyone's
 * details onto a sibling.
 */
describe('family members are matched by name, not position', () => {
  const sons = [
    { name: 'Ahmed Khan', relationship: 'son', occupation: 'Engineer' },
    { name: 'Bilal Khan', relationship: 'son', occupation: 'Doctor' },
  ];

  it('normalizes case, accents, punctuation and honorifics', () => {
    expect(normalizePersonName('  Dr. JOSÉ  Núñez-Díaz ')).toBe(
      'jose nunez diaz',
    );
  });

  it('an update in reverse order lands on the right son', () => {
    const merged = mergePeopleByName(sons, [
      { name: 'bilal khan', occupation: 'Surgeon' },
      { name: 'AHMED KHAN', occupation: 'Engineer' },
    ]);
    expect(merged).toEqual([
      { name: 'AHMED KHAN', relationship: 'son', occupation: 'Engineer' },
      { name: 'bilal khan', relationship: 'son', occupation: 'Surgeon' },
    ]);
  });

  it('a partial update touches only the son it names and keeps the other', () => {
    const merged = mergePeopleByName(sons, [
      { name: 'Bilal', occupation: 'Surgeon' },
    ]);
    expect(merged[0]).toEqual(sons[0]);
    expect(merged[1].occupation).toBe('Surgeon');
    expect(merged).toHaveLength(2);
  });

  it('a first name shared by two people matches neither (no guessing)', () => {
    const twins = [{ name: 'Ali Khan' }, { name: 'Ali Raza' }];
    expect(findByName(twins, 'Ali')).toBeNull();
    expect(
      mergePeopleByName(twins, [{ name: 'Ali', occupation: 'x' }]),
    ).toHaveLength(3);
  });

  it('a new named person is appended', () => {
    const merged = mergePeopleByName(sons, [
      { name: 'Sara Khan', relationship: 'daughter' },
    ]);
    expect(merged.map((p) => p.name)).toEqual([
      'Ahmed Khan',
      'Bilal Khan',
      'Sara Khan',
    ]);
  });

  it('an unnamed update is a full replacement, never lined up by index', () => {
    const merged = mergePeopleByName(sons, [{ occupation: 'Surgeon' }]);
    expect(merged).toEqual([{ occupation: 'Surgeon' }]);
  });

  it('mergeProfileUpdate merges people lists and overwrites everything else', () => {
    const out = mergeProfileUpdate(
      { children: sons, purpose_of_visit: 'family' },
      {
        children: [{ name: 'Bilal Khan', occupation: 'Surgeon' }],
        purpose_of_visit: 'tourism',
      },
    );
    expect(out.purpose_of_visit).toBe('tourism');
    expect(
      (out.children as Array<{ occupation: string }>).map((c) => c.occupation),
    ).toEqual(['Engineer', 'Surgeon']);
  });
});

describe('isSamePerson — OCR slips (prod 2026-10-16)', () => {
  it('matches a name whose first letter the OCR dropped', () => {
    expect(isSamePerson('uzaffar Ahmad', 'Muzaffar Ahmad')).toBe(true);
  });
  it('matches a one-letter transliteration difference', () => {
    expect(isSamePerson('Muzaffar Ahmed', 'Muzaffar Ahmad')).toBe(true);
  });
  it('does not stretch a single-token name', () => {
    expect(isSamePerson('Ahmed', 'Ahmad')).toBe(false);
  });
  it('still tells different people apart', () => {
    expect(isSamePerson('Sumera Ahmad', 'Muzaffar Ahmad')).toBe(false);
    expect(isSamePerson('Mian Muhammad Sajawal', 'Mian Muhammad Bilawal')).toBe(
      false,
    );
  });
});

describe('removing a child (dry run 2026-10-16)', () => {
  const sons = [
    { name: 'Mian Muhammad Sajawal', relationship: 'son' },
    { name: 'Mian Muhammad Bilawal', relationship: 'son' },
    { name: 'Mian Talha', relationship: 'son', birth_year: 2000 },
  ];

  it('drops the named child and records the removal', () => {
    const out = mergeProfileUpdate(
      { children: sons },
      { children: [{ name: 'Mian Talha', remove: true }] },
    );
    expect((out.children as { name: string }[]).map((c) => c.name)).toEqual([
      'Mian Muhammad Sajawal',
      'Mian Muhammad Bilawal',
    ]);
    expect(out[REMOVED_CHILDREN_KEY]).toEqual(['Mian Talha']);
  });

  it('never adds a removal item as a child', () => {
    const out = mergePeopleByName(sons.slice(0, 2), [
      { name: 'Someone Else', remove: true },
    ]);
    expect(out).toHaveLength(2);
  });

  it('a child named again is taken off the removal list', () => {
    const out = mergeProfileUpdate(
      { children: sons.slice(0, 2), [REMOVED_CHILDREN_KEY]: ['Mian Talha'] },
      { children: [{ name: 'Mian Talha', relationship: 'son' }] },
    );
    expect(out[REMOVED_CHILDREN_KEY]).toEqual([]);
    expect((out.children as unknown[]).length).toBe(3);
  });

  it('withoutRemovedChildren filters by name', () => {
    const profile = { [REMOVED_CHILDREN_KEY]: ['Mian Talha'] };
    expect(isRemovedChild(profile, 'mian  talha')).toBe(true);
    expect(isRemovedChild(profile, 'Mian Muhammad Bilawal')).toBe(false);
    expect(withoutRemovedChildren(profile, sons)).toHaveLength(2);
  });
});
