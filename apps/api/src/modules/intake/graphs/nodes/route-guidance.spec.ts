import { HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { makeAskQuestionNode } from './ask-question';
import {
  routeEligibility,
  routeGuidanceBlock,
  routeIneligibleNotice,
} from './required-facts';
import type { IntakeState } from '../intake.state';

/**
 * The interviewer's eTA brief (dry run 2026-10-16).
 *
 * With no route-specific guidance the tailored prompt told the model to cover
 * "employment, finances, travel history, ties to home country" — visitor-visa
 * evidence an eTA never asks for — and nothing told it to stop a Pakistani
 * applicant who had picked the wrong route.
 */
function state(profileJson: Record<string, unknown>, visaaiId: string) {
  return {
    destinationCountry: 'CA',
    visaTypeId: 'vt',
    frameworkId: null,
    requirementsJson: { visaai_id: visaaiId },
    profileJson,
  } as unknown as IntakeState;
}

const ETA = 'ca-electronic-travel-authorization-eta';

describe('routeGuidanceBlock', () => {
  it('tells the interviewer an eTA is not a visa and needs no funds or letters', () => {
    const block = routeGuidanceBlock(state({}, ETA));
    expect(block).toMatch(/not a visa/i);
    expect(block).toMatch(/do not ask .*funds/i);
  });

  it('tells the interviewer to stop and redirect an ineligible applicant', () => {
    const block = routeGuidanceBlock(state({ nationality: 'Pakistan' }, ETA));
    expect(block).toMatch(/NOT ELIGIBLE/);
    expect(block).toMatch(/visitor visa/i);
    expect(block).toMatch(/selector/i);
  });

  it('is empty for a route no program claims', () => {
    expect(
      routeGuidanceBlock(state({}, 'ca-visitor-visa-temporary-resident-visa')),
    ).toBe('');
  });
});

/**
 * Prod 2026-10-16, app 5d3a17a4: the eTA was chosen while nationality was
 * unknown, and the profile only LATER showed a Pakistani passport. Telling the
 * model to "say this plainly" is not a guarantee it does; the applicant must be
 * told, every turn, until they switch — and their route is not deleted.
 */
describe('askQuestion — a chosen route the profile has since ruled out', () => {
  function llmReplying(text: string) {
    return {
      invoke: () => Promise.resolve({ content: text }),
      // `for await` accepts a plain iterable.
      stream: () => Promise.resolve([{ content: text }]),
    } as unknown as ChatOpenAI;
  }
  const turn = (profileJson: Record<string, unknown>) =>
    ({
      ...state(profileJson, ETA),
      applicationId: 'app-1',
      destinationState: null,
      riskIndicators: [],
      checklistItems: [],
      suggestedVisaTypes: [],
      messages: [new HumanMessage('I have a Pakistani passport')],
      isComplete: false,
      currentQuestion: null,
      checklistBuiltAt: null,
      profileChanges: [],
    }) as unknown as IntakeState;

  it('opens the reply with a fixed notice naming the visitor visa', async () => {
    const out = await makeAskQuestionNode(llmReplying('Next question: ...'))(
      turn({ nationality: 'Pakistan' }),
    );
    const reply = String(out.currentQuestion);
    expect(
      reply.startsWith(
        routeIneligibleNotice(
          routeEligibility('CA', ETA, { nationality: 'Pakistan' })!,
        ),
      ),
    ).toBe(true);
    expect(reply).toMatch(/Pakistan/);
    expect(reply).toMatch(/visitor visa \(TRV\)/);
    expect(reply).toMatch(/Which visa are you applying for\?/);
    expect(reply).toContain('Next question: ...');
  });

  it('streams the notice first, so the applicant sees it as the reply paints', async () => {
    const tokens: string[] = [];
    const out = await makeAskQuestionNode(
      llmReplying('Next question: ...'),
      null,
      {
        onToken: (d) => tokens.push(d),
      },
    )(turn({ nationality: 'Pakistan' }));
    expect(tokens.join('')).toBe(out.currentQuestion);
    expect(tokens[0]).toMatch(/visitor visa/i);
  });

  it('adds nothing while the route still fits (or nationality is unknown)', async () => {
    for (const profile of [{ nationality: 'GB' }, {}]) {
      const out = await makeAskQuestionNode(llmReplying('Next question: ...'))(
        turn(profile),
      );
      expect(out.currentQuestion).toBe('Next question: ...');
    }
  });
});

describe('routeEligibility', () => {
  it('is the program verdict for a route that has one', () => {
    expect(
      routeEligibility('CA', ETA, { nationality: 'Pakistan' }),
    ).toMatchObject({
      status: 'ineligible',
      recommendedVisaaiId: 'ca-visitor-visa-temporary-resident-visa',
    });
    expect(routeEligibility('CA', ETA, {})?.status).toBe('unknown');
  });

  it('is null for a route no program judges', () => {
    expect(
      routeEligibility('CA', 'ca-visitor-visa-temporary-resident-visa', {
        nationality: 'Pakistan',
      }),
    ).toBeNull();
  });
});
