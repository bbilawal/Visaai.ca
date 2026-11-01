/**
 * Best-effort scrubber for strings written to server logs. Removes things that
 * look like passport/document numbers, email addresses, long digit runs (DOBs,
 * SSNs, account numbers), and JWTs so OCR'd PII doesn't end up in CloudWatch /
 * Railway logs.
 *
 * Not a substitute for not-logging-PII-in-the-first-place — it's a guardrail.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Email
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[redacted-email]'],
  // JWT (three base64url segments)
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]'],
  // Passport numbers and other ID strings (letter+digits, 6-12 chars)
  [/\b[A-Z]{1,2}[0-9]{6,10}\b/g, '[redacted-id]'],
  // Long digit runs (DOB ISO, SSN-like, bank account)
  [/\b\d{4}-\d{2}-\d{2}\b/g, '[redacted-date]'],
  [/\b\d{9,}\b/g, '[redacted-number]'],
];

export function redact(input: unknown): string {
  let s: string;
  if (typeof input === 'string') s = input;
  else if (input instanceof Error) s = input.message;
  else {
    try {
      s = JSON.stringify(input);
    } catch {
      s = String(input);
    }
  }
  for (const [pattern, replacement] of PATTERNS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

export const safeLog = {
  error(scope: string, message: string, err?: unknown) {
    if (err !== undefined) {
      console.error(`[${scope}] ${redact(message)}`, redact(err));
    } else {
      console.error(`[${scope}] ${redact(message)}`);
    }
  },
  warn(scope: string, message: string) {
    console.warn(`[${scope}] ${redact(message)}`);
  },
};
