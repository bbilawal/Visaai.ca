#!/usr/bin/env ts-node
/**
 * Check published quotations against the RAW page, not against our reading of it.
 *
 * WHY THIS EXISTS WHEN verify-excerpts.ts ALREADY RUNS
 *
 * `verify-excerpts.ts` re-fetches the page and looks for the excerpt in
 * `normalizeContent(page)` — the output of the same function that produced the
 * excerpt in the first place. That proves the excerpt matches OUR READING of the
 * page. It cannot prove our reading is right, because a flaw in the reading
 * appears identically on both sides.
 *
 * That is not hypothetical. Two defects found on 2026-08-24 were invisible to
 * every check in this repo for exactly that reason:
 *
 *   B-25  Four countries stored under ISO codes that no longer exist. The
 *         generator round-tripped each code through ICU and compared the name —
 *         and `DY` -> "Benin" round-trips perfectly. Wrong code, right name.
 *
 *   B-26  Three published quotations containing `fianc&eacute;/fianc&eacute;e`.
 *         `&eacute;` was missing from the entity table, so it survived
 *         normalization as literal markup; `verify-excerpts` normalized the
 *         fetched page the same way and agreed with the broken spelling.
 *
 * The general lesson, and the reason for this file: **a check built from the
 * same assumption as the thing it checks will confirm it.** What catches these
 * is a DIFFERENT question asked of the same data.
 *
 * HOW THIS READING IS DIFFERENT
 *
 * It strips tags and deletes entity references, and does nothing else. No
 * element drops, no volatile-pattern rewriting, no render-date removal, no
 * embedded-JSON extraction, no block-tag-to-newline structure. It shares no code
 * with `normalize.ts`.
 *
 * Comparison is on letters and digits only, because whitespace and punctuation
 * legitimately differ between the two readings and are not what this is looking
 * for. Entity references are DELETED rather than decoded: what a decoded entity
 * becomes cannot matter once punctuation is dropped, but an UNDECODED one leaves
 * letters behind (`&ldquo;` -> "ldquo") and would break a match that is fine.
 * The probe's own first two runs failed on precisely that — an independent check
 * needs the same scrutiny as the thing it checks.
 *
 * WHAT A FAILURE MEANS
 *
 * The quoted words are not contiguous on the page as served. Either the
 * normalizer removed something in the middle of the quote — making it a splice
 * that asserts adjacency the page does not have — or it mangled the wording. It
 * does NOT necessarily mean the excerpt is on the wrong page; that is
 * `verify-extraction-bounds.ts`'s question.
 *
 * Pages whose real content lives in an embedded JSON payload are SKIPPED and
 * counted: their text is not in the markup at all, so this reading cannot see
 * it, and reporting them as failures would be the always-red gate that
 * `verify-excerpts.ts` was fixed to stop being.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/verify-quotes-against-raw.ts data/requirements/*.json
 */
import { readFileSync } from 'fs';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
// Imported ONLY to detect the client-rendered case this reading cannot cover.
// Nothing here uses the normalizer's text.
import { extractEmbeddedJsonText } from '../src/modules/visa-sync/normalize';

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

/** Tags out, entity references out, everything else left exactly as served. */
function rawText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+\d*;|&#\d+;|&#x[0-9a-f]+;/gi, ' ');
}

/** Letters and digits only. Whitespace and punctuation are not the question. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: verify-quotes-against-raw.ts <extraction.json>...');
  process.exit(2);
}

let checked = 0;
let failed = 0;
let skippedQuotes = 0;
/** Named, not just counted: a gap you cannot name is a gap you cannot close. */
const blocked: string[] = [];
const unavailable: string[] = [];
const clientRendered: string[] = [];
let retriedOk = 0;

async function run(path: string): Promise<void> {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Doc;
  const pages = new Map<string, string | null>();

  for (const [role, url] of Object.entries(doc.source_roles ?? {})) {
    if (!doc.requirements.some((r) => r.source_role === role)) continue;
    let r = await fetchSource(url, DEFAULT_FETCH_POLICY);

    // A transient failure and a standing refusal are different facts, and only
    // one of them is worth a human's attention. Two runs over this corpus
    // reported 9 and then 13 unreadable sources; the four that moved were
    // mom.gov.sg timing out under load, and every one of them served HTTP 200
    // when asked again a minute later. A count that changes run to run cannot
    // tell you whether a government stopped letting us read it.
    //
    // So `unavailable` (timeout, 5xx, connection error) is retried once after a
    // pause. `blocked` (403, robots disallow) is NOT retried: that is an answer,
    // not a hiccup, and asking twice neither changes it nor respects it.
    if (r.status === 'unavailable') {
      await new Promise((res) => setTimeout(res, 10_000));
      r = await fetchSource(url, DEFAULT_FETCH_POLICY);
      if (r.status === 'ok') retriedOk++;
    }

    if (r.status !== 'ok') {
      pages.set(role, null);
      (r.status === 'blocked' ? blocked : unavailable).push(
        `${doc.visaai_id} role=${role} (${r.status}) ${url}`,
      );
      continue;
    }
    if (extractEmbeddedJsonText(r.body) !== null) {
      // The words are in a JSON payload, not in the markup. Not a failure.
      pages.set(role, null);
      clientRendered.push(`${doc.visaai_id} role=${role} ${url}`);
      continue;
    }
    pages.set(role, squash(rawText(r.body)));
    await new Promise((res) => setTimeout(res, 3_000)); // polite between pages
  }

  let fileFailed = 0;
  for (const req of doc.requirements) {
    // The DISPLAY text is what a reader sees, so it is what gets checked.
    const quote = req.source_excerpt_display;
    if (!quote) continue;
    const page = pages.get(req.source_role);
    if (!page) {
      // A quotation this run could not check. Counted so the coverage claim is
      // "1,127 of 1,149", never a bare "0 failures" over an unstated subset.
      skippedQuotes++;
      continue;
    }
    checked++;

    const fragments = quote.split(' ... ').map(squash).filter(Boolean);
    let cursor = 0;
    let ok = true;
    for (const fragment of fragments) {
      const at = page.indexOf(fragment, cursor);
      if (at === -1) {
        ok = false;
        break;
      }
      cursor = at + fragment.length;
    }
    if (!ok) {
      console.error(
        `  NOT IN RAW  ${req.requirement_code} (role=${req.source_role})\n` +
          `      ${quote.replace(/\s+/g, ' ').slice(0, 140)}`,
      );
      fileFailed++;
      failed++;
    }
  }

  console.log(
    `${fileFailed === 0 ? 'OK' : `${fileFailed} NOT IN RAW`}  ${doc.visaai_id}`,
  );
}

async function main(): Promise<void> {
  for (const f of files) await run(f);

  for (const s of clientRendered) console.log(`  SKIPPED (client-rendered)  ${s}`);
  for (const s of blocked) console.log(`  SKIPPED (blocked)          ${s}`);
  for (const s of unavailable) console.log(`  SKIPPED (unavailable)      ${s}`);

  console.log(
    `\n${checked} quotation(s) checked against the raw page. ${failed} not found.\n` +
      `${skippedQuotes} quotation(s) NOT checked: ${clientRendered.length} source(s) ` +
      `client-rendered, ${blocked.length} blocked, ${unavailable.length} still ` +
      `unavailable after a retry.`,
  );
  if (retriedOk > 0) {
    console.log(
      `${retriedOk} source(s) failed once and succeeded on retry — counted as read, ` +
        'not as blocked.',
    );
  }
  if (skippedQuotes > 0) {
    console.log(
      'An unchecked quotation is not a passing one. The sources above were not ' +
        'read on this run,\nso their published text rests on the extraction alone.',
    );
  }
  if (unavailable.length > 0) {
    console.log(
      '\nA source that is still unavailable after a retry is worth a look: unlike a ' +
        'blocked one,\nnothing says the authority means to refuse us.',
    );
  }

  if (failed > 0) {
    console.error(
      '\nA quotation the raw page does not contain contiguously is either a splice —\n' +
        'asserting adjacency the page does not have — or mangled wording. Both are\n' +
        'invisible to verify-excerpts.ts, which reads the page the same way the\n' +
        'extraction did.',
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
