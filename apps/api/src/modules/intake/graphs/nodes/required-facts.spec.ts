import { IRCC_PORTAL_ANSWERS } from '../../../../../test/fixtures/ircc-portal-answers';
import { HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { makeAskQuestionNode } from './ask-question';
import { requiredQuestionsBlock } from './required-facts';
import type { IntakeState } from '../intake.state';

const TRV: IntakeState = {
  applicationId: 'app-1',
  visaTypeId: 'vt-trv',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
  profileJson: { purpose_of_visit: 'family visit', employed: false },
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [new HumanMessage('I am retired')],
  isComplete: false,
  currentQuestion: null,
  checklistBuiltAt: null,
  profileChanges: [],
};

describe('the interviewer is told what the official form still needs (#50)', () => {
  it('lists the unanswered IMM 5257 questions in order', () => {
    const block = requiredQuestionsBlock(TRV);
    expect(block).toMatch(/passport/i);
    expect(block).toMatch(/permanent resident of the United States/);
    expect(block).toMatch(/valid United States visa/);
    expect(block).toMatch(/travelled to Canada before/);
    expect(block).toMatch(/representative/);
    expect(block.indexOf('passport')).toBeLessThan(
      block.indexOf('representative'),
    );
  });

  it('says nothing in discovery mode or when everything is answered', () => {
    expect(requiredQuestionsBlock({ ...TRV, visaTypeId: null })).toBe('');
    expect(
      requiredQuestionsBlock({
        ...TRV,
        profileJson: {
          purpose_of_visit: 'family visit',
          employed: false,
          planned_entry_date: '2027-03-01',
          planned_departure_date: '2027-04-30',
          passport_type: 'Regular',
          us_permanent_resident: false,
          has_valid_us_visa: false,
          previously_visited_canada: false,
          uses_representative: false,
          ...IRCC_PORTAL_ANSWERS,
        },
      }),
    ).toBe('');
  });

  it('asks for the representative details once a representative is used', () => {
    const block = requiredQuestionsBlock({
      ...TRV,
      profileJson: { ...TRV.profileJson, uses_representative: true },
    });
    expect(block).toMatch(/representative's full name/);
    expect(block).toMatch(/paid/);
    expect(block).toMatch(/mailing address/);
  });

  it('reaches the model on a tailored turn', async () => {
    let prompt = '';
    const llm = {
      invoke: (messages: Array<{ content: string }>) => {
        prompt = messages.map((m) => m.content).join('\n');
        return Promise.resolve({ content: 'Next question: ...' });
      },
    } as unknown as ChatOpenAI;
    await makeAskQuestionNode(llm)(TRV);
    expect(prompt).toContain('REQUIRED BY THE OFFICIAL APPLICATION FORM');
    expect(prompt).toMatch(/travelled to Canada before/);
  });
});
