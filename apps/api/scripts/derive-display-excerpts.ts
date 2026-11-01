#!/usr/bin/env ts-node
/**
 * Recover the authority's own CAPITALISATION for every stored excerpt.
 *
 * WHY THIS EXISTS — BUG_LOG D-11
 *
 * Every requirement in this registry exists only because it is bound to a
 * verbatim government quote. `generate-requirements.mjs` refuses to emit one
 * without an excerpt, four scripts verify them, and every promotion migration
 * asserts them.
 *
 * The applicant was shown none of it. `apps/web/lib/visa-registry.ts` never
 * selected `source_excerpt`, so the public page rendered VisaAI's own label and
 * description — the paraphrase — with the evidence left in the database.
 *
 * The obvious fix is wrong. `normalizeContent` lowercases, because a CMS
 * restyling a heading from `Fees` to `FEES` has not changed the law. So the
 * stored excerpt reads
 *
 *   you must: have a valid travel document , like a passport
 *
 * where IRCC published
 *
 *   You must: have a valid travel document, like a passport
 *
 * Rendering the first inside quotation marks would misquote a government in the
 * one feature meant to prove VisaAI does not — and would put OUR processing
 * artifacts (the lowercasing, and the space an inline `<a>` left before the
 * comma) inside a quotation attributed to them.
 *
 * HOW THIS IS EXACT AND NOT A SECOND GUESS
 *
 * `.toLowerCase()` is the LAST operation in `normalizeContent`, so
 *
 *   normalizeContent(x) === normalizeContentPreservingCase(x).toLowerCase()
 *
 * by construction. The two strings correspond character-for-character. This
 * finds each excerpt's offset in the lowercased text — the same search, over
 * the same string, that `verify-excerpts.ts` runs — and slices the
 * case-preserving text at that offset. There is no re-matching step that could
 * land on a different sentence.
 *
 * It REFUSES rather than guessing when the two normalizations differ in length
 * (a Turkish dotted capital anywhere earlier on the page would shift every
 * offset after it) or when a fragment is not found. A refusal writes nothing,
 * and the page renders no quotation — which is the honest outcome, and still
 * strictly better than quoting text the authority did not write.
 *
 * WHAT IT WRITES
 *
 * `source_excerpt_display` alongside `source_excerpt` in each extraction file.
 * The matching excerpt is never touched: verification, hashing and change
 * detection all keep running against exactly what they ran against before.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/derive-display-excerpts.ts data/requirements/*.json
 *   npx ts-node -P tsconfig.json scripts/derive-display-excerpts.ts --check data/requirements/*.json
 *
 * `--check` writes nothing and exits non-zero if any file is missing a display
 * excerpt it could have had. Use it in CI so a new extraction cannot land
 * without one.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import {
  deriveDisplayExcerpt,
  normalizeContent,
  normalizeContentPreservingCase,
} from '../src/modules/visa-sync/normalize';

interface Requirement {
  requirement_code: string;
  source_role: string;
  source_excerpt: string;
  source_excerpt_display?: string;
}
interface Doc {
  visaai_id: string;
  source_roles: Record<string, string>;
  requirements: Requirement[];
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('usage: derive-display-excerpts.ts [--check] <extraction.json>...');
  process.exit(2);
}

let derived = 0;
let unchanged = 0;
let unreadable = 0;
let failed = 0;

async function run(path: string): Promise<void> {
  const raw = readFileSync(path, 'utf8');
  const doc = JSON.parse(raw) as Doc;

  /** role -> both normalizations of the page, or null if it could not be read. */
  const pages = new Map<string, { lower: string; cased: string } | null>();

  for (const [role, url] of Object.entries(doc.source_roles ?? {})) {
    if (!doc.requirements.some((r) => r.source_role === role)) continue;
    const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
    if (r.status !== 'ok') {
      console.error(`  UNREADABLE  role=${role} (${r.status}) ${url}`);
      pages.set(role, null);
      unreadable++;
      continue;
    }
    pages.set(role, {
      lower: normalizeContent(r.body, r.contentType),
      cased: normalizeContentPreservingCase(r.body, r.contentType),
    });
    await new Promise((res) => setTimeout(res, 3_000)); // polite between pages
  }

  let fileDerived = 0;
  let fileFailed = 0;

  for (const req of doc.requirements) {
    const page = pages.get(req.source_role);
    if (page === null) continue; // unreadable, already counted
    if (page === undefined) continue; // role not declared; verify-excerpts reports it

    const display = deriveDisplayExcerpt(req.source_excerpt, page.lower, page.cased);
    if (display === null) {
      console.error(
        `  NO DISPLAY  ${req.requirement_code} (role=${req.source_role}) — ` +
          'offsets could not be established; this requirement will render no quotation',
      );
      fileFailed++;
      failed++;
      continue;
    }
    if (req.source_excerpt_display === display) {
      unchanged++;
      continue;
    }
    req.source_excerpt_display = display;
    fileDerived++;
    derived++;
  }

  if (!checkOnly && fileDerived > 0) {
    // Keep the file byte-shaped the way the extractions are written: 2-space
    // indent, trailing newline, no escaped non-ASCII.
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  const verdict = fileFailed > 0 ? `${fileFailed} WITHOUT DISPLAY` : 'OK';
  console.log(`${verdict}  ${doc.visaai_id}  (+${fileDerived} derived)`);
}

async function main(): Promise<void> {
  for (const f of files) await run(f);

  console.log(
    `\n${derived} derived, ${unchanged} already current, ` +
      `${failed} could not be derived, ${unreadable} source(s) unreadable.`,
  );

  if (unreadable > 0) {
    console.log(
      'An unreadable source is not a failure here — it is the Australian 403, and\n' +
        'those routes publish nothing. See docs/operations/SOURCE_ACCESS.md.',
    );
  }

  if (failed > 0) {
    console.error(
      '\nA requirement with no display excerpt renders NO quotation. That is the\n' +
        'honest outcome and it is not a crash — but it means the applicant sees\n' +
        "VisaAI's paraphrase alone, so it is worth understanding why.",
    );
    process.exit(1);
  }

  if (checkOnly && derived > 0) {
    console.error(
      `\n--check: ${derived} excerpt(s) have no stored display form. ` +
        'Run without --check to write them.',
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
