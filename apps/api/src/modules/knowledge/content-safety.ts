/**
 * Retrieved government content is UNTRUSTED INPUT.
 *
 * That sentence looks wrong until you write down the actual trust chain. We
 * trust the *authority* to state the immigration rule. We do not, and cannot,
 * trust the *bytes on the page*, because between the authority and us there is
 * a CMS, a translation vendor, a PDF pipeline, a CDN, a comment field on a
 * consulate microsite, and — for a page under active edit — an intern.
 *
 * Concretely, a government page can contain text that reads as instructions:
 *
 *   - a genuine mistake: an internal editorial note left in the HTML
 *     ("NOTE TO EDITOR: ignore the previous paragraph, it is out of date")
 *   - user-generated content on an official domain: a forum, a comment, a
 *     "questions" section on a consulate site
 *   - a deliberate injection on a compromised or user-writable official page
 *
 * Any of those, quoted verbatim into a prompt that also carries the system
 * instructions, is a prompt injection. The consequence here is worse than
 * usual: the output is immigration guidance a person will act on.
 *
 * TWO CONTROLS, doing different jobs:
 *
 *   1. `asUntrustedData` (shared/ai/untrusted.ts) fences the content so the
 *      model is told it is data. Already in the codebase; reused, not
 *      reimplemented.
 *   2. This module SCORES and REDACTS before the fence, because fencing alone
 *      is not a proof and a page whose text is 40% imperative instructions
 *      aimed at an assistant is not a page we should be quoting at all — it is
 *      a quarantine event.
 *
 * It also strips the secrets a badly-configured government page occasionally
 * leaks into its own HTML, so they can never reach a log, a prompt, or an
 * embedding.
 */

export interface InjectionFinding {
  pattern: string;
  /** Character offset into the scanned text. */
  offset: number;
  /** The matched span, capped, for the quarantine record. */
  excerpt: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SafetyReport {
  findings: InjectionFinding[];
  /** 0 = clean. Sum of severity weights, normalised per 1,000 characters. */
  score: number;
  /**
   * True when the content must not be indexed. Deliberately conservative: a
   * single high-severity hit is enough, because the cost of quarantining a
   * good page is an admin ticket and the cost of indexing a poisoned one is
   * wrong immigration advice.
   */
  quarantine: boolean;
}

const SEVERITY_WEIGHT = { low: 1, medium: 4, high: 12 } as const;

/**
 * Patterns that indicate text ADDRESSING an assistant rather than describing a
 * visa rule.
 *
 * These are matched against extracted text, not HTML, so they are not defeated
 * by markup — but they are also, unavoidably, heuristics. They are tuned to
 * fire on the imperative-to-an-AI register, which does not occur in
 * legislative or procedural prose. "You must ignore previous convictions when
 * calculating..." is legitimate immigration text and must NOT match; "ignore
 * previous instructions" must.
 */
const INJECTION_PATTERNS: Array<{
  re: RegExp;
  name: string;
  severity: InjectionFinding['severity'];
}> = [
  {
    name: 'ignore-instructions',
    severity: 'high',
    re: /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|preceding|system)\s+(instruction|instructions|prompt|prompts|rule|rules|direction|directions|message|messages)\b/gi,
  },
  {
    name: 'role-reassignment',
    severity: 'high',
    re: /\byou\s+are\s+(now|no\s+longer)\s+(an?\s+)?[a-z ]{0,30}(assistant|ai|model|bot|agent)\b/gi,
  },
  {
    name: 'system-prompt-probe',
    severity: 'high',
    re: /\b(reveal|print|repeat|output|show|disclose|dump)\s+(your|the)\s+(system\s+)?(prompt|instructions|rules|configuration|context)\b/gi,
  },
  {
    name: 'fence-escape',
    severity: 'high',
    re: /(<<<\s*UNTRUSTED_DATA|END_UNTRUSTED_DATA\s*>>>|<\|im_start\|>|<\|im_end\|>|\[\/?INST\])/g,
  },
  {
    name: 'guarantee-claim',
    severity: 'high',
    // The platform's compliance stance is that it never guarantees an outcome.
    // Text that instructs an assistant to do so is an injection whether it is
    // malicious or a badly-written marketing line on a consulate page.
    re: /\b(tell|inform|assure|reassure)\s+(the\s+)?(user|applicant|customer)s?\s+that\s+[^.\n]{0,60}\b(guaranteed?|certain|approved|will\s+be\s+approved)\b/gi,
  },
  {
    name: 'tool-invocation',
    severity: 'medium',
    re: /\b(call|invoke|execute|run)\s+(the\s+)?(function|tool|api|command|shell)\b[^.\n]{0,40}/gi,
  },
  {
    name: 'developer-note',
    severity: 'medium',
    // No trailing \b: `todo:` ends on a colon, and a word boundary after a
    // non-word character never matches, so anchoring both ends would make the
    // two most common markers unmatchable.
    re: /\b(note\s+to\s+(editor|self|developer|ai)\b|todo\s*:|fixme\s*:|do\s+not\s+publish\b)/gi,
  },
  {
    name: 'assistant-address',
    severity: 'medium',
    re: /\b(as\s+an?\s+(ai|language\s+model|assistant)|dear\s+(ai|assistant|chatbot|model))\b/gi,
  },
  {
    name: 'jailbreak-persona',
    severity: 'medium',
    re: /\b(dan\s+mode|developer\s+mode|jailbreak|unrestricted\s+mode|no\s+restrictions?\s+apply)\b/gi,
  },
  {
    name: 'exfiltration-url',
    severity: 'medium',
    // A page telling a reader to POST data somewhere is either an injection or
    // a phishing block that got onto an official domain. Both need a human.
    re: /\b(send|post|upload|forward)\s+(your\s+)?(api\s*key|token|password|credentials|passport\s+number)\b/gi,
  },
  {
    name: 'hidden-directive',
    severity: 'low',
    re: /\b(do\s+not\s+(tell|mention|show)\s+(the\s+)?(user|applicant))\b/gi,
  },
];

/** Cap on how much of a match is copied into a quarantine record. */
const EXCERPT_CAP = 200;

export function scanForInjection(
  text: string,
  opts?: { quarantineScore?: number },
): SafetyReport {
  const findings: InjectionFinding[] = [];
  for (const { re, name, severity } of INJECTION_PATTERNS) {
    // Each RegExp is module-scoped and /g, so lastIndex must be reset or a
    // second call silently starts mid-string and misses the first match.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        pattern: name,
        offset: m.index,
        excerpt: m[0].slice(0, EXCERPT_CAP),
        severity,
      });
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width loops
      if (findings.length > 200) break; // a page this dirty is decided already
    }
  }

  const weight = findings.reduce(
    (sum, f) => sum + SEVERITY_WEIGHT[f.severity],
    0,
  );
  const per1k = text.length > 0 ? (weight * 1000) / text.length : 0;
  const threshold = opts?.quarantineScore ?? 2;

  // TWO WAYS TO QUARANTINE, and the second needs both conditions.
  //
  // A single high-severity hit is decisive on its own: "ignore all previous
  // instructions" has no innocent reading on a government page.
  //
  // Medium and low findings are heuristics with real false positives — an
  // editorial "TODO:" left in a fee page is a CMS mistake, not an attack, and
  // dropping that page removes the fee from the corpus. So they quarantine
  // only when there are SEVERAL of them AND they are dense. One medium finding
  // can never quarantine a page, however short the page is; that was the
  // earlier behaviour and it would have taken out any page under 8 kB with a
  // stray editorial marker.
  const suspicious = findings.filter((f) => f.severity !== 'low').length;

  return {
    findings,
    score: Number(per1k.toFixed(4)),
    quarantine:
      findings.some((f) => f.severity === 'high') ||
      (suspicious >= 3 && per1k >= threshold),
  };
}

/**
 * Secrets that must never leave this process in a log, a prompt or an
 * embedding. Ordered longest-prefix-first so a specific pattern wins over the
 * generic high-entropy one.
 */
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { label: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { label: 'stripe-key', re: /\b[sr]k_(live|test)_[0-9A-Za-z]{16,}\b/g },
  { label: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  {
    label: 'private-key-block',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    label: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    label: 'bearer-header',
    re: /\b[Aa]uthorization\s*:\s*Bearer\s+[A-Za-z0-9._-]{20,}/g,
  },
  { label: 'postgres-url', re: /\bpostgres(?:ql)?:\/\/[^\s"'<>]{10,}/g },
];

export interface RedactionResult {
  text: string;
  /** Labels of what was found, for the ingestion log. Never the values. */
  redacted: string[];
}

/**
 * Replace anything that looks like a credential with a labelled placeholder.
 *
 * Runs BEFORE hashing and BEFORE storage, not just before logging: a secret in
 * a stored extraction is a secret in a backup, in an embedding-provider
 * request, and in every admin screen that renders the text.
 */
export function redactSecrets(text: string): RedactionResult {
  let out = text;
  const found: string[] = [];
  for (const { re, label } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(out)) {
      found.push(label);
      re.lastIndex = 0;
      out = out.replace(re, `[REDACTED:${label}]`);
    }
  }
  return { text: out, redacted: found };
}

/**
 * Strip active content from an HTML document before any extraction runs.
 *
 * Belt and braces with the HTML extractor's own tag stripping: script and
 * style bodies are removed here so that even a bug in the extractor cannot let
 * a `<script>` body reach the text, and so hidden `display:none` instruction
 * blocks — the classic "invisible to the reader, visible to the model"
 * injection — are gone before anything reads them.
 */
export function stripActiveContent(html: string): string {
  return (
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ')
      .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, ' ')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, ' ')
      .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, ' ')
      .replace(/<embed\b[^>]*>/gi, ' ')
      // Comments can hold editorial notes that read as instructions.
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Elements hidden from a human reader but not from a text extractor.
      .replace(
        /<[^>]*\bstyle\s*=\s*"[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\/[a-z0-9]+\s*>/gi,
        ' ',
      )
      .replace(/<[^>]*\bhidden\b[^>]*>[\s\S]*?<\/[a-z0-9]+\s*>/gi, ' ')
      .replace(
        /<[^>]*\baria-hidden\s*=\s*"true"[^>]*>[\s\S]*?<\/[a-z0-9]+\s*>/gi,
        ' ',
      )
  );
}
