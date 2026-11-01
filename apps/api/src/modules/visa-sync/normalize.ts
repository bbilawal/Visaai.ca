import { createHash } from 'node:crypto';

/**
 * Turn a fetched government page into stable, comparable text.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Hashing raw bytes to detect "did this page change" does not work on real
 * government sites. Every nightly run would report a change on pages where
 * nothing about the law moved, because the markup carries:
 *
 *   - CSRF tokens and session nonces, regenerated per request
 *   - build/asset fingerprints (`main.a3f9c1.js`)
 *   - "Page last reviewed" widgets rendered from today's date
 *   - analytics blobs, cache-buster query strings, rotating banner content
 *   - whitespace and attribute-order churn from a CMS redeploy
 *
 * A monitor that cries wolf nightly is a monitor nobody reads, and the one
 * night a real eligibility rule changes it is indistinguishable from the noise.
 *
 * So `visa_source_versions` stores TWO hashes: `raw_sha256` over the bytes as
 * served (forensic — proves what we received), and `normalized_sha256` over
 * the output of this module. Only the normalized hash may raise a change event.
 *
 * WHAT IT DELIBERATELY KEEPS: everything a caseworker would read. Numbers,
 * currency amounts, form identifiers, dates stated as policy, list structure.
 * Stripping too much is the opposite failure — a fee change that normalizes
 * away is a change VisaAI never tells anyone about.
 */

/** Elements whose contents are never policy. Removed with their content. */
const DROP_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'template',
  'head',
];

/**
 * Attribute and text patterns that change per-request without meaning anything.
 * Order matters: these run on the raw HTML before tag stripping, because after
 * stripping there is no attribute left to recognise.
 */
const VOLATILE_PATTERNS: Array<[RegExp, string]> = [
  // CSRF / nonce / session tokens in attributes or inline JSON
  [
    /\b(csrf[-_]?token|authenticity_token|nonce|requestverificationtoken|__requestverificationtoken)\b\s*[=:]\s*["'][^"']*["']/gi,
    '',
  ],
  // Asset fingerprints: main.a3f9c1e2.js, styles.v2.8f1a.css
  [/\.[0-9a-f]{6,}\.(js|css|woff2?|png|jpg|svg)/gi, '.$1'],
  // Cache-buster query strings
  [/([?&])(v|ver|version|_|t|ts|cb|cachebust)=[^"'&\s]*/gi, '$1'],
  // Correlation / trace ids
  [
    /\b(request|trace|correlation|session)[-_]?id\b\s*[=:]\s*["'][^"']*["']/gi,
    '',
  ],
  // Bare UUIDs and long hex blobs that appear in generated markup
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ''],
];

/**
 * Date phrases that describe when the PAGE was rendered or reviewed, not when
 * a rule takes effect. Removing the value but KEEPING the label matters: if the
 * label itself disappears the page structure changed, and that is a real
 * signal worth seeing.
 */
const RENDER_DATE_PATTERNS: RegExp[] = [
  /(date\s+modified|last\s+modified|page\s+last\s+reviewed|last\s+reviewed|last\s+updated|updated\s+on|published\s+on)\s*:?\s*[^\n<]{0,40}/gi,
];

/**
 * Pull page content out of an embedded JSON payload, where a site keeps it.
 *
 * WHY THIS IS NOT A ONE-SITE HACK
 *
 * `immi.homeaffairs.gov.au` renders every visa page client-side: the served
 * HTML is ~1.5-3.5k characters of navigation chrome, and all twelve Australian
 * visa types' actual requirements live in a doubly-HTML-escaped JSON blob in a
 * hidden input. Without this, the monitor fetches those pages, normalizes them
 * to boilerplate, and reports "unchanged" forever — a source that looks
 * monitored while telling us nothing, which is worse than one that visibly
 * fails.
 *
 * The pattern is not unique to Australia. Any government site built on a
 * client-rendered framework parks its content somewhere like this, so the
 * extraction is written against a LIST of known containers rather than one id.
 *
 * WHAT IT EXTRACTS: string leaves only. Keys, numbers and booleans are dropped
 * — a key name is markup by another route, and a JSON reordering would
 * otherwise read as a content change. Strings are emitted one per line, in
 * document order, which is what the line-set diff downstream expects.
 */
const EMBEDDED_CONTENT_FIELDS = [
  // Australian Department of Home Affairs (SharePoint-backed).
  'ctl00_PlaceHolderMain_PageSchemaHiddenField_Input',
  // Next.js and Nuxt, which several authorities are migrating to.
  '__NEXT_DATA__',
  '__NUXT_DATA__',
];

/** Strings shorter than this are identifiers and CSS classes, not prose. */
const MIN_EMBEDDED_STRING = 3;

export function extractEmbeddedJsonText(html: string): string | null {
  for (const id of EMBEDDED_CONTENT_FIELDS) {
    // Two shapes: a hidden input's value attribute, or a script tag's body.
    const attr = new RegExp(
      `id=["']${id}["'][^>]*\\bvalue=["']([\\s\\S]*?)["']\\s*/?>`,
      'i',
    ).exec(html);
    const script = new RegExp(
      `<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</script>`,
      'i',
    ).exec(html);

    const raw = attr?.[1] ?? script?.[1];
    if (!raw) continue;

    // Doubly escaped in the Home Affairs case: the value is HTML-escaped JSON
    // that itself contains HTML-escaped text. Decoding once leaves &quot;
    // inside the JSON and JSON.parse fails.
    let candidate = decodeEntities(raw);
    let parsed: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        parsed = JSON.parse(candidate);
        break;
      } catch {
        candidate = decodeEntities(candidate);
      }
    }
    if (parsed === null) continue;

    const lines: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') {
        const trimmed = node.trim();
        if (trimmed.length >= MIN_EMBEDDED_STRING) lines.push(trimmed);
        return;
      }
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        return Object.values(node as Record<string, unknown>).forEach(walk);
      }
    };
    walk(parsed);

    if (lines.length === 0) continue;
    // Strings frequently carry their own markup; strip it the normal way.
    return lines.join('\n');
  }
  return null;
}

/**
 * The body of an HTML tag, allowing `>` INSIDE quoted attribute values.
 *
 * `<[^>]+>` stops at the first `>` it sees, which is wrong the moment an
 * attribute contains one. Tailwind's arbitrary variants do exactly that —
 * `class="[&>div]:p-3 [&>div]:w-72 lg:flex"` — so the tag match ended inside
 * the attribute and the remainder, `div]:p-3 [&>div]:w-72 lg:flex">`, survived
 * into the normalized text as if it were page content.
 *
 * That is the B-26 failure again in a new place: markup leaking into text that
 * gets published inside quotation marks attributed to a government. It was
 * found on icp.gov.ae while preparing the UAE extraction, and no currently
 * published excerpt contains it — the thirteen live destinations do not use
 * that pattern — so this is a fix ahead of the damage rather than after it.
 *
 * The alternation walks runs of ordinary characters and complete quoted
 * strings, so a `>` is only treated as the tag terminator when it is outside
 * quotes.
 *
 * B-34: THE QUOTES ARE NOT ALWAYS BALANCED.
 *
 * The first version required every quote to close, which is true of markup a
 * validator would accept and false of two live authorities:
 *
 *   en.nia.gov.cn            <a href="https://beian.miit.gov.cn/"" target="_blank">
 *   general-security.gov.lb  <span  New Roman","serif"">
 *
 * Both are an attribute whose own value contains double quotes, so the quoting
 * is invalid and there is no way to pair them up. A balanced-only matcher never
 * reaches that tag's `>`, so the ENTIRE TAG survived into the normalized text —
 * the same failure as B-31, arriving through malformed input rather than
 * through an unusual-but-valid attribute.
 *
 * The fix is to copy what the HTML tokenizer actually does: A QUOTE ONLY OPENS
 * AN ATTRIBUTE VALUE WHEN IT FOLLOWS `=`. Everywhere else it is an ordinary
 * character in an attribute NAME, and the tag still ends at the next `>`.
 *
 * That single rule settles every case here:
 *
 *   <div class="[&>div]:p-3">   the `"` follows `=`, so the `>` inside the
 *                               value is not the terminator     (B-31 holds)
 *   <span  New Roman","serif"">  no `=` at all, so no value opens and the tag
 *                               ends at its own `>`             (B-34 fixed)
 *   <a href="a/"" target="b">   first quote opens and closes, the stray one is
 *                               a name character, `target="b"` opens and closes
 *
 * A first attempt allowed ANY unmatched quote to be ordinary, which looks
 * equivalent and is not: on `<p  0in 8pt">` it let the quoted alternative run
 * forward to the next `"` further down the document and ate the text between.
 * Measured on general-security.gov.lb/en/posts/497 that silently DELETED 5,384
 * characters including three numbered requirement items. Losing text is worse
 * than leaking markup, because nothing downstream can see an absence.
 */
const TAG_BODY = '(?:=\\s*"[^"]*"|=\\s*\'[^\']*\'|[^>])*';

export function stripHtml(html: string): string {
  /**
   * Collapse ALL source whitespace — newlines included — before anything else.
   *
   * Structure must come from the TAGS, not from how the CMS happened to wrap
   * the source. A paragraph written as `You must\n  have a passport` and the
   * same paragraph on one line are the same sentence to a reader; if the raw
   * newline survived into the output it would become a line break, and the
   * line-set diff would report a line removed and two added on a redeploy that
   * changed nothing. Block tags below re-introduce the newlines that mean
   * something.
   */
  let s = html.replace(/\s+/g, ' ');

  for (const [pattern, replacement] of VOLATILE_PATTERNS) {
    s = s.replace(pattern, replacement);
  }

  for (const el of DROP_ELEMENTS) {
    s = s.replace(
      new RegExp(`<${el}\\b${TAG_BODY}>[\\s\\S]*?</${el}>`, 'gi'),
      ' ',
    );
    // Self-closing / unclosed variants.
    s = s.replace(new RegExp(`<${el}\\b${TAG_BODY}>`, 'gi'), ' ');
  }

  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Block-level tags become newlines so list and heading structure survives as
  // line breaks. Losing it would make an added bullet look like a paragraph
  // reflow, which is precisely the distinction a reviewer needs.
  s = s.replace(
    new RegExp(
      `</?(p|div|section|article|h[1-6]|li|tr|br|ul|ol|table|dl|dt|dd|header|footer|main|nav)\\b${TAG_BODY}>`,
      'gi',
    ),
    '\n',
  );
  s = s.replace(new RegExp(`<${TAG_BODY}>`, 'g'), ' ');

  return s;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&hellip;': '…',
  '&pound;': '£',
  '&euro;': '€',
  '&dollar;': '$',
  '&yen;': '¥',
  '&cent;': '¢',
  '&deg;': '°',
  '&plusmn;': '±',
  '&times;': '×',
  '&divide;': '÷',
  '&frac12;': '½',
  '&sect;': '§',
  '&para;': '¶',
  '&middot;': '·',
  '&bull;': '•',
  '&dagger;': '†',
  '&trade;': '™',
  '&copy;': '©',
  '&reg;': '®',
  '&laquo;': '«',
  '&raquo;': '»',
  '&sbquo;': '‚',
  '&bdquo;': '„',
  '&ensp;': ' ',
  '&emsp;': ' ',
  '&thinsp;': ' ',
  '&shy;': '',
  '&minus;': '−',
  '&lsaquo;': '‹',
  '&rsaquo;': '›',

  /**
   * The Latin-1 letters, because a government page WILL use them and the
   * consequence of missing one is not cosmetic.
   *
   * `&eacute;` was absent, so ImmD's sentence "such relationships do not include
   * de facto spouse, partners in cohabitation, fiancé/fiancée, etc." was stored —
   * and PUBLISHED on three Hong Kong pages — as literal
   * `fianc&eacute;/fianc&eacute;e`. Raw markup, inside quotation marks,
   * attributed to a government.
   *
   * Nothing caught it for the same reason B-25 was not caught: every check
   * compared our text against our own text. `verify-excerpts` re-fetches the
   * page and normalizes it with THIS function, so the excerpt and the page
   * agreed on the broken spelling; the display test compares the display
   * excerpt to the matching one, and both carried it.
   */
  '&agrave;': 'à',
  '&aacute;': 'á',
  '&acirc;': 'â',
  '&atilde;': 'ã',
  '&auml;': 'ä',
  '&aring;': 'å',
  '&aelig;': 'æ',
  '&ccedil;': 'ç',
  '&egrave;': 'è',
  '&eacute;': 'é',
  '&ecirc;': 'ê',
  '&euml;': 'ë',
  '&igrave;': 'ì',
  '&iacute;': 'í',
  '&icirc;': 'î',
  '&iuml;': 'ï',
  '&eth;': 'ð',
  '&ntilde;': 'ñ',
  '&ograve;': 'ò',
  '&oacute;': 'ó',
  '&ocirc;': 'ô',
  '&otilde;': 'õ',
  '&ouml;': 'ö',
  '&oslash;': 'ø',
  '&ugrave;': 'ù',
  '&uacute;': 'ú',
  '&ucirc;': 'û',
  '&uuml;': 'ü',
  '&yacute;': 'ý',
  '&thorn;': 'þ',
  '&yuml;': 'ÿ',
  '&szlig;': 'ß',
  '&Agrave;': 'À',
  '&Aacute;': 'Á',
  '&Acirc;': 'Â',
  '&Atilde;': 'Ã',
  '&Auml;': 'Ä',
  '&Aring;': 'Å',
  '&AElig;': 'Æ',
  '&Ccedil;': 'Ç',
  '&Egrave;': 'È',
  '&Eacute;': 'É',
  '&Ecirc;': 'Ê',
  '&Euml;': 'Ë',
  '&Igrave;': 'Ì',
  '&Iacute;': 'Í',
  '&Icirc;': 'Î',
  '&Iuml;': 'Ï',
  '&ETH;': 'Ð',
  '&Ntilde;': 'Ñ',
  '&Ograve;': 'Ò',
  '&Oacute;': 'Ó',
  '&Ocirc;': 'Ô',
  '&Otilde;': 'Õ',
  '&Ouml;': 'Ö',
  '&Oslash;': 'Ø',
  '&Ugrave;': 'Ù',
  '&Uacute;': 'Ú',
  '&Ucirc;': 'Û',
  '&Uuml;': 'Ü',
  '&Yacute;': 'Ý',
  '&THORN;': 'Þ',
  '&OElig;': 'Œ',
  '&oelig;': 'œ',
  '&Scaron;': 'Š',
  '&scaron;': 'š',
  '&Yuml;': 'Ÿ',
  '&fnof;': 'ƒ',
  '&circ;': 'ˆ',
  '&tilde;': '˜',
};

export function decodeEntities(s: string): string {
  let out = s;
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char);
  }
  return out
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    );
}

/**
 * Does a page that yielded no text do so because its content is rendered by
 * script, rather than because our parser failed?
 *
 * WHY THE DISTINCTION IS WORTH CODE
 *
 * `normalizeContent` returning nothing was recorded as `parse_error` with the
 * message "normalization produced no text", and the comment beside it said a
 * 200 with no extractable text "is a parser problem". For most sources that is
 * right. For `esta.cbp.dhs.gov` it is not: the body is a single `<app-root>`
 * element and three script tags, so there is no text to extract and never was.
 *
 * The cost of conflating them is not cosmetic. That one source filed a
 * parse_error on every run — 34 in a week — and `parse_error` is the bucket
 * that means "this IS a VisaAI bug and belongs in the parser backlog". A signal
 * that is permanently red for a reason nobody can fix is a signal people stop
 * reading, and the eight genuine New Zealand parse failures from B-23 sat in
 * that same bucket.
 *
 * DELIBERATELY CONSERVATIVE
 *
 * It returns true only when the body has no textual content at all AND carries
 * at least one script. Anything ambiguous stays a parse error, because
 * mislabelling our own bug as the site's problem retires a real defect, while
 * the reverse merely leaves a fixable one in the queue. Wrong in the safe
 * direction.
 */
export function looksClientRendered(html: string): boolean {
  if (!/<html[\s>]|<body[\s>]/i.test(html)) return false;

  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const body = bodyMatch ? bodyMatch[1] : html;

  // A script is what would do the rendering. No script, no explanation.
  if (!/<script[\s>]/i.test(body)) return false;

  const withoutCode = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  // Entity references left undecoded would leave letters behind and read as
  // content that is not there — the mistake the raw-quote probe made twice.
  const text = withoutCode
    .replace(/&[a-z]+\d*;|&#\d+;|&#x[0-9a-f]+;/gi, ' ')
    .trim();

  return text.length === 0;
}

/**
 * Everything `normalizeContent` does EXCEPT the final lowercasing.
 *
 * WHY THIS IS SPLIT OUT
 *
 * The normalized text is what the monitor hashes, diffs and matches excerpts
 * against, and lowercasing it is right for all three: a CMS that restyles a
 * heading from `Fees` to `FEES` has not changed the law.
 *
 * But it is wrong for QUOTING. The stored excerpt reads
 * `you must: have a valid travel document` where IRCC wrote
 * `You must: have a valid travel document`, so rendering it inside quotation
 * marks would misquote a government in the one feature meant to prove VisaAI
 * does not (BUG_LOG D-11).
 *
 * Because `.toLowerCase()` is the LAST operation, this function's output and
 * `normalizeContent`'s differ ONLY in case — same length, same characters at
 * the same offsets. That correspondence is what makes
 * `deriveDisplayExcerpt` exact rather than a re-matching heuristic, and
 * `normalizeContent` is defined in terms of this one so the two cannot drift.
 */
export function normalizeContentPreservingCase(
  input: string,
  contentType?: string | null,
): string {
  const looksHtml =
    (contentType ?? '').includes('html') || /<\/?[a-z][\s\S]*>/i.test(input);

  // A client-rendered page's real content is in an embedded payload, and the
  // served markup is chrome. Prefer the payload when one is present, then run
  // it through the same stripping — its strings carry their own markup.
  const embedded = looksHtml ? extractEmbeddedJsonText(input) : null;
  const source = embedded ?? input;

  let s = looksHtml ? stripHtml(source) : source;
  s = decodeEntities(s);

  for (const pattern of RENDER_DATE_PATTERNS) {
    s = s.replace(pattern, (m) => m.split(/[:]/)[0] + ':');
  }

  return (
    s
      .replace(/\r\n?/g, '\n')
      // Collapse runs of spaces/tabs but NOT newlines — structure is signal.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Normalize fetched content to the text a reader would see.
 *
 * Idempotent: normalize(normalize(x)) === normalize(x). The version comparison
 * depends on that — an extractor that produced different output on a second
 * pass would report a change against its own previous run.
 */
export function normalizeContent(
  input: string,
  contentType?: string | null,
): string {
  return normalizeContentPreservingCase(input, contentType).toLowerCase();
}

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** The current extractor version. Bump when normalization changes. */
/**
 * Bumped from v1 on 2026-08-24 when `decodeEntities` gained the Latin-1 letters.
 * Pages containing them now normalize differently, so their hashes change and
 * the monitor will file one change apiece — correct, and the version on each
 * stored version row says why.
 */
/**
 * v3 (2026-08-25): stripHtml now allows `>` inside quoted attribute values
 * (B-31). Bumped because the extractor genuinely changed, not because pages
 * re-hash — check-normalization-drift.ts measured 0 of 25 readable sources
 * changing under the fix, so this costs no review items. The field records
 * which extractor produced a version, and it would be wrong to claim v2 made
 * something v3 made.
 */
/**
 * v4 (2026-08-26): the tag matcher stopped requiring attribute quotes to be
 * BALANCED (B-34). Bumped because normalization genuinely changed, and this
 * time the change RECOVERS text rather than only tidying it: on
 * general-security.gov.lb/en/posts/497 three numbered requirement items —
 * including a 1.5-billion-pound minimum balance — were being swallowed whole
 * and now appear.
 *
 * Measured the way B-31 was, by normalizing the SAME fetched bytes under both
 * versions rather than by counting hash drift. Of 218 registered sources
 * fetched from the VPS: 203 byte-identical, 6 unreadable, and 9 changed.
 *
 *   5 GAIN 17 characters — mom.gov.sg breadcrumbs recover a segment they were
 *     dropping ("home work passes working in singapore" becomes "home work
 *     passes dependant's pass working in singapore").
 *   4 SHED 39 characters — en.nia.gov.cn loses the markup residue
 *     `<a href="https://beian.miit.gov.cn/"">` while keeping the real text
 *     `icp：18064790`.
 *
 * Zero pages lose content. Worth recording how nearly this was measured wrong:
 * the first pass fetched with `curl` and no `--compressed`, so every gzip-
 * serving host was compared as binary and reported a fictitious +3,445-character
 * gain. A drift number is only as good as the bytes under it.
 */
export const EXTRACTOR_VERSION = 'v4';

export type ChangeClassification =
  | 'cosmetic'
  | 'editorial'
  | 'material'
  | 'structural';

export interface ChangeAnalysis {
  classification: ChangeClassification;
  /** Reasons a human must look. Empty = auto-promotable. */
  escalationReasons: string[];
  requiresReview: boolean;
  /** A SAMPLE. Capped so one huge change cannot flood the review queue. */
  addedLines: string[];
  removedLines: string[];
  /**
   * How many lines actually changed, before the cap.
   *
   * Without these, a consumer of `addedLines` cannot tell 50 lines from the
   * first 50 of 426 — and `detectSiteWideChanges` was doing exactly that,
   * asserting "ALL added lines also appeared on other sources" from a sample.
   */
  addedTotal: number;
  removedTotal: number;
  summary: string;
}

/** The cap on how much of a diff is stored for review. */
export const DIFF_SAMPLE_LIMIT = 50;

/**
 * Signals that a diff touched something a person's application depends on.
 * These are deliberately conservative: a false 'material' costs a reviewer two
 * minutes, a false 'cosmetic' ships a stale requirement to every applicant.
 */
const MATERIAL_MARKERS: Array<[RegExp, string]> = [
  [
    /\b(must|required|mandatory|shall|obliged)\b/i,
    'obligation wording changed',
  ],
  [
    /\b(not eligible|ineligible|cannot apply|no longer accept)\b/i,
    'eligibility wording changed',
  ],
  [/\b(fee|charge|cost|price)\b/i, 'fee wording changed'],
  [/[£$€]\s?\d/, 'a monetary amount changed'],
  [
    /\b\d+\s?(days?|weeks?|months?|years?)\b/i,
    'a duration or deadline changed',
  ],
  [/\b(imm|ds|vaf|i)[\s-]?\d{2,4}\b/i, 'an official form identifier changed'],
  [
    /\b(biometric|medical|police certificate|police check|interview)\b/i,
    'a procedural requirement changed',
  ],
  [
    /\b(passport|insurance|sponsor|funds|financial)\b/i,
    'a document requirement changed',
  ],
  [
    /\b(closed|discontinued|withdrawn|suspended|replaced by)\b/i,
    'a route may have been discontinued',
  ],
];

function lines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Classify the difference between two normalized versions.
 *
 * Line-set difference rather than a character diff: government pages are
 * paragraph-and-bullet documents, and a reviewer needs "this bullet appeared"
 * rather than a run of character offsets.
 */
export function classifyChange(
  previousNormalized: string,
  nextNormalized: string,
): ChangeAnalysis {
  if (previousNormalized === nextNormalized) {
    return {
      classification: 'cosmetic',
      escalationReasons: [],
      requiresReview: false,
      addedLines: [],
      removedLines: [],
      addedTotal: 0,
      removedTotal: 0,
      summary: 'No change after normalization.',
    };
  }

  const prev = new Set(lines(previousNormalized));
  const next = new Set(lines(nextNormalized));
  const added = [...next].filter((l) => !prev.has(l));
  const removed = [...prev].filter((l) => !next.has(l));

  // Identical line sets in a different order: a layout reflow, not new text.
  if (added.length === 0 && removed.length === 0) {
    return {
      classification: 'cosmetic',
      escalationReasons: [],
      requiresReview: false,
      addedLines: [],
      removedLines: [],
      addedTotal: 0,
      removedTotal: 0,
      summary: 'Content reordered; no lines added or removed.',
    };
  }

  const reasons = new Set<string>();
  for (const line of [...added, ...removed]) {
    for (const [pattern, reason] of MATERIAL_MARKERS) {
      if (pattern.test(line)) reasons.add(reason);
    }
  }

  // A large removal is structural regardless of wording: it usually means the
  // page was restructured or the fetch got a partial render, and either way a
  // human should look before requirements are re-derived from it.
  const structural =
    removed.length > 0 && removed.length >= Math.max(10, prev.size * 0.4);

  let classification: ChangeClassification;
  if (structural) classification = 'structural';
  else if (reasons.size > 0) classification = 'material';
  else classification = 'editorial';

  if (structural) {
    reasons.add(
      `${removed.length} of ${prev.size} lines disappeared — the page may have been restructured or fetched incompletely`,
    );
  }

  return {
    classification,
    escalationReasons: [...reasons],
    // Editorial changes auto-promote. Anything that touched an obligation, a
    // number, a form or the page's structure waits for a person.
    requiresReview:
      classification === 'material' || classification === 'structural',
    addedLines: added.slice(0, DIFF_SAMPLE_LIMIT),
    removedLines: removed.slice(0, DIFF_SAMPLE_LIMIT),
    addedTotal: added.length,
    removedTotal: removed.length,
    summary:
      `${added.length} line(s) added, ${removed.length} removed. ` +
      (reasons.size > 0
        ? `Flagged: ${[...reasons].join('; ')}.`
        : 'No requirement, fee, form or eligibility wording touched.'),
  };
}

/** One `visa_source_changes` row, as much of it as the site-wide pass needs. */
export interface ChangeRecord {
  id: string;
  source_id: string;
  escalation_reasons: string[] | null;
  diff: {
    added?: string[];
    removed?: string[];
    /** Pre-cap counts. Absent on records written before they were stored. */
    added_total?: number;
    removed_total?: number;
  } | null;
}

/** The prefix that marks a reason emitted by `detectSiteWideChanges`. */
export const SITE_WIDE_PREFIX = 'SITE-WIDE:';

/**
 * Find the changes in one run that are a single site-wide edit seen from
 * several pages.
 *
 * WHY THIS IS SEPARATE FROM `classifyChange`
 *
 * A production sync on 2026-08-24 raised EIGHT material changes for review.
 * Every one was `immigration.govt.nz`, every one was "N lines added, 0
 * removed", and every one was escalated for "obligation wording changed",
 * "a duration or deadline changed" or "fee wording changed".
 *
 * Not one requirement had changed. INZ had added a service banner and some
 * navigation to every page:
 *
 *   "planned upgrade ... from 08:00 to 21:00 sunday 23 august (nzst), you
 *    cannot access some applications and online forms"
 *   "call 0508 558 855 (toll free from nz landlines)"
 *
 * "sunday 23 august" trips the duration marker. "toll free" trips the fee
 * marker. All 88 New Zealand excerpts still verified verbatim afterwards.
 *
 * `classifyChange` cannot see this and MUST NOT try: it compares one page
 * against its own previous version, where a banner and a new obligation are
 * indistinguishable. Being conservative there is correct — a false 'cosmetic'
 * ships a stale requirement to every applicant.
 *
 * The RUN can see it. A line added to several different sources in one sync is
 * site chrome by construction, and if not one added line is unique to a page,
 * nothing in that page's own text changed.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not clear the review, downgrade the classification, or auto-promote.
 * A genuine site-wide POLICY change — "all applicants must now provide
 * biometrics", added to every page at once — has exactly this shape, and
 * auto-promoting it is the one mistake this subsystem exists to prevent. What
 * it does is give the reviewer the fact that turns eight investigations into
 * one: these are the same edit.
 *
 * Returns only the records it would annotate, each with its full new reason
 * list, so the caller writes exactly what changed and nothing else.
 */
export function detectSiteWideChanges(
  records: ChangeRecord[],
): Array<{ id: string; escalationReasons: string[] }> {
  if (records.length < 2) return [];

  // How many DISTINCT sources gained each line in this run.
  const sourcesByLine = new Map<string, Set<string>>();
  for (const r of records) {
    for (const line of r.diff?.added ?? []) {
      const set = sourcesByLine.get(line) ?? new Set<string>();
      set.add(r.source_id);
      sourcesByLine.set(line, set);
    }
  }

  const out: Array<{ id: string; escalationReasons: string[] }> = [];

  for (const r of records) {
    const added = r.diff?.added ?? [];
    const removed = r.diff?.removed ?? [];
    // Something was deleted, or nothing was added: not the banner pattern.
    if (added.length === 0 || removed.length > 0) continue;

    /**
     * The stored diff is a SAMPLE when a change is large, and this annotation's
     * whole claim is "ALL of the added lines also appeared elsewhere". That
     * cannot be said from the first 50 of 426 lines: the 376 unexamined ones
     * might be entirely this page's own content, and a reviewer would be told
     * "not a change to this page" about a change to this page.
     *
     * Found on production 2026-08-24, when eight New Zealand sources filed
     * changes reporting "426 line(s) added" with fifty stored. A hedged
     * annotation would be worse than none here — the value of this note is that
     * it is confident — so a truncated diff declines instead.
     *
     * `removedTotal` is not consulted: a change with any removal at all was
     * already skipped above.
     */
    const addedTotal = r.diff?.added_total;
    const truncated =
      addedTotal === undefined
        ? added.length >= DIFF_SAMPLE_LIMIT // pre-dates the counts; assume the cap bit
        : addedTotal > added.length;
    if (truncated) continue;

    // ANY line unique to this page means this page's own text changed.
    if (!added.every((l) => (sourcesByLine.get(l)?.size ?? 0) > 1)) continue;

    const others = new Set<string>();
    for (const l of added) {
      for (const s of sourcesByLine.get(l) ?? []) {
        if (s !== r.source_id) others.add(s);
      }
    }

    const reasons = [...(r.escalation_reasons ?? [])];
    if (reasons.some((x) => x.startsWith(SITE_WIDE_PREFIX))) continue;

    reasons.push(
      `${SITE_WIDE_PREFIX} all ${added.length} added line(s) also appeared on ` +
        `${others.size} other source(s) in this run, and nothing was removed — ` +
        'one edit seen from several pages, not a change to this page. Still ' +
        'needs review: a site-wide POLICY change looks identical.',
    );
    out.push({ id: r.id, escalationReasons: reasons });
  }

  return out;
}

/** The marker an excerpt uses to declare that it cut something out. */
export const ELISION = ' ... ';

/**
 * Compare the way a reader would: a line break must not be a mismatch. Same
 * flattening `verify-excerpts.ts` uses, so an excerpt that verifies there is
 * locatable here.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Undo the ONE artifact tag-stripping introduces into otherwise faithful text.
 *
 * `<a href="...">passport</a>, like` strips to `passport , like`: the inline
 * tag became a space, and the space landed before the comma. The government
 * never wrote that space, and leaving it in a quotation would put our
 * processing artifact inside quotation marks attributed to them.
 *
 * Deliberately narrow. It only closes a space that sits BEFORE `,;:.!?` or a
 * closing bracket, or AFTER an opening bracket — positions where none of the
 * languages in this registry (en, sv, ms, zh) puts one. It is NOT applied to
 * the matching excerpt, which stays exactly as the monitor produced it.
 *
 * Note for a future French or Breton source: French sets a space before
 * `;:!?` and `»`. If one is ever registered, this must become
 * language-conditional rather than silently "correcting" correct typography.
 */
export function repairStrippedSpacing(s: string): string {
  return s
    .replace(/\s+([,;:.!?»)\]}])/g, '$1')
    .replace(/([«([{])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Lowercase character by character, recording where each output character came
 * from, so an offset found in the lowercased text can be mapped back exactly.
 *
 * `String.prototype.toLowerCase` over a whole string cannot give this: when a
 * character expands (`İ` -> `i` + combining dot) every later offset shifts, and
 * there is no way afterwards to know by how much.
 */
function lowerWithOffsetMap(cased: string): { lower: string; map: number[] } {
  let lower = '';
  const map: number[] = [];
  for (let i = 0; i < cased.length; i++) {
    const lc = cased[i].toLowerCase();
    for (let k = 0; k < lc.length; k++) map.push(i);
    lower += lc;
  }
  return { lower, map };
}

/**
 * Recover an excerpt's ORIGINAL CASING from the page it was read off.
 *
 * Takes the excerpt exactly as stored (lowercased, possibly declaring elisions
 * with ` ... `) plus both normalizations of the same fetched page, and returns
 * the same text with the authority's own capitalisation.
 *
 * HOW IT IS EXACT RATHER THAN A GUESS
 *
 * `normalizeContent(x) === normalizeContentPreservingCase(x).toLowerCase()` by
 * construction, so the two strings correspond character-for-character. Finding
 * a fragment's offset in the lowercased text and slicing the case-preserving
 * text at THAT SAME OFFSET returns the identical span, cased as published. No
 * second search, no fuzzy match, nothing that can land on a different sentence.
 *
 * THE OFFSET MAP, AND WHY A LENGTH CHECK WAS NOT ENOUGH
 *
 * The first version required the two strings to be the same length. That is
 * true for almost all text and false for a handful of characters: the Turkish
 * dotted capital `İ` lowercases to TWO code units (`i` + combining dot above).
 * Exactly one of them, once, on `migri.fi/en/first-residence-permit` shifted
 * every offset after it and cost FINLAND ITS ENTIRE SET OF QUOTATIONS — 24
 * requirements across the country's routes, refused wholesale by a check that
 * was protecting against precisely this and had no way to recover from it.
 *
 * So the correspondence is now built explicitly: lowercase one character at a
 * time, recording for each character of the result which character of the
 * original produced it. A fragment found at offset `i` in the lowercased text
 * starts at `map[i]` in the cased text, whatever expanded on the way.
 *
 * WHEN IT STILL REFUSES
 *
 * Per-character lowercasing is not always identical to lowercasing the whole
 * string — Greek `Σ` becomes a final `ς` at the end of a word only when its
 * neighbours are known. So the reconstruction is checked against the real
 * normalized page, and a disagreement refuses. It also refuses if a fragment is
 * not found at all.
 *
 * A null must render NO quotation. Falling back to the lowercased excerpt is
 * the exact defect this exists to fix.
 */
export function deriveDisplayExcerpt(
  storedExcerpt: string,
  normalizedPage: string,
  displayPage: string,
): string | null {
  const cased = flat(displayPage);
  const { lower: rebuilt, map } = lowerWithOffsetMap(cased);

  // The reconstruction must agree with the text the excerpt was actually
  // matched against. If it does not, the offsets describe a string nobody
  // searched, and slicing by them would return a plausible-looking span from
  // somewhere else on the page.
  if (rebuilt !== flat(normalizedPage)) return null;

  const fragments = flat(storedExcerpt).split(ELISION);
  const out: string[] = [];
  let cursor = 0;

  for (const fragment of fragments) {
    if (!fragment) continue;
    const at = rebuilt.indexOf(fragment, cursor);
    if (at === -1) return null;
    const end = at + fragment.length;
    const from = map[at];
    // `end` may sit one past the last character; the cased length terminates it.
    const to = end < map.length ? map[end] : cased.length;
    out.push(repairStrippedSpacing(cased.slice(from, to)));
    cursor = end;
  }

  if (out.length === 0) return null;
  return out.join(ELISION);
}
