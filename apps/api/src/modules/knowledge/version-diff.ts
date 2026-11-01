/**
 * Structured diff between two versions of an official page.
 *
 * A character-level diff is the wrong tool for the decision this feeds. An
 * operator looking at a government change is answering one question: "did a
 * REQUIREMENT change, or did the CMS reflow the page?" A red-and-green wall of
 * text cannot distinguish those, and the volume of cosmetic churn on
 * government sites means an operator who has to read one every morning stops
 * reading them.
 *
 * So this diffs at the level the decision is made at:
 *
 *   - which lines were added, removed, or reworded
 *   - which MONETARY AMOUNTS changed, and from what to what
 *   - which DURATIONS changed
 *   - which official FORM CODES appeared or disappeared
 *   - whether a requirement-shaped line ("you must…") was added or removed
 *
 * The last two are the ones that decide "material". A form code disappearing
 * means an authority withdrew a form; a "you must" line disappearing means a
 * requirement was dropped. Both need a human before they reach an applicant.
 */
import { extractFormCodes } from './form-codes';

export interface VersionDiff {
  /** True when nothing beyond whitespace changed. */
  identical: boolean;
  addedLines: string[];
  removedLines: string[];
  /** Lines that are >60% similar to a removed line: a reword, not a rewrite. */
  changedLines: Array<{ before: string; after: string; similarity: number }>;
  amountChanges: Array<{ before: string; after: string; context: string }>;
  durationChanges: Array<{ before: string; after: string; context: string }>;
  formCodesAdded: string[];
  formCodesRemoved: string[];
  requirementsAdded: string[];
  requirementsRemoved: string[];
  /**
   * The classification this diff supports. Advisory: `visa_source_changes`
   * owns the real one, and a human owns the decision.
   */
  suggestedClassification: 'cosmetic' | 'editorial' | 'material' | 'structural';
  /** Why it was classified that way, in words an operator can act on. */
  reasons: string[];
}

/** Lines the authority frames as an obligation. */
const REQUIREMENT_RE =
  /\b(you must|must be|must have|must provide|must submit|is required|are required|required to|shall (?:be|have|provide)|mandatory|it is compulsory)\b/i;

/**
 * Money, with its currency. Matches symbol-prefixed and code-suffixed forms,
 * which is enough for the currencies government fee pages actually quote.
 */
const AMOUNT_RE =
  /(?:(?:[$£€¥₹₺]|CA\$|A\$|NZ\$|US\$|R\$)\s?\d[\d,.]*(?:\.\d{2})?)|(?:\b\d[\d,.]*\s?(?:AUD|CAD|USD|GBP|EUR|NZD|SGD|INR|AED|SAR|TRY|JPY|CNY|CHF|SEK|NOK|DKK|PLN|BRL|ZAR|MYR|THB|QAR|OMR|JOD|KWD|BHD|EGP|LBP|HKD)\b)/g;

/** Durations: processing times, validity periods, passport validity. */
const DURATION_RE =
  /\b\d+\s*(?:-\s*\d+\s*)?(?:calendar\s+|working\s+|business\s+)?(?:day|days|week|weeks|month|months|year|years|hour|hours)\b/gi;

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

/**
 * Similarity by token overlap: the better of word-bigram and word-unigram Dice.
 *
 * Chosen over Levenshtein because the interesting case is a reworded sentence,
 * where edit distance is large but meaning overlap is high — and because it is
 * O(n) rather than O(n²) on lines that can be several hundred characters.
 */
export function similarity(a: string, b: string): number {
  const words = (s: string): string[] =>
    s.toLowerCase().split(/\s+/).filter(Boolean);

  const dice = (A: Set<string>, B: Set<string>): number => {
    if (A.size === 0 && B.size === 0) return 1;
    if (A.size === 0 || B.size === 0) return 0;
    let shared = 0;
    for (const x of A) if (B.has(x)) shared++;
    return (2 * shared) / (A.size + B.size);
  };

  const wa = words(a);
  const wb = words(b);

  const bigrams = (w: string[]): Set<string> => {
    const out = new Set<string>();
    if (w.length === 1) out.add(w[0]);
    for (let i = 0; i + 1 < w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
    return out;
  };

  // MAX of bigram and unigram similarity, not bigram alone.
  //
  // Bigrams capture word order, which is what distinguishes a reword from a
  // rewrite — but a short line has almost none of them, so a one-word edit
  // wrecks the score. "Processing takes 14 days." vs "Processing takes 28
  // days." shares one of six bigrams (0.33) and would be reported as an
  // unrelated line removed plus an unrelated line added, which loses the
  // FIGURE CHANGE entirely: a processing time doubling would be filed as
  // editorial churn. Unigram overlap on the same pair is 0.75.
  return Math.max(
    dice(bigrams(wa), bigrams(wb)),
    dice(new Set(wa), new Set(wb)),
  );
}

function matchAll(text: string, re: RegExp): string[] {
  re.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].trim());
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/**
 * Normalise an amount so "£1,000.00" and "£1000" are the same figure.
 *
 * Trailing sentence punctuation is stripped FIRST. The amount pattern is
 * greedy over `[\d,.]`, so "The fee is £1,000.00." captures the full stop too;
 * with it still attached the `.00` suffix strip never matched and the same fee
 * written two ways was reported as a fee change — a false material change on
 * every page that ends a sentence with a figure.
 */
function normalizeAmount(s: string): string {
  return s
    .replace(/[\s,]/g, '')
    .replace(/[.,]+$/, '')
    .replace(/\.00$/, '')
    .toUpperCase();
}

export function diffVersions(before: string, after: string): VersionDiff {
  const beforeLines = lines(before);
  const afterLines = lines(after);

  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const removed = beforeLines.filter((l) => !afterSet.has(l));
  const added = afterLines.filter((l) => !beforeSet.has(l));

  // Pair removals with additions that are recognisably the same line reworded.
  // Greedy best-match; a line is used at most once, so a paragraph rewritten
  // into two does not report as two rewordings of the same original.
  const changed: VersionDiff['changedLines'] = [];
  const usedAdded = new Set<number>();
  const trulyRemoved: string[] = [];

  for (const rem of removed) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < added.length; i++) {
      if (usedAdded.has(i)) continue;
      const score = similarity(rem, added[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.6) {
      usedAdded.add(bestIdx);
      changed.push({
        before: rem,
        after: added[bestIdx],
        similarity: Number(bestScore.toFixed(3)),
      });
    } else {
      trulyRemoved.push(rem);
    }
  }
  const trulyAdded = added.filter((_, i) => !usedAdded.has(i));

  // Figures. Compared as SETS over the whole document rather than per line,
  // because a fee that moved to a different row of the same table is not a
  // change and a per-line diff would report it as one.
  const beforeAmounts = new Set(
    matchAll(before, AMOUNT_RE).map(normalizeAmount),
  );
  const afterAmounts = new Set(matchAll(after, AMOUNT_RE).map(normalizeAmount));
  const amountChanges: VersionDiff['amountChanges'] = [];
  for (const c of changed) {
    const b = matchAll(c.before, AMOUNT_RE);
    const a = matchAll(c.after, AMOUNT_RE);
    for (let i = 0; i < Math.max(b.length, a.length); i++) {
      const bv = b[i];
      const av = a[i];
      if (bv && av && normalizeAmount(bv) !== normalizeAmount(av)) {
        amountChanges.push({
          before: bv,
          after: av,
          context: c.after.slice(0, 200),
        });
      }
    }
  }
  // Amounts that vanished or appeared outside a reworded line.
  for (const amount of beforeAmounts) {
    if (
      !afterAmounts.has(amount) &&
      !amountChanges.some((c) => normalizeAmount(c.before) === amount)
    ) {
      const context = beforeLines.find((l) =>
        matchAll(l, AMOUNT_RE).some((x) => normalizeAmount(x) === amount),
      );
      amountChanges.push({
        before: amount,
        after: '(removed)',
        context: context?.slice(0, 200) ?? '',
      });
    }
  }
  for (const amount of afterAmounts) {
    if (
      !beforeAmounts.has(amount) &&
      !amountChanges.some((c) => normalizeAmount(c.after) === amount)
    ) {
      const context = afterLines.find((l) =>
        matchAll(l, AMOUNT_RE).some((x) => normalizeAmount(x) === amount),
      );
      amountChanges.push({
        before: '(absent)',
        after: amount,
        context: context?.slice(0, 200) ?? '',
      });
    }
  }

  const durationChanges: VersionDiff['durationChanges'] = [];
  for (const c of changed) {
    const b = matchAll(c.before, DURATION_RE);
    const a = matchAll(c.after, DURATION_RE);
    for (let i = 0; i < Math.max(b.length, a.length); i++) {
      if (b[i] && a[i] && b[i].toLowerCase() !== a[i].toLowerCase()) {
        durationChanges.push({
          before: b[i],
          after: a[i],
          context: c.after.slice(0, 200),
        });
      }
    }
  }

  const beforeCodes = new Set(extractFormCodes(before).map((f) => f.code));
  const afterCodes = new Set(extractFormCodes(after).map((f) => f.code));
  const formCodesAdded = [...afterCodes].filter((c) => !beforeCodes.has(c));
  const formCodesRemoved = [...beforeCodes].filter((c) => !afterCodes.has(c));

  const requirementsAdded = trulyAdded.filter((l) => REQUIREMENT_RE.test(l));
  const requirementsRemoved = trulyRemoved.filter((l) =>
    REQUIREMENT_RE.test(l),
  );

  const reasons: string[] = [];
  let classification: VersionDiff['suggestedClassification'] = 'cosmetic';

  if (
    trulyAdded.length === 0 &&
    trulyRemoved.length === 0 &&
    changed.length === 0
  ) {
    classification = 'cosmetic';
    reasons.push('no textual difference after normalisation');
  } else {
    classification = 'editorial';
    if (changed.length) reasons.push(`${changed.length} line(s) reworded`);
    if (trulyAdded.length) reasons.push(`${trulyAdded.length} line(s) added`);
    if (trulyRemoved.length)
      reasons.push(`${trulyRemoved.length} line(s) removed`);
  }

  if (amountChanges.length) {
    classification = 'material';
    reasons.push(`${amountChanges.length} monetary figure(s) changed`);
  }
  if (durationChanges.length) {
    classification = 'material';
    reasons.push(`${durationChanges.length} duration(s) changed`);
  }
  if (formCodesRemoved.length) {
    classification = 'material';
    reasons.push(
      `official form code(s) no longer present: ${formCodesRemoved.join(', ')}`,
    );
  }
  if (formCodesAdded.length) {
    classification = 'material';
    reasons.push(`new official form code(s): ${formCodesAdded.join(', ')}`);
  }
  if (requirementsRemoved.length) {
    classification = 'material';
    reasons.push(
      `${requirementsRemoved.length} requirement-shaped line(s) removed`,
    );
  }
  if (requirementsAdded.length) {
    classification = 'material';
    reasons.push(
      `${requirementsAdded.length} requirement-shaped line(s) added`,
    );
  }

  // A page that lost or gained most of its body is a restructure, and a
  // restructure is not a set of requirement changes to review one by one — it
  // needs the source re-read from scratch.
  const churn =
    beforeLines.length > 0
      ? (trulyAdded.length + trulyRemoved.length) /
        Math.max(beforeLines.length, afterLines.length)
      : 1;
  if (churn > 0.5 && beforeLines.length > 10) {
    classification = 'structural';
    reasons.unshift(
      `${Math.round(churn * 100)}% of the page changed — likely restructured or replaced`,
    );
  }

  return {
    identical:
      trulyAdded.length === 0 &&
      trulyRemoved.length === 0 &&
      changed.length === 0,
    addedLines: trulyAdded.slice(0, 200),
    removedLines: trulyRemoved.slice(0, 200),
    changedLines: changed.slice(0, 200),
    amountChanges: amountChanges.slice(0, 100),
    durationChanges: durationChanges.slice(0, 100),
    formCodesAdded,
    formCodesRemoved,
    requirementsAdded: requirementsAdded.slice(0, 100),
    requirementsRemoved: requirementsRemoved.slice(0, 100),
    suggestedClassification: classification,
    reasons,
  };
}
