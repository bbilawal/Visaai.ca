#!/usr/bin/env ts-node
/**
 * Ask whether an excerpt is a REQUIREMENT — not whether it is on the page.
 *
 * WHY THIS EXISTS
 *
 * `verify-excerpts.ts` proves every stored excerpt appears verbatim in the
 * fetched page, and `verify-quotes-against-raw.ts` proves it again against the
 * raw HTML. Both passed, twice, on this:
 *
 *   cat5_non_activity_attestation   ->  "regarding (5):"
 *   cat7_mfa_document_of_prior_service -> "regarding (8):"
 *
 * Those strings ARE on the page. They are section headings, sitting one line
 * away from the document each requirement claims to quote, and the requirement
 * shipped to production with a heading as its evidence. Nothing could catch it,
 * because every existing check asks the same question — is this text there? —
 * and the answer was yes.
 *
 * So this asks a DIFFERENT question, which is the whole point (B-25, B-26): is
 * this text SHAPED like the thing the requirement says it is?
 *
 * WHAT IT FLAGS, AND WHY EACH ONE IS A REAL FAILURE
 *
 *   HEADING     — short and ending in a colon. "the requested documents :",
 *                 "important notes:", "regarding (6):". A heading is a pointer
 *                 to requirements, never a requirement.
 *
 *   BARE AMOUNT — digits, separators and a currency code and nothing else.
 *                 Lebanon's fee tables print the row label and its price on
 *                 separate lines, so `lbp 54,000,000` alone says nothing about
 *                 what it buys. This is Austria's points-table problem in
 *                 another table, and Austria's promotion migration already
 *                 refuses bare numbers for exactly this reason.
 *
 *   TWIN        — two requirements in the same file whose excerpts are
 *                 IDENTICAL. Their evidence cannot distinguish them: whatever
 *                 the string proves, it proves equally for both. The
 *                 cash-guarantee and businessperson routes were both
 *                 `lbp 54,000,000`, and no reviewer reading either row could
 *                 have told they were looking at the wrong one.
 *
 *   COLUMN      — a bare table-column label ("fees", "required documents",
 *                 "circumstances"). Same class as HEADING; listed separately
 *                 because it carries no colon and would otherwise slip through.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not judge whether the excerpt matches its LABEL. That needs judgement
 * and would either be a language model in a CI gate or a pile of per-file
 * exceptions. These four shapes are mechanical, and mechanical is what a guard
 * should be — every one of them is wrong on its face, whatever the label says.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/check-excerpt-shape.ts ../../data/requirements/*.json
 */
import { readFileSync } from 'fs';

interface Requirement {
  requirement_code: string;
  kind: string;
  source_excerpt: string;
}
interface Doc {
  visaai_id: string;
  requirements: Requirement[];
}

/** Currency codes that appear in this corpus, for the bare-amount test. */
const CURRENCIES = /\b(?:aed|aud|cad|cny|eur|gbp|hkd|lbp|myr|nok|nzd|sek|sgd|usd|try|egp)\b/i;

/**
 * Table-column labels seen in the corpus. Short, no verb, no colon — the row
 * above the data rather than the data.
 */
const COLUMN_LABELS = new Set([
  'fees',
  'legal fee',
  'required fee',
  'required documents',
  'requested documents',
  'circumstances',
  'status',
  'type of request',
  'type of transaction',
  'visa type visa fees',
  'the beneficiaries:',
  'the type of visas',
  'requirements',
]);

/**
 * Language that makes a heading NORMATIVE — it states a rule rather than
 * pointing at one.
 *
 * This distinction is the whole difference between the two kinds of heading in
 * this corpus, and getting it wrong in either direction is expensive:
 *
 *   "regarding (6):"                             -> points at documents. Useless as evidence.
 *   "you must meet one of the following two requirements:" -> IS the rule. The
 *   alternation is the requirement, and dropping it turns a choose-one list
 *   into a checklist an applicant thinks they must satisfy in full.
 *
 * So a heading is only flagged when it says nothing about obligation.
 *
 * The vocabulary is deliberately wide, and widening it was forced by evidence
 * rather than taste. Two REAL requirements end in a colon and were rejected by
 * a narrower list — Malaysia's "student pass holders ARE ALLOWED to work
 * part-time ... limited to 20 hours per week" and the Netherlands' "YOU WILL BE
 * doing highly qualified work in the Netherlands and:". Both state a rule; both
 * were missing only because `allowed`, `are`, `you` and `will` were absent from
 * the list.
 *
 * A length cap of 100 characters stays, and it is doing real work rather than
 * padding: the two above run to 122 and 62 characters, and the pointers this
 * rejects — "regarding (6):", "important notes:", "2- a visa requested at a gs
 * bureau:" — are all short noun phrases. Length alone cannot separate a
 * 61-character pointer from a 62-character rule, which is exactly why it is the
 * SECOND test and not the first.
 */
const NORMATIVE =
  /\b(?:must|need|needs|required?|requirements?|should|may|can|shall|will|are|is|was|were|allowed|permitted|granted|exempt|eligible|entitled|at least|one of|either|you|your|they|holders?)\b/i;

/**
 * Lines that END IN A COLON and ARE requirements, exempted by hand.
 *
 * A rule with no exceptions either never fires or is quietly weakened until it
 * cannot. This keeps the rule sharp and names what it gets wrong.
 *
 * The staleness check below is what stops the list rotting: if an exempted
 * excerpt is no longer in the corpus, the exemption is reported as dead and
 * must be removed. An allowlist nobody prunes is a list of things nobody
 * checks (ledger entry 11).
 */
const HEADING_EXEMPT: Record<string, string> = {
  'my-long-term-social-visit-pass/stamped_employment_contract':
    'Names a document AND its RM10 revenue stamp before introducing the sub-list of details it must contain. The colon is the list, not the sentence — the requirement stands on its own.',
};

type Finding = { file: string; code: string; kind: string; why: string; excerpt: string; fatal: boolean };

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: check-excerpt-shape.ts <extraction.json>...');
  process.exit(2);
}

const findings: Finding[] = [];
const usedExemptions = new Set<string>();
let checked = 0;

for (const path of files) {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Doc;
  const file = doc.visaai_id;
  const seen = new Map<string, string>();

  for (const req of doc.requirements ?? []) {
    checked++;
    const raw = req.source_excerpt ?? '';
    const text = raw.trim();
    // An elided excerpt is judged on the whole thing: its fragments together
    // are the evidence, and a label-plus-amount pair is exactly the FIX for
    // the bare-amount finding, not an instance of it.
    const elided = text.includes(' ... ');

    const exemptKey = `${file}/${req.requirement_code}`;
    if (HEADING_EXEMPT[exemptKey]) usedExemptions.add(exemptKey);

    if (
      !elided &&
      text.endsWith(':') &&
      text.length <= 100 &&
      !NORMATIVE.test(text) &&
      !HEADING_EXEMPT[exemptKey]
    ) {
      findings.push({ file, code: req.requirement_code, kind: req.kind, why: 'HEADING', excerpt: text, fatal: true });
      continue;
    }

    if (!elided && COLUMN_LABELS.has(text.toLowerCase())) {
      findings.push({ file, code: req.requirement_code, kind: req.kind, why: 'COLUMN', excerpt: text, fatal: true });
      continue;
    }

    // Strip the currency and see whether anything but digits and separators is
    // left. `lbp 54,000,000` -> nothing. `application fee: cny 1,500.` keeps
    // "application fee" and passes, which is right — it names what it buys.
    if (!elided && CURRENCIES.test(text)) {
      const withoutMoney = text.replace(CURRENCIES, '').replace(/[\d\s,.–—-]/g, '');
      if (withoutMoney === '') {
        findings.push({ file, code: req.requirement_code, kind: req.kind, why: 'BARE AMOUNT', excerpt: text, fatal: true });
        continue;
      }
    }

    const twin = seen.get(text);
    if (twin) {
      // One government sentence CAN legitimately be the evidence for two
      // requirements — IRCC's "you may also need a medical exam and letter of
      // invitation" names both things in one breath, and splitting the quote
      // would be the fabrication, not the fix. What is never legitimate is two
      // requirements sharing a short, non-normative string: then the evidence
      // for each equally supports the other and a reviewer cannot tell which
      // row they are reading. Reported either way; fatal only in that case.
      const distinguishing = text.length > 80 && NORMATIVE.test(text);
      findings.push({
        file,
        code: `${twin} + ${req.requirement_code}`,
        kind: req.kind,
        why: 'TWIN',
        excerpt: text,
        fatal: !distinguishing,
      });
      continue;
    }
    seen.set(text, req.requirement_code);
  }
}

// A dead exemption is a defect in its own right: it means the corpus moved and
// the list did not, so nobody is checking what it claims to have considered.
// Only meaningful over the WHOLE corpus — a single-file run legitimately sees
// none of them.
const wholeCorpus = files.length > 20;
const staleExemptions = wholeCorpus
  ? Object.keys(HEADING_EXEMPT).filter((k) => !usedExemptions.has(k))
  : [];

const fatal = findings.filter((f) => f.fatal);
const warnings = findings.filter((f) => !f.fatal);

for (const f of findings) {
  console.error(`  ${(f.fatal ? f.why : `${f.why} (noted)`).padEnd(18)} ${f.file}  ${f.code}`);
  console.error(`              ${JSON.stringify(f.excerpt.slice(0, 120))}`);
}

console.log(
  `\n${checked} excerpt(s) checked for SHAPE across ${files.length} file(s). ` +
    `${fatal.length} rejected, ${warnings.length} noted.`,
);

if (warnings.length > 0 && fatal.length === 0) {
  console.log(
    'The noted item(s) are two requirements quoting ONE government sentence that\n' +
      'names both — legitimate, and worth seeing.',
  );
}

if (staleExemptions.length > 0) {
  console.error(
    `\n${staleExemptions.length} heading exemption(s) no longer match anything in the corpus:`,
  );
  for (const k of staleExemptions) console.error(`  ${k}`);
  console.error('Remove them — an exemption for an excerpt that no longer exists exempts nothing.');
  process.exit(1);
}

if (fatal.length > 0) {
  console.error(
    '\nEach of these is verbatim ON the page and is still not a requirement.\n' +
      'A heading points AT requirements; a bare amount does not say what it buys;\n' +
      'twins cannot tell each other apart. Re-read the source and take the line\n' +
      'the requirement actually describes — or pair it with its label using the\n' +
      'declared elision (" ... "), which is what the fee rows needed.',
  );
  process.exit(1);
}

console.log('No excerpt is a heading, a bare amount, a column label, or a twin.');
