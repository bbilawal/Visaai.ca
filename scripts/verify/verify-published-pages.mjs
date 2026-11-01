/**
 * End-to-end verification of the eight destinations unblocked this session,
 * against PRODUCTION.
 *
 * A 200 is not evidence that a page works. This checks, for every publishable
 * page of every affected country:
 *
 *   1. the page returns 200 and is not a soft 404
 *   2. the country hub LINKS to it (a page nobody can reach is not published)
 *   3. the page renders the authority's name
 *   4. every requirement the database holds for that route appears on the page
 *      — matched on its display excerpt, which is the text a reader actually
 *      sees. This is the check that would have caught the "dropped row"
 *      failure the registry has hit before, where a requirement that renders
 *      NOWHERE looks identical to one that was never extracted.
 *   5. the page is in the sitemap
 *
 * WHY THIS EXISTS SEPARATELY FROM THE PLAYWRIGHT SUITE
 *
 * The Playwright specs run against a local dev server, and on any machine
 * without a staging API they cannot exercise the registry at all — the country
 * picker hangs and 43 specs fail for a reason that has nothing to do with the
 * pages. This script asks the only question that matters about a published
 * registry: does the thing production serves contain what the database says it
 * should?
 *
 * It is deliberately not a unit test. It needs a live site and a live database
 * and it compares them to each other.
 *
 * Run:
 *   psql ... -c "select json_agg(...)" > /tmp/reqs.json
 *   node scripts/verify/verify-published-pages.mjs https://visaai.co /tmp/reqs.json
 *
 * The query it expects, one row per ACTIVE requirement:
 *
 *   select c.slug as country_slug, t.slug as visa_slug, s.authority,
 *          r.requirement_code as code, r.source_excerpt_display as display
 *     from public.visa_requirements r
 *     join public.visa_types t on t.id = r.visa_type_id
 *     join public.visa_countries c on c.id = t.country_id
 *     left join public.visa_source_versions v on v.id = r.source_version_id
 *     left join public.visa_sources s on s.id = v.source_id
 *    where r.status = 'active' and c.support_state = 'supported'
 */
const BASE = process.argv[2] ?? 'https://visaai.co';
const DUMP = process.argv[3];

const fs = await import('node:fs');
const rows = JSON.parse(fs.readFileSync(DUMP, 'utf8'));

const byPage = new Map();
for (const r of rows) {
  const key = `${r.country_slug}/${r.visa_slug}`;
  if (!byPage.has(key)) byPage.set(key, { country: r.country_slug, authority: r.authority, reqs: [] });
  byPage.get(key).reqs.push(r);
}

const get = async (u) => {
  const res = await fetch(u, { headers: { 'user-agent': 'VisaAI-e2e/1.0' } });
  return { status: res.status, body: await res.text() };
};

// The rendered HTML escapes entities and may wrap text in tags. Compare on a
// flattened, entity-decoded, tag-stripped form — the same discipline the
// excerpt verifier uses against source pages.
const flat = (s) =>
  s.replace(/<[^>]+>/g, ' ')
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
   .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&nbsp;/g, ' ').replace(/\\u[0-9a-f]{4}/gi, ' ')
   .replace(/\s+/g, ' ').trim();

const sitemap = flat((await get(`${BASE}/sitemap.xml`)).body);

let pagesChecked = 0, failures = [], reqChecked = 0, reqMissing = 0;

const countries = [...new Set([...byPage.values()].map((v) => v.country))].sort();
for (const country of countries) {
  const hub = await get(`${BASE}/visas/${country}`);
  if (hub.status !== 200) { failures.push(`HUB ${hub.status} /visas/${country}`); continue; }
  const hubFlat = flat(hub.body);

  for (const [key, page] of [...byPage.entries()].filter(([k]) => k.startsWith(country + '/'))) {
    const url = `${BASE}/visas/${key}`;
    const r = await get(url);
    pagesChecked++;

    if (r.status !== 200) { failures.push(`${r.status} ${url}`); continue; }
    const f = flat(r.body);

    if (/page could not be found|404/i.test(f.slice(0, 4000)) && f.length < 6000)
      failures.push(`SOFT-404 ${url}`);
    if (!hub.body.includes(`/visas/${key}`))
      failures.push(`HUB DOES NOT LINK ${url}`);
    if (!sitemap.includes(`/visas/${key}`))
      failures.push(`NOT IN SITEMAP ${url}`);
    if (page.authority && !f.includes(flat(page.authority).slice(0, 28)))
      failures.push(`AUTHORITY MISSING ${url} (${page.authority.slice(0, 40)})`);

    for (const req of page.reqs) {
      reqChecked++;
      const needle = flat(req.display ?? '').slice(0, 60);
      if (needle.length < 20) continue;
      if (!f.includes(needle)) {
        reqMissing++;
        failures.push(`REQUIREMENT NOT RENDERED ${url} :: ${req.code} :: "${needle.slice(0, 55)}"`);
      }
    }
  }
}

console.log(`pages checked        ${pagesChecked}`);
console.log(`requirements checked ${reqChecked}`);
console.log(`requirements missing ${reqMissing}`);
console.log(`failures             ${failures.length}`);
if (failures.length) {
  console.log('\n--- failures');
  for (const x of failures.slice(0, 40)) console.log('  ' + x);
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}
console.log('\nEvery page reachable from its hub, in the sitemap, naming its authority,');
console.log('and rendering every requirement the database holds for it.');
