/**
 * Keeps the intake assistant on the only subject it is qualified for.
 *
 * WHY A DETERMINISTIC GATE AND NOT JUST A PROMPT RULE
 *
 * The system prompt now forbids off-topic answers, but a prompt is a request,
 * not a control: it can be argued with, and it costs a full LLM round-trip to
 * refuse. This gate runs BEFORE the graph, so a "write me a Python script"
 * turn never reaches the model at all — no token spend, no chance of a
 * jailbreak succeeding, no off-topic text persisted into intake_messages where
 * it would then be replayed as conversation history on every later turn.
 *
 * WHY IT IS DELIBERATELY NARROW
 *
 * The cost of the two errors is wildly asymmetric. Wrongly refusing a real
 * applicant blocks them from the product's core flow — the intake interview is
 * how an application gets built — while wrongly answering one off-topic
 * question costs almost nothing. So this only fires on requests that are
 * UNAMBIGUOUSLY a different task (write code, do my homework, tell a joke,
 * generate a recipe) and never on subject matter alone: "I was refused a visa
 * because of a criminal charge" and "my medical exam" are visa questions that
 * a keyword blocklist would happily reject. Everything it does not recognise
 * goes to the model, which has the conversation context to judge better than a
 * regex can.
 */

/**
 * Requests to perform a different TASK. Anchored on the imperative so that
 * "can you write my cover letter" (a real intake need — the narrative stage
 * drafts exactly that) does not collide with "write a poem".
 */
const OFF_TASK_PATTERNS: RegExp[] = [
  // Software work
  /\b(write|generate|debug|refactor|fix|explain)\b[^.?!]{0,40}\b(code|script|function|program|regex|sql query|html|css|javascript|typescript|python|java|c\+\+)\b/i,
  /\b(python|javascript|typescript|java|c\+\+|sql|html|css)\s+(code|script|program|snippet|function)\b/i,
  // Schoolwork and generic content generation
  /\b(do|solve|answer)\b[^.?!]{0,30}\b(my|this)\b[^.?!]{0,20}\b(homework|assignment|exam|quiz|test paper|maths?|math problem)\b/i,
  /\b(write|compose|generate)\b[^.?!]{0,30}\b(poem|song|lyrics|joke|story|novel|essay|blog post|tweet|caption)\b/i,
  /\b(recipe|cook|bake)\b[^.?!]{0,30}\b(for|me)\b/i,
  // Advice this product must not give
  /\b(stock|crypto|bitcoin|forex|investment)\b[^.?!]{0,30}\b(advice|tip|recommend|should i buy|price prediction)\b/i,
  /\b(diagnose|prescribe|treat)\b[^.?!]{0,30}\b(my|this)\b[^.?!]{0,20}\b(symptom|illness|disease|condition|pain)\b/i,
  // Trivia / general knowledge with no immigration hook
  /\b(who (won|is the president|is the ceo)|what('s| is) the (weather|score|capital of)|tell me a joke)\b/i,
  // Attempts to repurpose the assistant
  /\b(ignore|disregard|forget)\b[^.?!]{0,30}\b(previous|prior|above|earlier|your)\b[^.?!]{0,20}\b(instruction|prompt|rule|role)s?\b/i,
  /\b(you are|act as|pretend to be|roleplay as)\b[^.?!]{0,30}\b(a |an )?(?!.*\b(visa|immigration|consultant|officer)\b)(chatbot|assistant|expert|developer|doctor|lawyer|therapist|tutor)\b/i,
];

/**
 * Immigration vocabulary. A message that carries ANY of this is treated as
 * in-scope even when it also matches an off-task pattern above — "can you
 * write the code section of my DS-160" is an application question, not a
 * software request, and the model is better placed to handle it than a regex.
 */
const IN_SCOPE_TERMS =
  /\b(visa|visas|immigration|immigrant|migrate|migration|passport|permit|permanent residen\w*|pr\b|citizenship|naturalis\w+|naturaliz\w+|consulate|embassy|border|customs|deport\w*|asylum|refugee|sponsor\w*|petition|green card|work permit|study permit|student visa|tourist|travel|itinerary|biometric\w*|police (certificate|clearance)|medical exam|refus\w+|reject\w+|overstay|eta\b|evisa|e-visa|ircc|uscis|home office|ukvi|schengen|ds-?160|imm ?\d{3,4}|i-?\d{3}|subclass ?\d{3}|application|applicant|checklist|document\w*|form\w*|interview|appointment|funds|bank statement|employment letter|invitation letter|admission letter|dependent|spouse|parent|child)\b/i;

export interface ScopeVerdict {
  inScope: boolean;
  /** The reply to send when out of scope. Never null when inScope is false. */
  reply?: string;
}

/**
 * The refusal. States what this assistant does, declines once without
 * lecturing, and — critically — hands the turn back to the interview so the
 * applicant is never left at a dead end.
 */
export function outOfScopeReply(currentQuestion: string | null): string {
  const lines = [
    "- I'm the VisaAI intake assistant, so I only work on your visa application — your eligibility, documents, forms, and the strategy for getting approved.",
    '- That one falls outside what I can help with here.',
    '',
    'Next question:',
    currentQuestion?.trim()
      ? stripToQuestion(currentQuestion)
      : 'Shall we carry on with your application — what would you like to cover next?',
  ];
  return lines.join('\n');
}

/**
 * The last question asked, without the summary sections that preceded it.
 * Re-asking the whole multi-section turn would bury the actual question and
 * re-list checklist items the sidebar already shows.
 */
function stripToQuestion(question: string): string {
  const marker = question.lastIndexOf('Next question:');
  const tail =
    marker >= 0 ? question.slice(marker + 'Next question:'.length) : question;
  return tail.trim() || question.trim();
}

export function classifyIntakeMessage(
  text: string,
  currentQuestion: string | null = null,
): ScopeVerdict {
  const message = (text ?? '').trim();
  // An empty or very short turn ("yes", "ok", "35") is almost always an answer
  // to the question just asked. Length alone must never trigger a refusal.
  if (message.length === 0) return { inScope: true };

  if (IN_SCOPE_TERMS.test(message)) return { inScope: true };

  const offTask = OFF_TASK_PATTERNS.some((p) => p.test(message));
  if (!offTask) return { inScope: true };

  return { inScope: false, reply: outOfScopeReply(currentQuestion) };
}
