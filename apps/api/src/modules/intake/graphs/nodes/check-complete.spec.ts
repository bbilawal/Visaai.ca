import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { checkComplete } from './check-complete';
import type { IntakeState } from '../intake.state';

function state(over: Partial<IntakeState>): IntakeState {
  return {
    applicationId: 'app-1',
    frameworkId: null,
    visaTypeId: null,
    destinationCountry: 'CA',
    destinationState: null,
    requirementsJson: {},
    profileJson: {},
    riskIndicators: [],
    checklistItems: [],
    suggestedVisaTypes: [],
    messages: [],
    isComplete: false,
    currentQuestion: null,
    checklistBuiltAt: null,
    ...over,
  };
}

const TRV_ROUTE = {
  visaTypeId: 'vt-trv',
  requirementsJson: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
};

const ALL_TRV_ANSWERS = {
  purpose_of_visit: 'family visit',
  employed: false,
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
  passport_type: 'Regular',
  us_permanent_resident: false,
  has_valid_us_visa: false,
  previously_visited_canada: false,
  uses_representative: false,
};

describe('checkComplete', () => {
  it('a registry route with two answers is NOT complete (#2: dropdown-chosen route)', async () => {
    const r = await checkComplete(
      state({
        ...TRV_ROUTE,
        profileJson: { purpose_of_visit: 'family visit', employed: false },
        messages: [
          new AIMessage('q1'),
          new HumanMessage('a1'),
          new AIMessage('q2'),
          new HumanMessage('a2'),
        ],
      }),
    );
    expect(r.isComplete).toBe(false);
  });

  it('a registry route is complete once every required answer is on file', async () => {
    const r = await checkComplete(
      state({ ...TRV_ROUTE, profileJson: ALL_TRV_ANSWERS }),
    );
    expect(r.isComplete).toBe(true);
  });

  it('a representative pending details keeps the interview open', async () => {
    const r = await checkComplete(
      state({
        ...TRV_ROUTE,
        profileJson: { ...ALL_TRV_ANSWERS, uses_representative: true },
      }),
    );
    expect(r.isComplete).toBe(false);
  });

  it('asking many questions does not substitute for the answers on a chosen route', async () => {
    const many = Array.from({ length: 30 }, (_, i) => new AIMessage(`q${i}`));
    const r = await checkComplete(
      state({
        ...TRV_ROUTE,
        profileJson: { purpose_of_visit: 'x' },
        messages: many,
      }),
    );
    expect(r.isComplete).toBe(false);
  });

  it('discovery mode (no route) keeps its conversation-length cap', async () => {
    const many = Array.from({ length: 20 }, (_, i) => new AIMessage(`q${i}`));
    expect((await checkComplete(state({ messages: many }))).isComplete).toBe(
      true,
    );
    expect(
      (await checkComplete(state({ messages: many.slice(0, 3) }))).isComplete,
    ).toBe(false);
  });
});
