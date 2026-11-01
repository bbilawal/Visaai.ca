#!/usr/bin/env node
/**
 * Resolve requirement excerpts from LINE NUMBERS instead of typing them.
 *
 * WHY THIS EXISTS — B-33
 *
 * Four Lebanese requirements shipped quoting the wrong sentence. Every excerpt
 * was verbatim, so every verbatim check passed; they were just verbatim copies
 * of `regarding (6):` and `important notes:` rather than of the rules those
 * headings introduced. The cause was picking spans by eye against an unnumbered
 * dump — the excerpt drifted a few lines from the claim and nothing could tell.
 *
 * `check-excerpt-shape.ts` catches the specific shape that failure took (a
 * heading standing in for a rule). It cannot catch the general case: an excerpt
 * that is well-shaped, verbatim, and about something else.
 *
 * The general fix is to stop transcribing. An author names line numbers out of a
 * numbered dump; this resolves them against the dump's own bytes. A typo becomes
 * impossible rather than unlikely, because no excerpt text is ever typed.
 *
 * THE INVARIANT IT ENFORCES
 *
 * `normalizeContent` is defined as `normalizeContentPreservingCase(...)
 * .toLowerCase()`, so the two texts differ ONLY in case — same length, same
 * characters at the same offsets. That is what makes `source_excerpt` and
 * `source_excerpt_display` an exact pair rather than two separate matches. This
 * takes the case-preserving dump as the single source and derives the lowercase
 * form from it, so the pair cannot drift. It then asserts that BOTH forms occur
 * in their respective texts, and fails the whole file if either does not.
 *
 * It also refuses an excerpt that is only a heading, which is what B-33 was.
 *
 * Usage:
 *   node scripts/visa-registry/excerpts-from-lines.mjs \
 *     --spec  data/requirements/_specs/dk-pay-limit-scheme.spec.json \
 *     --dump  /tmp/dkdump/dk-pay-limit-scheme.raw.txt \
 *     --out   data/requirements/dk-pay-limit-scheme.json
 *
 * The spec is the finished requirements file with, on each requirement, a
 * `lines: [start]` or `lines: [start, end]` (1-based, inclusive) in place of
 * `source_excerpt` / `source_excerpt_display`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

const specPath = arg('--spec');
const dumpPath = arg('--dump');
const outPath = arg('--out');
if (!specPath || !dumpPath || !outPath) {
  console.error('Usage: --spec <spec.json> --dump <raw.txt> --out <out.json>');
  process.exit(2);
}

/** The case-preserving normalized text, exactly as the fetcher produced it. */
const display = readFileSync(dumpPath, 'utf8');
const lower = display.toLowerCase();
const lines = display.split('\n');

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const problems = [];

/**
 * A heading is a short line that states no obligation. Quoting one as evidence
 * for a requirement is B-33 exactly: it names the topic and asserts nothing.
 */
const NORMATIVE =
  /\b(must|need|require[ds]?|should|may|shall|will|cannot|can|are|is|allowed|permitted|granted|entitled|exempt|at least|no later|not)\b|\b(have|has)\s+to\b/i;

for (const [idx, r] of (spec.requirements ?? []).entries()) {
  const where = `${r.requirement_code ?? `#${idx}`}`;

  if (!Array.isArray(r.lines) || r.lines.length < 1 || r.lines.length > 2) {
    problems.push(`${where}: needs "lines": [start] or [start, end]`);
    continue;
  }
  const [start, end = r.lines[0]] = r.lines;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    problems.push(`${where}: bad line range ${JSON.stringify(r.lines)}`);
    continue;
  }
  if (end > lines.length) {
    problems.push(`${where}: line ${end} is past the end of the dump (${lines.length} lines)`);
    continue;
  }

  const excerptDisplay = lines.slice(start - 1, end).join('\n').trim();
  if (!excerptDisplay) {
    problems.push(`${where}: lines ${start}-${end} are blank`);
    continue;
  }
  const excerpt = excerptDisplay.toLowerCase();

  // The whole point. If either form is not literally present, the pair is not a
  // quotation of this page and nothing downstream can be trusted about it.
  if (!display.includes(excerptDisplay)) {
    problems.push(`${where}: display excerpt is NOT a substring of the dump`);
    continue;
  }
  if (!lower.includes(excerpt)) {
    problems.push(`${where}: lowercase excerpt is NOT a substring of the lowercased dump`);
    continue;
  }

  // B-33's shape, refused at the source rather than caught after promotion.
  //
  // The signature is specific: a SINGLE short line that states no obligation.
  // A label carried together with the value it names — "Processing fee" above
  // "DKK 6,810,-" — is self-contained evidence and not what went wrong; B-33
  // was a heading quoted INSTEAD OF the rule beneath it. So a multi-line span,
  // which necessarily carries more than the heading, is not flagged.
  const oneLine = !excerptDisplay.includes('\n');
  if (oneLine && excerptDisplay.length <= 100 && !NORMATIVE.test(excerptDisplay)) {
    problems.push(
      `${where}: excerpt looks like a HEADING, not a rule — ${JSON.stringify(excerptDisplay)}`,
    );
    continue;
  }

  delete r.lines;
  r.source_excerpt = excerpt;
  r.source_excerpt_display = excerptDisplay;
}

if (problems.length > 0) {
  console.error(`${problems.length} problem(s) — nothing written:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
console.log(
  `${spec.requirements.length} excerpt(s) resolved from ${dumpPath} and verified present, both cases.`,
);
console.log(`wrote ${outPath}`);
