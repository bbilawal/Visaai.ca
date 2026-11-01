/**
 * Voice safety: consent gating, transcript redaction, and prompt-injection
 * defence. Pure functions — no I/O — so every rule is directly testable.
 *
 * These are not optional decorations. A voice session records a person
 * describing their immigration situation out loud: passport numbers, dates of
 * birth, family details, sometimes their status. Getting consent or redaction
 * wrong here is a privacy incident, not a bug.
 */

// ── Consent ──────────────────────────────────────────────────────────────
export type ConsentKind =
  /** Access the device microphone at all. */
  | 'microphone'
  /** Convert speech to text and hold that text for the session. */
  | 'transcription'
  /** Keep the transcript on the case after the session ends. */
  | 'transcript_retention'
  /** Share the transcript with a human consultant. */
  | 'transcript_sharing';

export interface ConsentRecord {
  kind: ConsentKind;
  granted: boolean;
  grantedAt?: string;
  /** Version of the notice the user actually saw. */
  policyVersion: string;
}

/** Consents required before any audio may be processed. */
export const REQUIRED_TO_START: readonly ConsentKind[] = [
  'microphone',
  'transcription',
];

export interface ConsentDecision {
  allowed: boolean;
  missing: ConsentKind[];
}

/**
 * A session may only start with EXPLICIT microphone and transcription consent.
 * Absent is treated as refused — consent is never inferred from silence, and a
 * stale policy version counts as absent because the user agreed to different
 * terms.
 */
export function evaluateStartConsent(
  records: ConsentRecord[],
  currentPolicyVersion: string,
): ConsentDecision {
  const missing = REQUIRED_TO_START.filter((kind) => {
    const record = records.find((r) => r.kind === kind);
    return !record?.granted || record.policyVersion !== currentPolicyVersion;
  });
  return { allowed: missing.length === 0, missing };
}

/** Sharing a transcript with a consultant needs its own, separate consent. */
export function canShareTranscript(
  records: ConsentRecord[],
  currentPolicyVersion: string,
): boolean {
  const record = records.find((r) => r.kind === 'transcript_sharing');
  return (
    Boolean(record?.granted) && record?.policyVersion === currentPolicyVersion
  );
}

// ── PII redaction ────────────────────────────────────────────────────────
/**
 * Redaction applied before a transcript is LOGGED, sent to analytics, or
 * attached to an audit event. It is NOT applied to the transcript the user
 * sees, nor to the text sent to the model — the assistant cannot answer "is my
 * passport still valid?" if the number has been stripped.
 *
 * Ordering matters: the longest, most specific patterns run first so a passport
 * number is not partially eaten by the generic long-digit rule.
 */
const REDACTIONS: { label: string; pattern: RegExp }[] = [
  { label: '[email]', pattern: /[^\s@]+@[^\s@]+\.[^\s@]{2,}/gi },
  // Payment cards: 13–19 digits, optionally grouped.
  { label: '[card]', pattern: /\b(?:\d[ -]?){13,19}\b/g },
  // Passport-shaped: 1–2 letters then 6–9 digits.
  { label: '[passport]', pattern: /\b[A-Z]{1,2}\d{6,9}\b/gi },
  // SIN / SSN with separators.
  {
    label: '[gov-id]',
    pattern: /\b\d{3}[- ]\d{3}[- ]\d{3}\b|\b\d{3}-\d{2}-\d{4}\b/g,
  },
  { label: '[phone]', pattern: /\+?\d[\d\s().-]{7,}\d/g },
  { label: '[dob]', pattern: /\b\d{4}-\d{2}-\d{2}\b/g },
];

export interface RedactionResult {
  text: string;
  /** Labels applied, for the audit trail — never the values removed. */
  redacted: string[];
}

export function redactForLogging(text: string): RedactionResult {
  let output = text;
  const redacted: string[] = [];
  for (const rule of REDACTIONS) {
    if (rule.pattern.test(output)) {
      redacted.push(rule.label);
    }
    // `test` advances lastIndex on a /g regex; reset before replacing.
    rule.pattern.lastIndex = 0;
    output = output.replace(rule.pattern, rule.label);
    rule.pattern.lastIndex = 0;
  }
  return { text: output, redacted };
}

// ── Prompt injection ─────────────────────────────────────────────────────
/**
 * Spoken prompt-injection detection.
 *
 * The threat is real but different from the text case: a user can read an
 * attack aloud, or a third party can speak one within microphone range. We
 * cannot rely on delimiters the way a text UI can, because STT strips
 * formatting entirely.
 *
 * This is a DETECTOR, not a sanitiser. The transcript is never rewritten —
 * silently altering what someone said would be both wrong and confusing. The
 * caller decides: flag it, refuse the turn, or route to human review. Layered
 * with the existing `GuardrailsService`, which classifies intent and filters
 * model output.
 */
const INJECTION_PATTERNS: { id: string; pattern: RegExp }[] = [
  {
    id: 'ignore_instructions',
    pattern:
      /\bignore (all |any |your )?(previous|prior|above) (instructions|prompts?|rules)\b/i,
  },
  {
    id: 'reveal_prompt',
    pattern:
      /\b(what (is|are) your|reveal|repeat|print|show me) (the )?(system )?(prompt|instructions|rules)\b/i,
  },
  {
    id: 'role_override',
    pattern: /\byou are (now|actually) (a|an|no longer)\b/i,
  },
  {
    id: 'developer_mode',
    pattern: /\b(developer|debug|god|jailbreak|dan) mode\b/i,
  },
  {
    id: 'impersonate_official',
    pattern:
      /\b(pretend|act) (to be|as) (a|an) (immigration officer|lawyer|licensed consultant|government)\b/i,
  },
  {
    id: 'exfiltrate_other_user',
    pattern:
      /\b(other|another|someone else'?s) (user|applicant|client)'?s? (data|application|documents?|file)\b/i,
  },
  {
    id: 'disable_safety',
    pattern:
      /\b(disable|turn off|bypass|skip) (your )?(safety|guardrails?|filters?|restrictions?)\b/i,
  },
];

export interface InjectionAssessment {
  suspected: boolean;
  /** Pattern ids that matched — for audit and evaluation, not for the user. */
  signals: string[];
}

export function assessPromptInjection(transcript: string): InjectionAssessment {
  const signals = INJECTION_PATTERNS.filter((p) =>
    p.pattern.test(transcript),
  ).map((p) => p.id);
  return { suspected: signals.length > 0, signals };
}

// ── Advice boundary ──────────────────────────────────────────────────────
/**
 * Questions that cross from general information into regulated immigration
 * advice. Task 10 requires the assistant to distinguish the two and never
 * present itself as a licensed consultant or lawyer.
 *
 * Detection is intentionally broad: over-escalating to a human is a cost,
 * under-escalating on an immigration question is a harm.
 */
const REGULATED_ADVICE_PATTERNS: RegExp[] = [
  /\bshould I (lie|omit|hide|not mention|leave out)\b/i,
  /\bwill I (get|be) (approved|refused|denied|deported|banned)\b/i,
  /\b(guarantee|promise|certain|100%)\b.*\b(approv|visa|status)/i,
  /\b(overstay|out of status|deportation|removal order|inadmissib)/i,
  /\b(asylum|refugee|persecution)\b/i,
  /\bmarry|marriage of convenience|sham marriage\b/i,
  /\b(criminal|conviction|arrest|charges?)\b.*\b(visa|application|admissib)/i,
  /\bwhat should I (say|tell them|answer) (at|in|during) (my )?(interview|border|port of entry)\b/i,
];

export interface AdviceBoundaryAssessment {
  /** True when a licensed human should answer, not the assistant. */
  requiresHuman: boolean;
  matched: number;
}

export function assessAdviceBoundary(
  transcript: string,
): AdviceBoundaryAssessment {
  const matched = REGULATED_ADVICE_PATTERNS.filter((p) =>
    p.test(transcript),
  ).length;
  return { requiresHuman: matched > 0, matched };
}

/**
 * The disclaimer every voice session opens with, and which the assistant
 * repeats when it declines to give regulated advice. Kept here so it cannot
 * drift between the spoken script, the transcript and the UI.
 */
export const VOICE_DISCLAIMER_KEY = 'voice.disclaimer';
export const VOICE_DISCLAIMER_EN =
  'I can explain visa options and help you prepare your application, but I am not a licensed immigration consultant or lawyer and this is not legal advice. For advice about your specific case, I can connect you with a licensed consultant.';
