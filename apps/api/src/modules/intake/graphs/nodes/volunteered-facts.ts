import { intakeFactSpecs, readIntakeFact } from '@visaai/types';
import type { IntakeState } from '../intake.state';
import { routeVisaaiId } from './check-complete';

/**
 * The applicant's own phone number and its type, recorded when the extractor
 * dropped them from an answer to the applicant's own contact question.
 *
 * Live 2026-10-29 (TRV, app 945eb7f1): "<email>, phone +92 311 4446900
 * (mobile)." to the email question recorded only the email; the applicant was
 * then asked to confirm the number and whether it is a cell, home or other
 * number.
 *
 * Deliberately narrow. Gap-fill only (never overrides the extractor or the
 * profile), only on the applicant's own contact question, never when the
 * answer mentions another person or a business. Declarations (health,
 * criminality, …) are never inferred here: they are recorded by the extractor
 * from an explicit answer, or asked.
 */
export function withVolunteeredFacts(
  state: Pick<
    IntakeState,
    'destinationCountry' | 'requirementsJson' | 'profileJson' | 'currentQuestion'
  >,
  extracted: Record<string, unknown>,
  answer: string,
): Record<string, unknown> {
  const specs = intakeFactSpecs({
    country: state.destinationCountry,
    visaaiId: routeVisaaiId(state),
  });
  const phoneSpec = specs.find((s) => s.key === 'phone_number');
  const typeSpec = specs.find((s) => s.key === 'phone_type');
  if (!phoneSpec || !typeSpec) return extracted;

  const question = state.currentQuestion ?? '';
  if (!OWN_CONTACT_QUESTION.test(question) || OTHER_PARTY.test(question)) return extracted;
  if (OTHER_PARTY.test(answer) || OTHER_POSSESSIVE.test(answer)) return extracted;

  const numbers = phoneNumbers(answer);
  if (numbers.length === 0) return extracted;

  const profile = state.profileJson ?? {};
  const out = { ...extracted };
  const extractedPhone = readIntakeFact(extracted, phoneSpec);

  let ours: PhoneMatch | undefined;
  if (extractedPhone !== undefined) {
    // The extractor chose the number: a type word counts only for that number.
    ours = numbers.find((n) => digits(n.text) === digits(String(extractedPhone)));
  } else if (readIntakeFact(profile, phoneSpec) === undefined) {
    ours =
      numbers.length === 1
        ? numbers[0]
        : numbers.find((n) => /\b(my|i|me)\b/i.test(n.before));
    if (ours && (numbers.length === 1 || /\b(my|i|me)\b/i.test(ours.before))) {
      out.phone_number = ours.text;
    } else {
      ours = undefined;
    }
  }
  if (!ours) return out;

  if (readIntakeFact({ ...profile, ...out }, typeSpec) === undefined) {
    const type = phoneType(ours.before) ?? phoneType(ours.after);
    if (type) out.phone_type = type;
  }
  return out;
}

/** The applicant's own contact question (email, phone, how to contact them). */
const OWN_CONTACT_QUESTION = /\b(e-?mail|phone|telephone|contact you|reach you)\b/i;

/** Another person or a business: their number is never the applicant's. */
const OTHER_PARTY =
  /\b(host|inviter|representative|consultant|agent|lawyer|sponsor|employer|company|hotel|emergency|spouse|wife|husband|partner|colleague|son|daughter|grandson|granddaughter|grandchild|child|brother|sister|father|mother|parent|friend|uncle|aunt|cousin|relative|nephew|niece)s?\b/i;

/** "Ali's", "the bank's" — a possessive that is not the applicant's. */
const OTHER_POSSESSIVE = /\b(?!(?:it|that|what|here|there|he|she|who)'s\b)[a-z]+'s\b/i;

interface PhoneMatch {
  text: string;
  /** From the previous number (or clause start) up to this number. */
  before: string;
  /** From this number up to the next number (or clause end). */
  after: string;
}

const PHONE = /\+\d[\d\s().-]{6,}\d/g;
/** A sentence end: ";", a newline, or a full stop followed by a space or the end. */
const CLAUSE_END = /[;\n]|\.(?=\s|$)/;

function phoneNumbers(answer: string): PhoneMatch[] {
  const found = [...answer.matchAll(PHONE)];
  return found.map((m, i) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const prevEnd = i > 0 ? (found[i - 1].index ?? 0) + found[i - 1][0].length : 0;
    let before = answer.slice(prevEnd, start);
    const lastStop = lastClauseEnd(before);
    if (lastStop >= 0) before = before.slice(lastStop + 1);
    const nextStart = i + 1 < found.length ? (found[i + 1].index ?? answer.length) : answer.length;
    let after = answer.slice(end, nextStart);
    const stop = after.search(CLAUSE_END);
    if (stop >= 0) after = after.slice(0, stop);
    return { text: m[0].trim(), before, after };
  });
}

function lastClauseEnd(text: string): number {
  let last = -1;
  for (const m of text.matchAll(/[;\n]|\.(?=\s|$)/g)) last = m.index ?? last;
  return last;
}

const digits = (s: string) => s.replace(/\D/g, '');

function phoneType(text: string): string | undefined {
  if (/\b(mobile|cell|cellular|cellphone)\b/i.test(text)) return 'cell';
  if (/\b(home|landline|residence)\b/i.test(text)) return 'home';
  if (/\b(work|office|business)\b/i.test(text)) return 'other';
  return undefined;
}
