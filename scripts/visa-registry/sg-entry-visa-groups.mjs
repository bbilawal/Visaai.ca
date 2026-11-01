#!/usr/bin/env node
/**
 * Re-prove which nationality groups ICA's entry-visa detail pages fall into.
 *
 * WHY THIS EXISTS
 *
 * ICA publishes ONE entry visa, and 33 per-nationality detail pages for it. The
 * obvious assumption — one template, one set of requirements, differing only in
 * the country name — is WRONG, and being wrong about it would put the single
 * most consequential Singapore requirement on the wrong applicants:
 *
 *   * 19 nationalities must submit "a completed form v39a ... (letter of
 *     introduction for visa application (loi)), which may be issued by a local
 *     contact* in singapore", where the local contact must be a Singapore
 *     citizen or PR aged 21+ with a Singpass account.
 *   * 14 nationalities are told only that additional documents "may be required
 *     on a case-by-case basis".
 *
 * A checklist that flattened those two into one would either invent a sponsor
 * requirement for 14 nationalities or delete a hard one for 19.
 *
 * `sg-entry-visa` therefore registers ONE representative page per group. That is
 * a real limitation — the daily monitor watches 2 of 33 pages, so a change ICA
 * makes to a page outside the two is invisible to it. This script is the answer
 * to that: it re-derives the grouping from all 33 pages, so the claim in
 * `data/requirements/sg-entry-visa.json` can be re-checked rather than trusted.
 *
 * Run it when the monitor flags a change on either registered page, and on any
 * review of Singapore's coverage.
 *
 * Usage:
 *   node scripts/visa-registry/sg-entry-visa-groups.mjs
 *
 * Exits 1 if the grouping is no longer 2 groups with the recorded membership.
 */

const BASE =
  'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/';

/** Read off ICA's own hub page, 2026-08-23, not typed from memory. */
const NATIONALITIES = [
  'afghanistan', 'algeria', 'armenia', 'azerbaijan', 'bangladesh', 'belarus',
  'egypt', 'georgia', 'india', 'iran', 'iraq', 'jordan', 'kazakhstan', 'kosovo',
  'kyrgyzstan', 'lebanon', 'libya', 'mali', 'moldova', 'morocco', 'nigeria',
  'pakistan', 'russia', 'somalia', 'south-sudan', 'sudan', 'syria', 'tajikistan',
  'tunisia', 'turkmenistan', 'ukraine', 'uzbekistan', 'yemen',
];

/**
 * The grouping as verified on 2026-08-23. `democratic-people's-republic-of-korea`
 * is on ICA's list but its slug carries an apostrophe that the site emits
 * HTML-escaped; it is excluded here rather than guessed at, and the count below
 * says 33 not 34 for that reason.
 */
const EXPECTED = {
  loi_required: [
    'afghanistan', 'algeria', 'bangladesh', 'egypt', 'iran', 'iraq', 'kosovo',
    'lebanon', 'libya', 'mali', 'morocco', 'nigeria', 'pakistan', 'somalia',
    'south-sudan', 'sudan', 'syria', 'tunisia', 'yemen',
  ],
  loi_case_by_case: [
    'armenia', 'azerbaijan', 'belarus', 'georgia', 'india', 'jordan',
    'kazakhstan', 'kyrgyzstan', 'moldova', 'russia', 'tajikistan',
    'turkmenistan', 'ukraine', 'uzbekistan',
  ],
};

const UA = 'Mozilla/5.0 (compatible; VisaAI-SourceMonitor/1.0; +https://visaai.co/bot)';

const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

/**
 * The substantive block only: from "documents required" to "related links".
 * Everything outside it is chrome, and the country name in the heading would
 * otherwise make all 33 pages look distinct.
 */
function substantive(page) {
  const i = page.indexOf('documents required');
  const j = page.indexOf('related links');
  return i >= 0 && j > i ? page.slice(i, j) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = { loi_required: [], loi_case_by_case: [] };
const problems = [];

for (const n of NATIONALITIES) {
  let page;
  try {
    const res = await fetch(BASE + n, { headers: { 'user-agent': UA } });
    if (!res.ok) {
      problems.push(`${n}: HTTP ${res.status}`);
      await sleep(400);
      continue;
    }
    page = text(await res.text());
  } catch (e) {
    problems.push(`${n}: ${e.message}`);
    await sleep(400);
    continue;
  }

  const body = substantive(page);
  if (!body) {
    problems.push(`${n}: page structure changed — no "documents required".."related links" block`);
  } else if (body.includes('a completed form v39a')) {
    found.loi_required.push(n);
  } else if (body.includes('may be required on a case-by-case basis')) {
    found.loi_case_by_case.push(n);
  } else {
    problems.push(`${n}: matches NEITHER group — a third variant now exists`);
  }

  await sleep(400); // ICA publishes no Crawl-delay; this is our own restraint.
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
let failed = problems.length > 0;

for (const group of ['loi_required', 'loi_case_by_case']) {
  const got = [...found[group]].sort();
  const want = [...EXPECTED[group]].sort();
  console.log(`${group}: ${got.length} (expected ${want.length})`);
  if (!same(got, want)) {
    failed = true;
    const added = got.filter((x) => !want.includes(x));
    const gone = want.filter((x) => !got.includes(x));
    if (added.length) console.log(`  MOVED IN:  ${added.join(', ')}`);
    if (gone.length) console.log(`  MOVED OUT: ${gone.join(', ')}`);
  }
}

if (problems.length) {
  console.log('\nproblems:');
  for (const p of problems) console.log(`  - ${p}`);
}

if (failed) {
  console.log(
    '\nFAIL — the grouping recorded in data/requirements/sg-entry-visa.json no longer holds.\n' +
      'Re-read both registered pages before publishing anything that depends on it.',
  );
  process.exit(1);
}

console.log('\nOK — 2 groups, membership unchanged. The registered pages still represent them.');
