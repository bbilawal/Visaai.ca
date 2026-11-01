import {
  childrenUpdate,
  dedupePlaceholderChildren,
  foldIntakeChildren,
  mergeChildLists,
  normalizeChildEntry,
  removedChildFlatKeys,
  withoutRemovedChildFacts,
} from './intake-children';

/**
 * Dry run 2026-10-15 (Canada visitor visa, app 71ad0c29): the applicant named
 * his sons in the interview, but the extractor stored them under ad-hoc flat
 * keys (`youngest_son_name`, `other_son_name`, `family_member_name` +
 * `relationship_to_family_in_destination: "son"`). The IRCC children page reads
 * only the structured `children` list, so every son the applicant named was
 * invisible to it.
 */
const DRY_RUN: Record<string, unknown> = {
  youngest_son_name: 'Mian Talha',
  youngest_son_birth_year: 2000,
  youngest_son_in_home_country: true,
  other_son_name: 'Mian Hamza',
  family_member_name: 'Mian Usman',
  relationship_to_family_in_destination: 'son',
  son_occupation: 'Engineer',
};

describe('foldIntakeChildren — flat intake keys become children entries', () => {
  it('builds one entry per named child, with relationship and sex', () => {
    const children = foldIntakeChildren(DRY_RUN)!;
    expect(children).toHaveLength(3);
    expect(children).toContainEqual(
      expect.objectContaining({
        name: 'Mian Talha',
        relationship: 'son',
        sex: 'Male',
        birth_year: 2000,
        in_home_country: true,
      }),
    );
    expect(children).toContainEqual(
      expect.objectContaining({ name: 'Mian Hamza', relationship: 'son' }),
    );
    expect(children).toContainEqual(
      expect.objectContaining({
        name: 'Mian Usman',
        relationship: 'son',
        in_home_country: false,
      }),
    );
  });

  it('never invents a full date of birth from a year', () => {
    const talha = foldIntakeChildren(DRY_RUN)!.find(
      (c) => c.name === 'Mian Talha',
    )!;
    expect(talha.date_of_birth).toBeUndefined();
  });

  it('leaves an unnamed detail alone when several children could own it', () => {
    // Three sons: whose occupation is `son_occupation`? Guessing is how a
    // detail lands on the wrong child (#35).
    const children = foldIntakeChildren(DRY_RUN)!;
    expect(children.some((c) => 'occupation' in c)).toBe(false);
  });

  it('attaches an unnamed detail when exactly one child can own it', () => {
    const children = foldIntakeChildren({
      daughter_name: 'Sara',
      son_name: 'Ali',
      son_occupation: 'Engineer',
    })!;
    expect(children.find((c) => c.name === 'Ali')!.occupation).toBe('Engineer');
    expect(children.find((c) => c.name === 'Sara')).toMatchObject({
      relationship: 'daughter',
      sex: 'Female',
    });
  });

  it('keeps a full ISO date of birth and stores a year-only one as birth_year', () => {
    const children = foldIntakeChildren({
      child_1_name: 'Ali',
      child_1_date_of_birth: '2001-03-04',
      child_2_name: 'Sara',
      child_2_date_of_birth: '2003',
    })!;
    expect(children.find((c) => c.name === 'Ali')!.date_of_birth).toBe(
      '2001-03-04',
    );
    const sara = children.find((c) => c.name === 'Sara')!;
    expect(sara.date_of_birth).toBeUndefined();
    expect(sara.birth_year).toBe(2003);
  });

  it('merges into a document-sourced child by name — never a duplicate', () => {
    const children = foldIntakeChildren({
      ...DRY_RUN,
      children: [
        {
          name: 'Mian Talha Muzaffar',
          date_of_birth: '2000-05-12',
          sex: 'Male',
          relationship: 'son',
        },
      ],
    })!;
    const talhas = children.filter((c) => String(c.name).includes('Talha'));
    expect(talhas).toHaveLength(1);
    // The certificate's full date wins over the interview's year.
    expect(talhas[0].date_of_birth).toBe('2000-05-12');
    expect(talhas[0].in_home_country).toBe(true);
    // The document's spelling of the name is kept.
    expect(talhas[0].name).toBe('Mian Talha Muzaffar');
  });

  it('does not overwrite an existing child detail with a stale flat key', () => {
    const children = foldIntakeChildren({
      youngest_son_name: 'Mian Talha',
      youngest_son_in_home_country: true,
      children: [
        {
          name: 'Mian Talha',
          relationship: 'son',
          sex: 'Male',
          in_home_country: false,
        },
      ],
    });
    // Nothing to change: the list already says what it says.
    expect(children).toBeNull();
  });

  it('lets a flat key the applicant just gave overwrite the child detail', () => {
    const children = foldIntakeChildren(
      {
        youngest_son_name: 'Mian Talha',
        youngest_son_in_home_country: false,
        children: [{ name: 'Mian Talha', in_home_country: true }],
      },
      { fresh: new Set(['youngest_son_in_home_country']) },
    )!;
    expect(children[0].in_home_country).toBe(false);
  });

  it('returns null when there is nothing to fold', () => {
    expect(foldIntakeChildren({ purpose_of_visit: 'family' })).toBeNull();
    expect(
      foldIntakeChildren({
        children: [{ name: 'Ali', relationship: 'son', sex: 'Male' }],
      }),
    ).toBeNull();
  });

  it('is idempotent', () => {
    const once = foldIntakeChildren(DRY_RUN)!;
    expect(foldIntakeChildren({ ...DRY_RUN, children: once })).toBeNull();
  });

  it('does not read in-laws, grandchildren or unrelated keys as children', () => {
    expect(
      foldIntakeChildren({
        son_in_law_name: 'Bilal',
        grandson_name: 'Omar',
        person_name: 'X',
        reason_for_visit: 'family',
        has_children: true,
        number_of_children: 3,
      }),
    ).toBeNull();
  });

  it('does not treat a non-child family member in the destination as a child', () => {
    expect(
      foldIntakeChildren({
        family_member_name: 'Asad',
        relationship_to_family_in_destination: 'brother',
      }),
    ).toBeNull();
  });

  it('turns a count stored under `children` into a list without losing it', () => {
    const update = childrenUpdate({ children: 2, son_name: 'Ali' })!;
    expect(update.children).toEqual([
      expect.objectContaining({ name: 'Ali', relationship: 'son' }),
    ]);
    expect(update.number_of_children).toBe(2);
  });

  it('childrenUpdate is null when nothing changes', () => {
    expect(childrenUpdate({ purpose_of_visit: 'family' })).toBeNull();
  });

  it('normalizes a year-only date_of_birth already inside the list', () => {
    const children = foldIntakeChildren({
      children: [{ name: 'Ali', relationship: 'son', date_of_birth: '2000' }],
    })!;
    expect(children[0]).toMatchObject({ name: 'Ali', birth_year: 2000 });
    expect(children[0].date_of_birth).toBeUndefined();
  });
});

describe('normalizeChildEntry', () => {
  it('infers sex from the relationship', () => {
    expect(
      normalizeChildEntry({ name: 'A', relationship: 'Daughter' }),
    ).toEqual({ name: 'A', relationship: 'Daughter', sex: 'Female' });
  });

  it('keeps a full date of birth as it is', () => {
    expect(
      normalizeChildEntry({ name: 'A', date_of_birth: '2000-01-02' }),
    ).toEqual({ name: 'A', date_of_birth: '2000-01-02' });
  });
});

describe('mergeChildLists — the row and the interview, by name', () => {
  it('keeps a document date of birth the interview never had', () => {
    const merged = mergeChildLists(
      [{ name: 'Mian Talha', date_of_birth: '2000-05-12' }],
      [{ name: 'Mian Talha', birth_year: 2000, in_home_country: true }],
    );
    expect(merged).toEqual([
      {
        name: 'Mian Talha',
        date_of_birth: '2000-05-12',
        birth_year: 2000,
        in_home_country: true,
      },
    ]);
  });

  it('keeps children only one side knows', () => {
    const merged = mergeChildLists(
      [{ name: 'Ali', date_of_birth: '2001-01-01' }],
      [{ name: 'Sara', relationship: 'daughter' }],
    );
    expect(merged.map((c) => c.name)).toEqual(['Ali', 'Sara']);
  });

  it('lets the interview correct a detail of a known child', () => {
    const merged = mergeChildLists(
      [{ name: 'Ali', date_of_birth: '2001-01-01' }],
      [{ name: 'Ali', date_of_birth: '2001-02-01' }],
    );
    expect(merged).toEqual([{ name: 'Ali', date_of_birth: '2001-02-01' }]);
  });
});

describe('a removed child stays removed (dry run 2026-10-16)', () => {
  it('flat keys from an earlier turn do not fold him back in', () => {
    const update = childrenUpdate({
      youngest_son_name: 'Mian Talha',
      youngest_son_birth_year: 2000,
      removed_children: ['Mian Talha'],
      children: [
        { name: 'Mian Muhammad Sajawal', relationship: 'son' },
        { name: 'Mian Talha', relationship: 'son', birth_year: 2000 },
      ],
    });
    expect((update?.children as { name: string }[]).map((c) => c.name)).toEqual(
      ['Mian Muhammad Sajawal'],
    );
  });

  it('removing the only child leaves an empty list', () => {
    const update = childrenUpdate({
      removed_children: ['Mian Talha'],
      children: [{ name: 'Mian Talha', relationship: 'son' }],
    });
    expect(update?.children).toEqual([]);
  });
});

describe('dedupePlaceholderChildren (prod 2026-10-16, super visa)', () => {
  const unknownSon = {
    sex: 'Male',
    name: 'Unknown',
    relationship: 'son',
    in_home_country: false,
    country_of_residence: 'Canada',
  };
  const named = (name: string, extra: Record<string, unknown> = {}) => ({
    sex: 'Male',
    name,
    relationship: 'son',
    date_of_birth: '1989-10-14',
    in_home_country: false,
    country_of_residence: 'Canada',
    ...extra,
  });
  const talha = {
    sex: 'Male',
    name: 'Mian Talha',
    birth_year: 2000,
    relationship: 'son',
    in_home_country: true,
    country_of_residence: 'Pakistan',
  };

  it('folds two "Unknown" sons in Canada into the two named ones, and keeps Talha', () => {
    const out = dedupePlaceholderChildren([
      unknownSon,
      { ...unknownSon },
      named('Mian Muhammad Bilawal'),
      named('Mian Muhammad Sajawal'),
      talha,
    ]) as Array<Record<string, unknown>>;
    expect(out.map((c) => c.name)).toEqual([
      'Mian Muhammad Bilawal',
      'Mian Muhammad Sajawal',
      'Mian Talha',
    ]);
  });

  it('keeps a placeholder no named child fits (a child still to be named)', () => {
    const out = dedupePlaceholderChildren([
      { name: 'Unknown', relationship: 'daughter', sex: 'Female' },
      named('Mian Muhammad Bilawal'),
    ]) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
  });

  it('keeps extra placeholders beyond the named children they can stand for', () => {
    const out = dedupePlaceholderChildren([
      unknownSon,
      { ...unknownSon },
      { ...unknownSon },
      named('Mian Muhammad Bilawal'),
    ]) as Array<Record<string, unknown>>;
    expect(out.filter((c) => c.name === 'Unknown')).toHaveLength(2);
  });

  it("moves a placeholder's detail onto the one child it fits, never overwriting", () => {
    const out = dedupePlaceholderChildren([
      {
        name: 'son 1',
        relationship: 'son',
        occupation: 'Engineer',
        country_of_residence: 'Canada',
      },
      named('Mian Muhammad Bilawal', { occupation: 'QA Analyst' }),
      talha,
    ]) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    expect(out[0].occupation).toBe('QA Analyst');
  });

  it('will not guess between two sons for a placeholder carrying details', () => {
    const out = dedupePlaceholderChildren([
      { name: 'Unknown', relationship: 'son', occupation: 'Pilot' },
      named('Mian Muhammad Bilawal'),
      named('Mian Muhammad Sajawal'),
    ]) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(3);
  });

  it('leaves a list with no named child alone', () => {
    const list = [unknownSon, { ...unknownSon }];
    expect(dedupePlaceholderChildren(list)).toBe(list);
  });
});

describe('removed child facts (dry run 2026-10-16)', () => {
  const profile = {
    youngest_son_name: 'Mian Talha',
    youngest_son_birth_year: 2000,
    youngest_son_in_home_country: true,
    other_son_name: 'Mian Muhammad Sajawal',
    other_son_occupation: 'Customer Account Representative',
    removed_children: ['Mian Talha'],
  };

  it("finds only the removed child's flat keys", () => {
    expect(removedChildFlatKeys(profile).sort()).toEqual([
      'youngest_son_birth_year',
      'youngest_son_in_home_country',
      'youngest_son_name',
    ]);
  });

  it('prompts never see them', () => {
    const shown = withoutRemovedChildFacts(profile);
    expect(Object.keys(shown)).not.toContain('youngest_son_name');
    expect(shown.other_son_name).toBe('Mian Muhammad Sajawal');
  });

  it('nothing is dropped when no child was removed', () => {
    const { removed_children: _r, ...rest } = profile;
    expect(removedChildFlatKeys(rest)).toEqual([]);
  });
});
