import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { makeConfirmUpdateNode, fallbackConfirmation } from './confirm-update';
import { intakeRouter } from './check-complete';
import type { IntakeState } from '../intake.state';

/**
 * Dry run 2026-10-15 (app 71ad0c29): once the intake was complete the input
 * was disabled, so the applicant could not correct a marriage date of 1999
 * that had to be 1988-09-16. A message after completion is now a correction:
 * it is extracted and written like any answer, and this node replies by saying
 * what changed — without restarting the interview or asking anything new.
 */

const BASE = {
  applicationId: 'app-1',
  visaTypeId: 'vt-trv',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: {},
  profileJson: { marriage_date: '1988-09-16' },
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [
    new AIMessage('Your intake is complete.'),
    new HumanMessage('My marriage date is 16 September 1988, not 1999'),
  ],
  isComplete: true,
  currentQuestion: 'Your intake is complete.',
  checklistBuiltAt: null,
  profileChanges: [
    { key: 'marriage_date', from: '1999-09-16', to: '1988-09-16' },
  ],
} as unknown as IntakeState;

function llm(reply: string, capture: { messages?: unknown[] } = {}) {
  return {
    invoke: (messages: unknown[]) => {
      capture.messages = messages;
      return Promise.resolve({ content: reply });
    },
  } as unknown as ChatOpenAI;
}

function text(messages: unknown[] | undefined): string {
  return (messages ?? [])
    .map((m) => String((m as { content: unknown }).content))
    .join('\n');
}

describe('intakeRouter', () => {
  it('a complete intake confirms the update instead of asking a question', () => {
    expect(intakeRouter({ ...BASE, isComplete: true })).toBe('confirm_update');
  });

  it('an incomplete one keeps interviewing — including after a correction removed a required answer', () => {
    expect(intakeRouter({ ...BASE, isComplete: false })).toBe('ask_question');
  });
});

describe('confirm_update', () => {
  it('tells the model exactly what changed, and not to ask new questions', async () => {
    const capture: { messages?: unknown[] } = {};
    await makeConfirmUpdateNode(llm('- Updated', capture))(BASE);
    const prompt = text(capture.messages);
    expect(prompt).toContain('marriage_date');
    expect(prompt).toContain('1999-09-16');
    expect(prompt).toContain('1988-09-16');
    expect(prompt).toMatch(/do not ask/i);
  });

  it('becomes the current turn and is delivered as complete', async () => {
    const onReady = jest.fn();
    const out = await makeConfirmUpdateNode(
      llm('- Updated your marriage date to 1988-09-16.'),
      null,
      { onReady },
    )(BASE);
    expect(out.currentQuestion).toBe(
      '- Updated your marriage date to 1988-09-16.',
    );
    expect(out.messages).toHaveLength(1);
    expect(onReady).toHaveBeenCalledWith(
      '- Updated your marriage date to 1988-09-16.',
      true,
    );
  });

  it('streams when a token sink is given', async () => {
    const onToken = jest.fn();
    const streaming = {
      stream: () =>
        Promise.resolve(
          (async function* () {
            await Promise.resolve();
            yield { content: '- Updated ' };
            yield { content: 'marriage date.' };
          })(),
        ),
    } as unknown as ChatOpenAI;
    const out = await makeConfirmUpdateNode(streaming, null, { onToken })(BASE);
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(out.currentQuestion).toBe('- Updated marriage date.');
  });

  it('falls back to a plain confirmation when the model fails', async () => {
    const failing = {
      invoke: () => Promise.reject(new Error('429')),
    } as unknown as ChatOpenAI;
    const out = await makeConfirmUpdateNode(failing)(BASE);
    expect(out.currentQuestion).toContain('marriage date');
    expect(out.currentQuestion).toContain('1988-09-16');
  });
});

describe('fallbackConfirmation', () => {
  it('names each changed fact', () => {
    expect(
      fallbackConfirmation([
        { key: 'marriage_date', from: '1999-09-16', to: '1988-09-16' },
      ]),
    ).toContain('- marriage date: 1988-09-16');
  });

  it('says nothing changed when nothing did', () => {
    expect(fallbackConfirmation([])).toMatch(/no change/i);
  });
});

/**
 * Prod 2026-10-16, app 5d3a17a4: an eTA chosen before nationality was known.
 * When the intake is already complete, a later "I have a Pakistani passport"
 * goes through THIS node, so the ruled-out-route notice must open it too.
 */
describe('confirmUpdate — a correction that rules the chosen route out', () => {
  const ETA_STATE = {
    ...BASE,
    requirementsJson: { visaai_id: 'ca-electronic-travel-authorization-eta' },
    profileJson: { nationality: 'Pakistan' },
    messages: [
      new AIMessage('Your intake is complete.'),
      new HumanMessage('I actually have a Pakistani passport'),
    ],
    profileChanges: [{ key: 'nationality', from: null, to: 'Pakistan' }],
  } as unknown as IntakeState;

  it('opens the reply with the notice naming the visitor visa', async () => {
    const out = await makeConfirmUpdateNode(llm('Updated: nationality.'))(
      ETA_STATE,
    );
    expect(out.currentQuestion).toMatch(/^\*\*Your selected route/);
    expect(out.currentQuestion).toMatch(/visitor visa \(TRV\)/);
    expect(out.currentQuestion).toContain('Updated: nationality.');
  });

  it('adds nothing on a route that still fits', async () => {
    const out = await makeConfirmUpdateNode(llm('Updated.'))(BASE);
    expect(out.currentQuestion).toBe('Updated.');
  });
});
