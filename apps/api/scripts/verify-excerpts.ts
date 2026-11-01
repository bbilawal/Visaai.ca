/**
 * Prove every `source_excerpt` in a requirements file is verbatim government wording.
 *
 * WHY THIS IS A SCRIPT AND NOT A PROMISE
 *
 * `generate-requirements.mjs` refuses to emit a requirement without an excerpt,
 * because the excerpt is the evidence a reviewer checks the claim against. But
 * nothing ever checked that the excerpt was actually ON the page. Every
 * extraction so far has asserted "verified verbatim" as prose in a commit
 * message — which is exactly the kind of claim that is worth nothing the day it
 * stops being true.
 *
 * An excerpt that has drifted from the source is worse than a missing one: it
 * looks like evidence, so a reviewer approves it without re-reading the page.
 *
 * This re-fetches each source and checks each excerpt against the normalized
 * text. Two forms are accepted, and the difference between them is the whole
 * point:
 *
 *   * A plain excerpt must appear as a CONTIGUOUS substring. Stitching two
 *     distant sentences together produces a quote the government never wrote
 *     while reading as though it did — that is the failure this rejects.
 *   * An excerpt may declare an omission with a literal ` ... `. Each fragment
 *     must then appear, IN ORDER, on the same page. This is the ordinary
 *     convention for quoting a bullet list without reproducing all of it, and
 *     it is honest precisely because the reader can see something was cut.
 *
 * So the rule is not "no elision". It is "no UNDECLARED elision". A quote that
 * hides its cuts asserts adjacency the source does not support; a quote that
 * marks them asserts only what it shows.
 *
 * TWO KINDS OF PROBLEM, AND ONLY ONE OF THEM IS A LIE
 *
 * This script used to count both of these as one number and exit 1 on either:
 *
 *   * DRIFT   — the page was read and the quote is not on it. The registry is
 *               asserting something the government does not say. Unpublishable.
 *   * UNREADABLE — the page could not be fetched at all, so nothing was
 *               checked. `immi.homeaffairs.gov.au` returns 403 to an identified
 *               agent, which is why 16 Australian visa types have no active
 *               requirements and publish nothing.
 *
 * Conflating them made a full-repo run permanently red for a reason nobody can
 * fix, on routes that publish nothing anyway — and a gate that is always red is
 * a gate nobody reads. Worse, real drift would have been invisible inside the
 * Australian noise.
 *
 * So drift always fails. Unreadable sources are reported, counted separately,
 * and named in the summary, but do not fail the run unless `--require-readable`
 * is passed. Use that flag when you need to prove that every source behind a
 * PUBLISHED page is still readable — from the host that will actually sync it.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/verify-excerpts.ts data/requirements/ca-*.json
 *   npx ts-node -P tsconfig.json scripts/verify-excerpts.ts --require-readable data/requirements/*.json
 */
import { readFileSync } from 'fs';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';

interface Requirement {
  requirement_code: string;
  source_role: string;
  source_excerpt: string;
}
interface Doc {
  visaai_id: string;
  source_roles: Record<string, string>;
  requirements: Requirement[];
}

/** Compare the way a reader would: collapse whitespace, so a line break is not a mismatch. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Does `excerpt` appear on `page`, allowing only elisions it declares with ` ... `?
 *
 * Fragments must match IN ORDER and without overlapping, so an excerpt cannot
 * quietly reverse the source's sequence or reuse one run of text twice.
 */
function appearsOnPage(page: string, excerpt: string): boolean {
  const fragments = flat(excerpt).split(/ \.\.\. /).filter((f) => f.length > 0);
  let cursor = 0;
  for (const fragment of fragments) {
    const at = page.indexOf(fragment, cursor);
    if (at === -1) return false;
    cursor = at + fragment.length;
  }
  return true;
}

interface Result {
  /** The quote is not on the page we read. The registry is asserting a lie. */
  drift: number;
  /** The page could not be read at all, so nothing was checked either way. */
  unreadable: number;
}

async function verifyFile(path: string): Promise<Result> {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Doc;
  const texts = new Map<string, string>();
  let drift = 0;
  let unreadable = 0;

  for (const [role, url] of Object.entries(doc.source_roles)) {
    if (!doc.requirements.some((r) => r.source_role === role)) continue;
    const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
    if (r.status !== 'ok') {
      console.error(`  UNREADABLE  role=${role} (${r.status}) ${url}`);
      unreadable++;
      continue;
    }
    texts.set(role, flat(normalizeContent(r.body, r.contentType)));
    await new Promise((res) => setTimeout(res, 3_000)); // polite between pages
  }

  for (const req of doc.requirements) {
    const text = texts.get(req.source_role);
    if (text === undefined) {
      // Either the role is unfetchable (already counted) or it is not declared.
      if (!(req.source_role in doc.source_roles)) {
        // A role no source declares is an authoring error, not a network one:
        // the excerpt can never be checked against anything. That is drift.
        console.error(`  UNDECLARED ROLE  ${req.requirement_code} -> "${req.source_role}"`);
        drift++;
      }
      continue;
    }
    if (!appearsOnPage(text, req.source_excerpt)) {
      console.error(`  NOT VERBATIM  ${req.requirement_code} (role=${req.source_role})`);
      console.error(`      claimed: ${flat(req.source_excerpt).slice(0, 160)}`);
      drift++;
    }
  }

  const parts: string[] = [];
  if (drift > 0) parts.push(`${drift} DRIFTED`);
  if (unreadable > 0) parts.push(`${unreadable} UNREADABLE`);
  const verdict = parts.length === 0 ? 'OK' : parts.join(' + ');
  console.log(`${verdict}  ${doc.visaai_id}  (${doc.requirements.length} excerpts)`);
  return { drift, unreadable };
}

async function main() {
  const args = process.argv.slice(2);
  const requireReadable = args.includes('--require-readable');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) throw new Error('Pass one or more requirements JSON files.');

  let drift = 0;
  let unreadable = 0;
  for (const f of files) {
    const r = await verifyFile(f);
    drift += r.drift;
    unreadable += r.unreadable;
  }

  if (unreadable > 0) {
    console.error(
      `\n${unreadable} source(s) could not be read, so their excerpts were NOT checked.\n` +
        'That is not evidence the quotes are wrong — it is the absence of evidence\n' +
        'either way. A source that stays unreadable belongs in the coverage matrix as\n' +
        'BLOCKED BY OFFICIAL SOURCE, publishing nothing, not in a verification report.\n' +
        'See docs/operations/SOURCE_ACCESS.md.',
    );
  }

  if (drift > 0) {
    console.error(
      `\n${drift} excerpt(s) are NOT on the page they cite. These are unpublishable as-is.`,
    );
    process.exit(1);
  }

  if (unreadable > 0 && requireReadable) {
    console.error('\n--require-readable was passed, so unreadable sources fail the run.');
    process.exit(1);
  }

  const suffix = unreadable > 0 ? ` (${unreadable} source(s) unreadable, see above)` : '';
  console.log(
    `\nEvery excerpt that could be checked is verbatim: contiguous, or elided only where declared${suffix}.`,
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
