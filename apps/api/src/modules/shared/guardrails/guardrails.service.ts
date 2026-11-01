import { Injectable } from '@nestjs/common';

/**
 * Liability guardrails (Strategy Action 16, Support + Brand + Trend agents).
 *
 * VisaAI is a preparation tool, not a licensed immigration consultant. Two
 * deterministic, pre/post-LLM checks enforce that line (defense-in-depth, not
 * prompt-trust):
 *
 *   classifyIntent(userText)  - run BEFORE generating. If the user is asking for
 *                               legal advice / an approval prediction / help to
 *                               misrepresent, bypass generation and escalate.
 *   filterOutput(aiText)      - run AFTER generating. If the model produced an
 *                               approval guarantee or outcome prediction, block
 *                               it and substitute a safe message.
 *
 * Heuristics are intentionally conservative: false positives (an extra escalation
 * to a human/RCIC) are cheap; false negatives (shipping unauthorized advice) are
 * existential.
 */

export type IntentLabel =
  | 'legal_advice'
  | 'approval_prediction'
  | 'misrepresentation'
  | 'safe';

export interface IntentResult {
  label: IntentLabel;
  safe: boolean;
  matched?: string;
}

export interface OutputResult {
  safe: boolean;
  violations: string[];
  /** A compliant replacement to show when `safe` is false. */
  safeFallback: string;
}

const MISREPRESENTATION = [
  /\bhow (do|can) i (hide|fake|forge|fabricate)\b/i,
  /\b(fake|forged|fabricat\w*) (document|bank statement|payslip|letter)\b/i,
  /\blie (on|about|in) (my|the) (application|form|interview)\b/i,
  /\bmake up (a|an|some)\b.*\b(job|income|funds|reason)\b/i,
];

const APPROVAL_PREDICTION = [
  /\bwill i (get|be) (approved|accepted|granted|refused|rejected|denied)\b/i,
  /\b(what are|what're) my chances\b/i,
  /\bchances? of (approval|getting approved|refusal|rejection)\b/i,
  /\bwill (my|the) (visa|application) (be )?(approved|refused|rejected)\b/i,
  /\bdo i qualify\b/i,
  /\bam i (going to|gonna) (get|be) (approved|accepted|refused)\b/i,
];

const LEGAL_ADVICE = [
  /\bshould i (apply|appeal|reapply|withdraw|sue|claim)\b/i,
  /\bwhat (should|do) i (say|write|put|answer) (to|for|in)\b.*\b(officer|interview|portal|question)\b/i,
  /\bis it legal (to|if)\b/i,
  /\b(can|could) i be (deported|banned|barred)\b/i,
  /\bimmigration (lawyer|advice|consultant)\b/i,
];

/**
 * Words that turn a guarantee into its opposite.
 *
 * `\bguarantee(d|s)?\b` matched the word wherever it appeared, so the model
 * saying the correct thing — "a Super Visa does not guarantee entry", "there is
 * no guarantee of approval", "admission is never guaranteed" — tripped the
 * filter and had its ENTIRE reply replaced by the refusal message.
 *
 * Seen live on 2026-09-04 mid-interview: the applicant answered a factual
 * question about travel history and got a legal-advice disclaimer back, losing
 * both the answer and the next question. The disclaimer is what the guard emits;
 * the model had almost certainly written a perfectly compliant caveat.
 *
 * So the guard now blocks a PROMISE of a guarantee and permits a DENIAL of one,
 * which is the distinction it always meant to draw.
 */
const GUARANTEE_NEGATORS =
  /\b(no|not|never|cannot|can'?t|without|isn'?t|aren'?t|doesn'?t|don'?t|won'?t|nothing)\b/i;

/** How far back to look for a negator. One clause, not the whole message. */
const NEGATION_WINDOW = 48;

/**
 * True when "guarantee" is being promised rather than denied.
 *
 * Every occurrence is checked, so "we guarantee approval, though nothing is
 * guaranteed" is still caught by the first one.
 */
export function promisesGuarantee(text: string): boolean {
  const re = /\bguarantee(d|s|ing)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - NEGATION_WINDOW), m.index);
    if (!GUARANTEE_NEGATORS.test(before)) return true;
  }
  return false;
}

const OUTPUT_FORBIDDEN: Array<{ re: RegExp; tag: string }> = [
  { re: /\bguarantee(d|s)?\b/i, tag: 'guarantee' },
  {
    re: /\byou (will|are|'re) (be )?(approved|accepted|granted|getting in)\b/i,
    tag: 'approval-promise',
  },
  {
    re: /\byour (approval )?chances? (are|is|will be)\b/i,
    tag: 'chance-prediction',
  },
  {
    re: /\b(definitely|certainly|surely) (get|be) (approved|accepted)\b/i,
    tag: 'certainty',
  },
  {
    re: /\bwe('ll| will)? get you (approved|in|a visa)\b/i,
    tag: 'we-get-you-in',
  },
  {
    // Any percentage attached to odds language, not only the
    // "N% chance of approval" word order. "95% likely to be approved" is the
    // same claim and was previously unmatched.
    re: /\b\d{1,3}\s?%\s*(chance|likelihood|likely|probability|odds|certain|sure)\b/i,
    tag: 'percent-odds',
  },
  {
    re: /\b(low|high|good|strong|excellent|poor|slim) (chance|odds|likelihood|probability) of\b/i,
    tag: 'odds-language',
  },
  {
    // Hedged predictions read as safer than they are: a consultant forwarding
    // "you are likely to be approved" has still predicted a decision.
    re: /\b(un)?likely to (be |get )?(approved|accepted|granted|refused|rejected|denied)\b/i,
    tag: 'likelihood-prediction',
  },
  {
    re: /\byour (application|visa|case|petition) (should|will|is going to|is likely to) (be )?(approved|accepted|granted|refused|rejected|denied|succeed|fail)\b/i,
    tag: 'outcome-prediction',
  },
  {
    re: /\b(expect|anticipate|count on) (an? )?(approval|acceptance|refusal|rejection|denial)\b/i,
    tag: 'outcome-prediction',
  },
];

export const SAFE_FALLBACK =
  'I can not predict visa decisions or give legal advice. I can help you prepare a complete, ' +
  'consistent application and flag common issues. For advice about your specific case, I can ' +
  'connect you with a licensed immigration consultant (RCIC).';

@Injectable()
export class GuardrailsService {
  /** Pre-generation: classify what the user is really asking for. */
  classifyIntent(userText: string): IntentResult {
    const text = userText ?? '';
    for (const re of MISREPRESENTATION) {
      const m = text.match(re);
      if (m) return { label: 'misrepresentation', safe: false, matched: m[0] };
    }
    for (const re of APPROVAL_PREDICTION) {
      const m = text.match(re);
      if (m)
        return { label: 'approval_prediction', safe: false, matched: m[0] };
    }
    for (const re of LEGAL_ADVICE) {
      const m = text.match(re);
      if (m) return { label: 'legal_advice', safe: false, matched: m[0] };
    }
    return { label: 'safe', safe: true };
  }

  /** Post-generation: ensure the model never promised an outcome. */
  filterOutput(aiText: string): OutputResult {
    const text = aiText ?? '';
    const violations = OUTPUT_FORBIDDEN.filter(({ re, tag }) =>
      // The guarantee rule needs the surrounding clause, not just a word match:
      // denying a guarantee is the compliant thing to say.
      tag === 'guarantee' ? promisesGuarantee(text) : re.test(text),
    ).map(({ tag }) => tag);
    return {
      safe: violations.length === 0,
      violations,
      safeFallback: SAFE_FALLBACK,
    };
  }

  /** Convenience: the compliant message to send when intent is unsafe. */
  get refusalMessage(): string {
    return SAFE_FALLBACK;
  }
}
