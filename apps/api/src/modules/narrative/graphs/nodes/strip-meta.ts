/**
 * Deterministic removal of the model talking to the USER around a letter that
 * a visa OFFICER will read: a leading "Here is the letter…" / "Certainly!"
 * preamble, and trailing "Note: …", "Let me know…", "Feel free…" commentary.
 * The prompt forbids this too; this is the backstop, because one leaked
 * sentence in a submitted LOE is enough to look machine-written.
 *
 * Only whole paragraphs at the very start or very end are removed, and a
 * leading paragraph only when it is short — the letter body is never touched.
 */

const LEADING_META = [
  /^(sure|certainly|of course|absolutely|okay|ok|great)\b[!,.]?/i,
  /^(here('s| is| are)|below (is|are)|attached is|the following is)\b/i,
  /^i('ve| have) (drafted|written|prepared|created|composed|generated|put together)\b/i,
  /^(\*\*|__)?(note|disclaimer)s?(\*\*|__)?\s*:/i,
];

const TRAILING_META = [
  /^(\*\*|__|\*|_)?(note|disclaimer|important|reminder|tip)s?(\*\*|__|\*|_)?\s*:/i,
  /^(\*\*|__|\*|_)?(note|disclaimer|important|reminder|tip)s?\s*:/i,
  /^(let me know|feel free|i hope (this|that)|hope this|if you('d| would) like|if you need|should you need|would you like)\b/i,
  /^please (review|adjust|replace|customi[sz]e|fill in|edit|modify|let me know|feel free|ensure|make sure|verify|double-check)\b/i,
  /^please note that (this|the) (letter|draft|template|document|itinerary|cover letter)\b/i,
  /^you (may|can|might|should|will)( (want|need) to)? (adjust|customi[sz]e|replace|edit|modify|review|add|fill)\b/i,
  /^(this|the above) (letter|draft|template|document|itinerary|cover letter) (is|has been|was|can|should|may|uses|assumes)\b/i,
  /^remember to\b/i,
];

const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const MAX_LEADING_META_CHARS = 240;

function unfence(text: string): string {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return m ? m[1] : text;
}

function plain(paragraph: string): string {
  return paragraph
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^>\s*/, '');
}

export function stripMetaCommentary(input: string): string {
  if (!input) return input;
  const text = unfence(input.replace(/\r\n?/g, '\n'));
  const paras = text.split(/\n\s*\n/);

  let start = 0;
  let end = paras.length;

  const isRule = (p: string) => RULE.test(p);
  const isBlank = (p: string) => !p.trim();

  // Leading: short meta paragraphs, and any rule/blank left behind them.
  let strippedLead = false;
  while (start < end) {
    const p = plain(paras[start]);
    if (isBlank(p)) {
      start++;
      continue;
    }
    if (strippedLead && isRule(paras[start])) {
      start++;
      continue;
    }
    if (
      p.length <= MAX_LEADING_META_CHARS &&
      LEADING_META.some((re) => re.test(p))
    ) {
      start++;
      strippedLead = true;
      continue;
    }
    break;
  }

  // Trailing: meta paragraphs, and any rule/blank between them and the letter.
  while (end > start) {
    const raw = paras[end - 1];
    const p = plain(raw);
    if (isBlank(p) || isRule(raw)) {
      end--;
      continue;
    }
    if (TRAILING_META.some((re) => re.test(p))) {
      end--;
      continue;
    }
    break;
  }

  const out = paras.slice(start, end).join('\n\n').trim();
  return out ? out : input.trim();
}
