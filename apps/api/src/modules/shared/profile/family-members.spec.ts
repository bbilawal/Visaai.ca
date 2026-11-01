import {
  findByName,
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
