#!/usr/bin/env ts-node
/**
 * Prove a bounded extraction really was read from the section it claims.
 *
 * WHY THIS EXISTS, AND WHY verify-excerpts.ts IS NOT ENOUGH
 *
 * `verify-excerpts.ts` proves a quote appears ON the page. That is necessary and
 * insufficient. Some authority pages concatenate many sibling routes under one
 * URL, each with near-identical wording:
 *
 *   * UDI's family-immigration page is 21,998 characters holding 8+ family
 *     categories -- spouse, cohabitant, fiance(e), children, parents -- and the
 *     heading "how to apply" occurs 8+ times.
 *   * UDI's work-immigration page concatenates 5 worker categories, where
 *     NOK 341,373 belongs to ATHLETES and not to skilled workers.
 *
 * On the spouse extraction, 5 of 9 excerpts appear verbatim in a sibling
 * category too. Excerpt verification passes them identically whether they were
 * read from the right block or the wrong one, so a mis-attributed requirement
 * -- "cohabitants must have lived together two years" filed under spouses --
 * verifies clean and is still false.
 *
 * The bound is the only thing that distinguishes them, so the bound has to be
 * checkable rather than a sentence in structure_note that no build step reads.
 *
 * ANCHORS, NOT CHARACTER OFFSETS
 *
 * The first version of this check used raw offsets (3709-5557). Those are
 * correct exactly until the authority edits any earlier part of the page, at
 * which point every offset shifts and the check either fails spuriously or --
 * far worse -- silently slides onto a neighbouring category and keeps passing.
 *
 * So bounds are declared as text anchors and resolved at check time:
 *
 *   "source_bounds": {
 *     "requirements": {
 *       "starts_at":  "spouse or registered partner",
 *       "ends_before": "cohabitant",
 *       "note": "the spouse block; ends where the cohabitant heading begins"
 *     }
 *   }
 *
 * `ends_before` is resolved as the first occurrence AFTER the start anchor, so
 * a word that recurs later in the page is still a usable terminator.
 *
 * A file with no `source_bounds` is not an error -- most pages describe one
 * route and need no bound. This checks the files that make the claim.
 *
 * Usage: ts-node scripts/verify-extraction-bounds.ts <extraction.json>...
 */
import { readFileSync } from 'fs';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';

/** Same comparison verify-excerpts uses: a line break must not be a mismatch. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Bound {
  starts_at: string;
  ends_before?: string;
  note?: string;
}
interface Doc {
  visaai_id: string;
  source_roles: Record<string, string>;
  source_bounds?: Record<string, Bound>;
  requirements: Array<{ requirement_code: string; source_role: string; source_excerpt: string }>;
}

async function verifyFile(path: string): Promise<number> {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Doc;
  const bounds = doc.source_bounds ?? {};
  if (Object.keys(bounds).length === 0) {
    console.log(`SKIP  ${doc.visaai_id}  (declares no bounds)`);
    return 0;
  }

  let failures = 0;
  let ambiguous = 0;

  for (const [role, bound] of Object.entries(bounds)) {
    const url = doc.source_roles[role];
    if (!url) {
      console.error(`  UNDECLARED ROLE  bounds name role "${role}", which has no source`);
      failures++;
      continue;
    }

    const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
    if (r.status !== 'ok') {
      console.error(`  UNFETCHABLE  role=${role} (${r.status}) ${url}`);
      failures++;
      continue;
    }
    const page = flat(normalizeContent(r.body, r.contentType));

    const start = page.indexOf(flat(bound.starts_at));
    if (start === -1) {
      console.error(`  ANCHOR GONE  role=${role} starts_at not on page: "${bound.starts_at}"`);
      failures++;
      continue;
    }
    // A start anchor that recurs cannot identify a section unambiguously.
    if (page.indexOf(flat(bound.starts_at), start + 1) !== -1) {
      console.error(`  ANCHOR NOT UNIQUE  role=${role} starts_at occurs more than once: "${bound.starts_at}"`);
      failures++;
      continue;
    }

    let end = page.length;
    if (bound.ends_before) {
      const at = page.indexOf(flat(bound.ends_before), start + 1);
      if (at === -1) {
        console.error(`  ANCHOR GONE  role=${role} ends_before not found after start: "${bound.ends_before}"`);
        failures++;
        continue;
      }
      end = at;
    }

    const block = page.slice(start, end);
    const outside = page.slice(0, start) + ' @@CUT@@ ' + page.slice(end);
    console.log(`  bound role=${role}  ${end - start} chars${bound.note ? `  (${bound.note})` : ''}`);

    for (const req of doc.requirements.filter((x) => x.source_role === role)) {
      const frags = flat(req.source_excerpt).split(/ \.\.\. /).filter(Boolean);
      // Fragments must appear in order WITHIN the block, mirroring verify-excerpts.
      let cursor = 0;
      let inBlock = true;
      for (const f of frags) {
        const at = block.indexOf(f, cursor);
        if (at === -1) { inBlock = false; break; }
        cursor = at + f.length;
      }
      if (!inBlock) {
        console.error(`  OUTSIDE BOUND  ${req.requirement_code} (role=${role})`);
        console.error(`      claimed: ${flat(req.source_excerpt).slice(0, 140)}`);
        failures++;
        continue;
      }
      // Not a failure: the whole reason the bound exists. Reported so the count
      // of quotes that would verify identically from a sibling stays visible.
      if (frags.every((f) => outside.includes(f))) ambiguous++;
    }
  }

  const counted = doc.requirements.filter((x) => x.source_role in bounds).length;
  const verdict = failures === 0 ? 'OK' : `${failures} PROBLEM(S)`;
  console.log(
    `${verdict}  ${doc.visaai_id}  (${counted} bounded excerpts` +
      (ambiguous > 0
        ? `; ${ambiguous} also appear verbatim outside the bound and are correct ONLY because of it)`
        : ')'),
  );
  return failures;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: verify-extraction-bounds.ts <extraction.json>...');
    process.exit(2);
  }
  let failures = 0;
  for (const f of files) failures += await verifyFile(f);
  if (failures > 0) {
    console.error(`\n${failures} bound problem(s). A requirement may be attributed to the wrong route.`);
    process.exit(1);
  }
  console.log('\nEvery bounded excerpt lies inside the section its file declares.');
}
main();
