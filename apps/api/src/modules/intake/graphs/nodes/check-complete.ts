import { isIntakeAnswered } from '@visaai/types';
import type { IntakeState } from '../intake.state';

const DISCOVERY_MAX_QUESTIONS = 20;

/** The registry visa type the route was loaded for, when there is one. */
export function routeVisaaiId(
  state: Pick<IntakeState, 'requirementsJson'>,
): string | null {
  const v = (state.requirementsJson ?? {}).visaai_id;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function checkComplete(
  state: IntakeState,
): Promise<Partial<IntakeState>> {
  const questionCount = state.messages.filter(
    (m) => m.getType() === 'ai',
  ).length;

  // Discovery mode (no route selected yet): only completion path is a hard cap
  // on conversation length — the visa-type recommendation, not the answers, is
  // the goal here.
  //
  // A route is chosen when EITHER a legacy framework or a registry visa type is
  // set. Checking frameworkId alone left every registry application (all of
  // them, in practice) in this branch for the life of the interview.
  const hasRoute = Boolean(state.frameworkId || state.visaTypeId);
  if (!hasRoute) {
    return { isComplete: questionCount >= DISCOVERY_MAX_QUESTIONS };
  }

  // On a chosen route the interview is done when the answers are — not after
  // N questions. A question cap here closed the chat on an applicant whose
  // official-form answers were still missing, and the progress stage (which
  // reads the same list) would then never complete either.
  return {
    isComplete: isIntakeAnswered(state.profileJson, {
      country: state.destinationCountry,
      visaaiId: routeVisaaiId(state),
    }),
  };
}

export function intakeRouter(state: IntakeState): 'ask_question' | '__end__' {
  return state.isComplete ? '__end__' : 'ask_question';
}
