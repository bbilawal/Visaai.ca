import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { missingIntakeFacts } from '@visaai/types';
import { makeAskQuestionNode } from './ask-question';
import { makeProcessAnswerNode } from './process-answer';
import { withVolunteeredFacts } from './volunteered-facts';
import { answeredQuestionsBlock, requiredQuestionsBlock } from './required-facts';
import type { IntakeState } from '../intake.state';

/**
 * Live 2026-10-29, Canada visitor visa (app 945eb7f1): three answers the
 * applicant had already given were asked again.
 *
 *  1. "Have you ever served in a military, militia, civil defence unit…" → "No,
 *     never." was recorded as military_service: false; two questions later the
 *     interviewer asked "Have you ever served in the military, militia, or
 *     civil defence?" — it saw `military_service: false` in the profile dump but
 *     nothing tied that key to the question it was paraphrasing.
 *  2. "No TB diagnosis, and I have not been in close contact with anyone with
 *     TB in the last five years." recorded only `tuberculosis`; the contact
 *     half was dropped, so tuberculosis_contact was asked again.
 *  3. "<email>, phone +92 311 4446900 (mobile)." to the email question lost the
 *     phone and its type: the applicant was asked to confirm the number and
 *     then whether it is a cell, home or other number.
 */

const TRV: IntakeState = {
  applicationId: 'app-1',
  visaTypeId: 'vt-trv',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
  profileJson: { purpose_of_visit: 'tourism', military_service: false },
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [new HumanMessage('No.')],
  isComplete: false,
  currentQuestion: null,
  checklistBuiltAt: null,
  profileChanges: [],
};

function extractor(reply: Record<string, unknown>, capture: { system?: string } = {}) {
  return {
    invoke: (messages: Array<{ content: string }>) => {
      capture.system = messages[0]?.content ?? '';
      return Promise.resolve({ content: JSON.stringify(reply) });
    },
  } as unknown as ChatOpenAI;
}

function answering(question: string, answer: string, profile: Record<string, unknown> = {}): IntakeState {
  return {
    ...TRV,
    profileJson: { purpose_of_visit: 'tourism', ...profile },
    currentQuestion: `Next question:\n${question}`,
    messages: [new AIMessage(question), new HumanMessage(answer)],
  };
}

describe('1. an answered question is named to the interviewer, so it is not paraphrased and asked again', () => {
  it('lists the military question with its recorded answer', () => {
    const block = answeredQuestionsBlock(TRV);
    expect(block).toMatch(/ALREADY ANSWERED/);
    expect(block).toContain(
      'Have you ever served in a military, militia or civil defence unit, or a security organization or police force? → No',
    );
    expect(block).toContain('→ tourism');
  });

  it('never lists a question that is still unanswered', () => {
    expect(answeredQuestionsBlock(TRV)).not.toMatch(/tuberculosis/i);
  });

  it('says nothing in discovery mode or before anything is answered', () => {
    expect(answeredQuestionsBlock({ ...TRV, visaTypeId: null })).toBe('');
    expect(answeredQuestionsBlock({ ...TRV, profileJson: {} })).toBe('');
  });

  it('is in the interviewer prompt', async () => {
    let prompt = '';
    const llm = {
      invoke: (messages: Array<{ content: string }>) => {
        prompt = messages[1].content;
        return Promise.resolve({ content: 'Next question: ...' });
      },
    } as unknown as ChatOpenAI;
    await makeAskQuestionNode(llm)(TRV);
    expect(prompt).toMatch(/ALREADY ANSWERED/);
    expect(prompt).toMatch(/served in a military, militia or civil defence unit[^\n]*→ No/);
  });
});

describe('1b. a follow-up asking for the details of a Yes is not the same question', () => {
  const refused: IntakeState = {
    ...TRV,
    profileJson: { purpose_of_visit: 'tourism', refused_or_ordered_to_leave: true },
  };

  it('says so in the answered block', () => {
    const block = answeredQuestionsBlock(refused);
    expect(block).toMatch(/refused a visa[^\n]*→ Yes/);
    expect(block).toMatch(/DETAILS of a Yes answer[^\n]*NOT the same question[^\n]*still ask/i);
  });

  it('keeps the details question in the required list and out of the answered one', () => {
    expect(requiredQuestionsBlock(refused)).toMatch(/For each refusal, denied entry or removal/);
    expect(answeredQuestionsBlock(refused)).not.toMatch(/For each refusal/);
  });
});

describe('the interviewer never claims a fact was recorded that is not on the profile', () => {
  it('is told so', async () => {
    let prompt = '';
    const llm = {
      invoke: (messages: Array<{ content: string }>) => {
        prompt = messages[1].content;
        return Promise.resolve({ content: 'Next question: ...' });
      },
    } as unknown as ChatOpenAI;
    await makeAskQuestionNode(llm)(TRV);
    expect(prompt).toMatch(/Never say you recorded[^\n]*unless it appears in the applicant profile/i);
  });
});

describe('2. a declaration answered alongside the one asked is left to the extractor', () => {
  const Q = 'Have you been diagnosed with tuberculosis (TB) during the last two years?';

  it('tells the extractor to record every fact the answer gives, not only the one asked', async () => {
    const capture: { system?: string } = {};
    await makeProcessAnswerNode(extractor({ tuberculosis: false }, capture))(
      answering(Q, 'No.'),
    );
    expect(capture.system).toMatch(/EVERY fact the answer gives/);
    expect(capture.system).toMatch(/tuberculosis_contact/);
  });

  // Medical and legal declarations are never inferred by a heuristic: the
  // contact half is recorded only by the extractor, or asked normally.
  it.each([
    'No TB diagnosis, and I have not been in close contact with anyone with TB in the last five years.',
    "I don't have TB. Not sure about contact.",
    'I was in close contact with my father who had TB and I did not get infected.',
    'Yes I had contact with a TB patient and no symptoms.',
    'no, and no contact with my uncle who has TB?',
  ])('never infers tuberculosis_contact from %p', async (answer) => {
    const state = answering(Q, answer);
    expect(withVolunteeredFacts(state, { tuberculosis: false }, answer)).not.toHaveProperty(
      'tuberculosis_contact',
    );
    const out = await makeProcessAnswerNode(extractor({ tuberculosis: false }))(state);
    expect(out.profileJson).not.toHaveProperty('tuberculosis_contact');
  });

  it("keeps the extractor's own value", async () => {
    const out = await makeProcessAnswerNode(
      extractor({ tuberculosis: false, tuberculosis_contact: false }),
    )(answering(Q, 'No diagnosis and no close contact.'));
    expect(out.profileJson).toMatchObject({ tuberculosis_contact: false });
  });
});

describe('3. the applicant\'s own phone number and its type given with the email are recorded', () => {
  const Q = 'What email address should IRCC use to contact you?';
  const A = 'zee@example.com, phone +92 311 4446900 (mobile).';
  const vol = (q: string, answer: string, extracted: Record<string, unknown> = {}, profile = {}) =>
    withVolunteeredFacts(answering(q, answer, profile), extracted, answer);

  it('records the type the applicant stated next to the number', async () => {
    const out = await makeProcessAnswerNode(
      extractor({ email: 'zee@example.com', phone_number: '+92 311 4446900' }),
    )(answering(Q, A));
    expect(out.profileJson).toMatchObject({ phone_type: 'cell' });
  });

  it('records the number itself when the extractor kept only the email', async () => {
    const out = await makeProcessAnswerNode(extractor({ email: 'zee@example.com' }))(
      answering(Q, A),
    );
    expect(out.profileJson).toMatchObject({
      email: 'zee@example.com',
      phone_number: '+92 311 4446900',
      phone_type: 'cell',
    });
    const missing = missingIntakeFacts(
      { ...TRV.profileJson, ...out.profileJson },
      { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' },
    ).map((s) => s.key);
    expect(missing).not.toContain('phone_number');
    expect(missing).not.toContain('phone_type');
  });

  it('records a number introduced as "my"', () => {
    expect(vol(Q, 'zee@example.com and my cell is +92 311 4446900')).toMatchObject({
      phone_number: '+92 311 4446900',
      phone_type: 'cell',
    });
  });

  it.each([
    [Q, "My consultant's number is +1 416 555 1234"],
    [Q, "zee@example.com. My host's number is +1 416 555 0100 (mobile)."],
    ["What is your host's telephone number?", 'Ali Khan, +1 416 555 1234'],
    ["What is your host's telephone number?", '+1 416 555 0100, mobile'],
    [Q, 'zee@example.com. The hotel number is +1 416 555 1234.'],
    [Q, 'zee@example.com, emergency contact +1 416 555 1234 (mobile)'],
    [Q, 'zee@example.com, my partner +1 416 555 1234'],
    [Q, 'zee@example.com, colleague +1 416 555 1234'],
    [Q, 'zee@example.com, grandson +1 416 555 1234 mobile'],
    ['What is the purpose of your trip?', 'Tourism. +92 311 4446900'],
  ])('never takes someone else\'s number: %p / %p', (q, answer) => {
    const out = vol(q, answer);
    expect(out).not.toHaveProperty('phone_number');
    expect(out).not.toHaveProperty('phone_type');
  });

  it('reads the type of THIS number, not the next one', () => {
    expect(
      vol('What telephone number should IRCC use to contact you?', 'home +1 416 555 1234, mobile +92 300 1234567', {
        phone_number: '+1 416 555 1234',
      }),
    ).toMatchObject({ phone_type: 'home' });
  });

  it('sets no type when the extracted number is not the one the type word belongs to', () => {
    expect(
      vol(Q, 'zee@example.com, phone +92 311 4446900 (mobile)', { phone_number: '+92 300 9999999' }),
    ).not.toHaveProperty('phone_type');
  });

  it('takes no number from an answer with several numbers and no "my"', () => {
    expect(vol(Q, 'home +1 416 555 1234, mobile +92 300 1234567')).not.toHaveProperty('phone_number');
  });

  it('does not overwrite a number or type already recorded', async () => {
    const out = await makeProcessAnswerNode(extractor({ email: 'zee@example.com' }))(
      answering(Q, A, { phone_number: '+92 300 1111111', phone_type: 'home' }),
    );
    expect(out.profileJson).not.toHaveProperty('phone_number');
    expect(out.profileJson).not.toHaveProperty('phone_type');
  });

  it('accepts a type recorded as phone_number_type', () => {
    const missing = missingIntakeFacts(
      { phone_number: '+92 311 4446900', phone_number_type: 'mobile' },
      { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' },
    ).map((s) => s.key);
    expect(missing).not.toContain('phone_type');
  });
});
