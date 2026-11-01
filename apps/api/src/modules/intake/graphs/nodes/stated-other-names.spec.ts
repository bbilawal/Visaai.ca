import { HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { makeProcessAnswerNode } from './process-answer';
import type { IntakeState } from '../intake.state';
import { withStatedOtherNames } from './stated-other-names';

/**
 * Live 2026-10-30 (TRV, app 945eb7f1): "Yes: my name is sometimes written as
 * <alias> (order differs). Full name on passport: family name <F>, given names
 * <G>." was stored as other_names = [{previous name, given <G>, family <F>}] —
 * the PASSPORT name as the other name, the real alias dropped. The tr-rt fill
 * refuses an other name equal to the current name, so the alias never reached
 * IRCC. Names below are invented.
 */
const Q =
  'Have you ever used any other name, including an alias, different spelling, or former name?';
const ANSWER =
  'Yes: my name is sometimes written as Tariq Hassan Mirza (order differs). Full name on passport: family name Hassan, given names Mirza Tariq.';

const llm = (reply: string) =>
  ({
    invoke: () => Promise.resolve({ content: reply }),
  }) as unknown as ChatOpenAI;

const state = (answer: string, profileJson: Record<string, unknown> = {}): IntakeState => ({
  applicationId: 'app-1',
  visaTypeId: null,
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: {},
  profileJson,
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [new HumanMessage(answer)],
  isComplete: false,
  currentQuestion: Q,
  checklistBuiltAt: null,
  profileChanges: [],
});

describe('processAnswer — other names', () => {
  it('does not store the passport name given alongside the alias as an other name', async () => {
    const node = makeProcessAnswerNode(
      llm(
        JSON.stringify({
          has_other_names: true,
          other_names: [
            { kind: 'previous name', given_name: 'Mirza Tariq', family_name: 'Hassan' },
            { kind: 'alias', given_name: 'Tariq Hassan', family_name: 'Mirza' },
          ],
        }),
      ),
    );

    const out = await node(state(ANSWER));

    expect(out.profileJson?.has_other_names).toBe(true);
    expect(out.profileJson?.other_names).toEqual([
      { kind: 'alias', given_name: 'Tariq Hassan', family_name: 'Mirza' },
    ]);
  });

  it('records no other name when the extractor gave only the passport name', async () => {
    const node = makeProcessAnswerNode(
      llm(
        JSON.stringify({
          has_other_names: true,
          other_names: [
            { kind: 'previous name', given_name: 'Mirza Tariq', family_name: 'Hassan' },
          ],
        }),
      ),
    );

    const out = await node(state(ANSWER));

    expect(out.profileJson?.has_other_names).toBe(true);
    expect(out.profileJson).not.toHaveProperty('other_names');
  });

  // Review of 79e37f34: names guessed from wording became the applicant's
  // declared other names — other people's, and names the applicant denied.
  it.each([
    ['No. My father is known as Ali Khan', { has_other_names: false }],
    ['No, but my wife Ayesha goes by Ayesha Malik', { has_other_names: false }],
    ["No. My wife's maiden name was Ayesha Malik", { has_other_names: false }],
    ['No, Sara Ahmed is my only name. I am not known as Sara Khan', { has_other_names: false }],
    [
      'No. My father is known as Ali Khan',
      { has_other_names: false, other_names: [{ kind: 'alias', given_name: 'Ali', family_name: 'Khan' }] },
    ],
    [
      'No, but my wife Ayesha goes by Ayesha Malik',
      { used_other_names: 'No', other_names: [{ kind: 'alias', name: 'Ayesha Malik' }] },
    ],
  ])('writes no other name for %j', async (answer, reply) => {
    const out = await makeProcessAnswerNode(llm(JSON.stringify(reply)))(state(answer));
    expect(out.profileJson).not.toHaveProperty('other_names');
  });

  it('writes no other name when the profile already says No and this answer does not say Yes', async () => {
    const out = await makeProcessAnswerNode(
      llm(JSON.stringify({ other_names: [{ kind: 'alias', name: 'Ayesha Malik' }] })),
    )(state('My wife goes by Ayesha Malik', { has_other_names: false }));
    expect(out.profileJson).not.toHaveProperty('other_names');
  });
});

describe('withStatedOtherNames', () => {
  it('drops an other name equal to the current name on file', () => {
    const out = withStatedOtherNames(
      {
        other_names: [
          { kind: 'previous name', given_name: 'Mirza Tariq', family_name: 'Hassan' },
          { kind: 'alias', given_name: 'Tariq', family_name: 'Mirza' },
        ],
      },
      'Yes, Tariq Mirza.',
      { family_name: 'Hassan', given_name: 'Mirza Tariq' },
    );
    expect(out.other_names).toEqual([{ kind: 'alias', given_name: 'Tariq', family_name: 'Mirza' }]);
  });

  it('never adds a name the extractor did not return', () => {
    const extracted = { has_other_names: true };
    expect(
      withStatedOtherNames(extracted, 'Yes, I am also known as Kami Rafiq.', {}),
    ).toBe(extracted);
  });
});
