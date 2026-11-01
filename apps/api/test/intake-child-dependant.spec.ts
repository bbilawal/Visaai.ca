import { HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeProcessAnswerNode } from '../src/modules/intake/graphs/nodes/process-answer';
import { makeUpdateProfileNode } from '../src/modules/intake/graphs/nodes/update-profile';
import {
  changeLines,
  fallbackConfirmation,
} from '../src/modules/intake/graphs/nodes/confirm-update';
import type { IntakeState } from '../src/modules/intake/graphs/intake.state';
import {
  mergeNameList,
  mergeProfileUpdate,
} from '../src/modules/shared/profile/family-members';
import { mergeChildLists } from '../src/modules/shared/profile/intake-children';
import { listAnswer } from '../src/modules/automation/portal-fills/canada-ircc';
import { dependantsOf } from '../src/modules/automation/portal-fills/canada-ircc-pr-family';

/**
 * Prod 2026-10-21 (spousal sponsorship): the applicant corrected one
 * daughter's name into family + given names, said she was accompanying, and
 * added a second daughter "who lives with me and is accompanying me". The
 * reply confirmed all of it; the profile kept none of the name parts or the
 * accompanying answers, `children_living_with_you` lost the first daughter
 * (the list was replaced), and the first daughter's `in_home_country` flipped
 * to false. The PR portal's "Add dependant" needs separate names and an
 * accompanying answer, so it could never add either child.
 *
 * All names here are invented.
 */

const NOW = Date.UTC(2026, 9, 21);

const BEFORE: Record<string, unknown> = {
  nationality: 'Pakistan',
  has_children: 'Yes',
  children: [
    {
      name: 'Testa Middle Example',
      relationship: 'daughter',
      sex: 'Female',
      date_of_birth: '2024-07-06',
      same_address: true,
      in_home_country: true,
      country_of_residence: 'Pakistan',
    },
  ],
  children_living_with_you: ['Testa Middle Example'],
};

/** What the extractor returns for the live message, under the new prompt. */
const EXTRACTION = {
  children: [
    {
      name: 'Testa Middle Example',
      given_name: 'Testa Middle',
      family_name: 'Example',
      relationship: 'daughter',
      accompanying: true,
      // The live flip: a travel plan read as "not in the home country".
      in_home_country: false,
    },
    {
      name: 'Test Dummy Example',
      given_name: 'Test Dummy',
      family_name: 'Example',
      relationship: 'daughter',
      sex: 'Female',
      date_of_birth: '2020-01-15',
      country_of_birth: 'Pakistan',
      marital_status: 'Single',
      same_address: true,
      in_home_country: true,
      accompanying: true,
    },
  ],
  // The live shape: an object list naming only the child the answer added.
  children_living_with_you: [{ name: 'Test Dummy Example' }],
  children_accompanying: ['Testa Middle Example', 'Test Dummy Example'],
};

function llm(reply: unknown) {
  return {
    invoke: () => Promise.resolve({ content: JSON.stringify(reply) }),
  } as unknown as ChatOpenAI;
}

function state(profileJson: Record<string, unknown>): IntakeState {
  return {
    applicationId: 'app-test',
    visaTypeId: null,
    frameworkId: null,
    destinationCountry: 'CA',
    destinationState: null,
    requirementsJson: {},
    profileJson,
    riskIndicators: [],
    checklistItems: [],
    suggestedVisaTypes: [],
    messages: [new HumanMessage('correction about my daughters')],
    isComplete: true,
    currentQuestion: 'Anything to correct?',
    checklistBuiltAt: null,
    profileChanges: [],
  } as IntakeState;
}

function db(current: Record<string, unknown>) {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: { profile_json: current }, error: null });
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
    }),
  } as unknown as SupabaseClient;
  return { client, upsert };
}

/** extract → state reducer → update_profile row write, as the graph runs it. */
async function runCorrection(reply: unknown) {
  const out = await makeProcessAnswerNode(llm(reply))(state(BEFORE));
  const checkpoint = { ...BEFORE, ...out.profileJson };
  const { client, upsert } = db(BEFORE);
  await makeUpdateProfileNode(client)(state(checkpoint));
  return {
    row: upsert.mock.calls[0][0].profile_json as Record<string, unknown>,
    changes: out.profileChanges ?? [],
  };
}

describe('intake correction → stored children → PR "Add dependant"', () => {
  it('stores per-child names, accompanying and marital status; keeps both living-with names', async () => {
    const { row } = await runCorrection(EXTRACTION);
    const kids = row.children as Record<string, unknown>[];
    expect(kids).toHaveLength(2);
    expect(kids[0]).toMatchObject({
      name: 'Testa Middle Example',
      given_name: 'Testa Middle',
      family_name: 'Example',
      accompanying: true,
      date_of_birth: '2024-07-06',
      country_of_residence: 'Pakistan',
      // Accompanying is a travel plan, not a move.
      in_home_country: true,
    });
    expect(kids[1]).toMatchObject({
      name: 'Test Dummy Example',
      given_name: 'Test Dummy',
      family_name: 'Example',
      marital_status: 'Single',
      country_of_birth: 'Pakistan',
      accompanying: true,
    });
    expect(row.children_living_with_you).toEqual([
      'Testa Middle Example',
      'Test Dummy Example',
    ]);
    // The IRCC child pages read the list as names.
    expect(
      listAnswer(row, 'children_living_with_you', 'Testa Middle Example', 2),
    ).toBe('Yes');
  });

  it('the PR portal adds both daughters as accompanying dependants', async () => {
    const { row } = await runCorrection(EXTRACTION);
    expect(dependantsOf(row, NOW)).toEqual([
      {
        family: 'Example',
        given: 'Testa Middle',
        dob: '2024/07/06',
        relationship: 'Child',
        accompanying: 'Yes',
      },
      {
        family: 'Example',
        given: 'Test Dummy',
        dob: '2020/01/15',
        relationship: 'Child',
        accompanying: 'Yes',
      },
    ]);
  });

  it('a child given only as family + given names is matched and gets a full name', async () => {
    const { row } = await runCorrection({
      children: [
        {
          given_name: 'Testa Middle',
          family_name: 'Example',
          accompanying: 'Yes',
        },
      ],
    });
    const kids = row.children as Record<string, unknown>[];
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({
      name: 'Testa Middle Example',
      given_name: 'Testa Middle',
      family_name: 'Example',
      accompanying: 'Yes',
      in_home_country: true,
    });
    expect(row.children_living_with_you).toEqual(['Testa Middle Example']);
  });

  it('a stated move (with the new country) still changes where the child lives', async () => {
    const { row } = await runCorrection({
      children: [
        {
          name: 'Testa Middle Example',
          in_home_country: false,
          country_of_residence: 'Canada',
        },
      ],
    });
    expect((row.children as Record<string, unknown>[])[0]).toMatchObject({
      in_home_country: false,
      country_of_residence: 'Canada',
    });
  });

  it('the confirmation is built per child and per saved field', async () => {
    const { changes } = await runCorrection(EXTRACTION);
    const lines = changes.flatMap(changeLines);
    expect(lines).toContain(
      'children › Testa Middle Example › given_name: (not set) → Testa Middle',
    );
    expect(lines).toContain(
      'children › Testa Middle Example › accompanying: (not set) → true',
    );
    expect(
      lines.some((l) => /Testa Middle Example › in_home_country/.test(l)),
    ).toBe(false);
    expect(lines).toContain(
      'children_living_with_you: added Test Dummy Example',
    );
    expect(lines.some((l) => /Test Dummy Example: added \(/.test(l))).toBe(
      true,
    );
    expect(fallbackConfirmation(changes)).toContain(
      'children › Testa Middle Example › family name: (not set) → Example',
    );
  });
});

describe('name lists merge, they are not replaced', () => {
  it('adds names, keeps the others, removes only on an explicit removal', () => {
    expect(mergeNameList(['A Example'], [{ name: 'B Example' }])).toEqual([
      'A Example',
      'B Example',
    ]);
    expect(mergeNameList(['A Example'], ['a example', 'B Example'])).toEqual([
      'a example',
      'B Example',
    ]);
    expect(
      mergeNameList(
        ['A Example', 'B Example'],
        [{ name: 'A Example', remove: true }],
      ),
    ).toEqual(['B Example']);
    expect(mergeNameList(['A Example'], [])).toEqual([]);
  });

  it('a child removed from children leaves the name lists too', () => {
    const out = mergeProfileUpdate(
      {
        children: [{ name: 'A Example' }, { name: 'B Example' }],
        children_living_with_you: ['A Example', 'B Example'],
        children_accompanying: ['B Example'],
      },
      { children: [{ name: 'B Example', remove: true }] },
    );
    expect(out.children).toEqual([{ name: 'A Example' }]);
    expect(out.children_living_with_you).toEqual(['A Example']);
    expect(out.children_accompanying).toEqual([]);
  });

  it('a non-list answer ("none") still replaces the list', () => {
    expect(
      mergeProfileUpdate(
        { children_accompanying: ['A Example'] },
        { children_accompanying: 'none' },
      ).children_accompanying,
    ).toBe('none');
  });
});

describe('mergeChildLists never wipes a value with an empty one', () => {
  it('null/empty in the checkpoint keeps the row value; same DOB matches an unnamed child', () => {
    const merged = mergeChildLists(
      [
        {
          name: 'A Example',
          date_of_birth: '2020-01-15',
          family_name: 'Example',
        },
      ],
      [
        { name: 'A Example', family_name: null, given_name: '' },
        { date_of_birth: '2020-01-15', marital_status: 'Single' },
      ],
    );
    expect(merged).toEqual([
      {
        name: 'A Example',
        date_of_birth: '2020-01-15',
        family_name: 'Example',
        marital_status: 'Single',
      },
    ]);
  });

  it('two named children with the same DOB (twins) are not merged', () => {
    const merged = mergeChildLists(
      [{ name: 'A Example', date_of_birth: '2020-01-15' }],
      [{ name: 'B Example', date_of_birth: '2020-01-15' }],
    );
    expect(merged).toHaveLength(2);
  });
});

describe('review follow-ups (PR #287)', () => {
  it('siblings with near names are never merged or removed for each other', () => {
    // One letter apart: sisters, not an OCR slip.
    expect(mergeNameList(['Aliya Khan'], ['Aliza Khan'])).toEqual([
      'Aliya Khan',
      'Aliza Khan',
    ]);
    // A token subset is a different child when both are on the roster.
    const roster = ['Ali Khan', 'Ali Raza Khan'];
    expect(mergeNameList(['Ali Raza Khan'], ['Ali Khan'], [], roster)).toEqual([
      'Ali Raza Khan',
      'Ali Khan',
    ]);
    expect(
      mergeNameList(
        ['Ali Khan', 'Ali Raza Khan'],
        [{ name: 'Ali Khan', remove: true }],
        [],
        roster,
      ),
    ).toEqual(['Ali Raza Khan']);
    // …and a loose match is still taken when it can only be one child.
    expect(
      mergeNameList(['Ali Raza Khan'], ['Ali Raza'], [], ['Ali Raza Khan']),
    ).toEqual(['Ali Raza']);
  });

  it('removing child "Ali Khan" keeps "Ali Raza Khan" on children_accompanying', () => {
    const out = mergeProfileUpdate(
      {
        children: [{ name: 'Ali Khan' }, { name: 'Ali Raza Khan' }],
        children_accompanying: ['Ali Raza Khan'],
        children_living_with_you: ['Aliya Khan', 'Ali Khan'],
      },
      { children: [{ name: 'Ali Khan', remove: true }] },
    );
    expect(out.children).toEqual([{ name: 'Ali Raza Khan' }]);
    expect(out).not.toHaveProperty('children_accompanying');
    expect(out.children_living_with_you).toEqual(['Aliya Khan']);
  });

  it('a narrowing restatement ("only X lives with me") keeps others unless removed explicitly', () => {
    // Documented behaviour: a list is additive; the prompt asks the model to
    // send {"name", "remove": true} for children no longer in it.
    const existing = {
      children: [{ name: 'A Example' }, { name: 'B Example' }],
      children_living_with_you: ['A Example', 'B Example'],
    };
    expect(
      mergeProfileUpdate(existing, { children_living_with_you: ['A Example'] })
        .children_living_with_you,
    ).toEqual(['A Example', 'B Example']);
    expect(
      mergeProfileUpdate(existing, {
        children_living_with_you: [
          'A Example',
          { name: 'B Example', remove: true },
        ],
      }).children_living_with_you,
    ).toEqual(['A Example']);
  });

  it('only the two children name lists are merged as names', () => {
    expect(
      mergeProfileUpdate(
        { family_members_accompanying: ['A Example'] },
        { family_members_accompanying: ['B Example'] },
      ).family_members_accompanying,
    ).toEqual(['B Example']);
  });

  it('unnamed record lists keep the plain change line', () => {
    const lines = changeLines({
      key: 'work_history',
      from: [{ employer: 'Old Co', from: '2019-01' }],
      to: [
        { employer: 'Old Co', from: '2019-01' },
        { employer: 'New Co', from: '2021-01' },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^work_history: \[/);
    expect(lines[0]).not.toMatch(/unnamed|added/);
  });

  it('a dropped in_home_country flip is not reported as saved', async () => {
    for (const key of ['current_residence', 'location', 'city_of_residence']) {
      const kept = mergeProfileUpdate(BEFORE, {
        children: [
          {
            name: 'Testa Middle Example',
            in_home_country: false,
            [key]: 'Toronto',
          },
        ],
      });
      expect(
        (kept.children as Record<string, unknown>[])[0].in_home_country,
      ).toBe(false);
    }
    const { changes } = await runCorrection({
      children: [{ name: 'Testa Middle Example', in_home_country: false }],
    });
    expect(changes.flatMap(changeLines).join('\n')).not.toMatch(
      /in_home_country/,
    );
  });

  it('a son and a daughter born the same day are not matched by date', () => {
    const merged = mergeChildLists(
      [{ name: 'A Example', relationship: 'son', date_of_birth: '2020-01-15' }],
      [
        {
          relationship: 'daughter',
          date_of_birth: '2020-01-15',
          sex: 'Female',
        },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      name: 'A Example',
      relationship: 'son',
      date_of_birth: '2020-01-15',
    });
  });

  it('other people lists still let an explicit null clear a value', () => {
    const out = mergeProfileUpdate(
      { parents: [{ name: 'P Example', date_of_death: '2010-01-01' }] },
      {
        parents: [{ name: 'P Example', date_of_death: null, deceased: false }],
      },
    );
    expect(out.parents).toEqual([
      { name: 'P Example', date_of_death: null, deceased: false },
    ]);
  });
});
