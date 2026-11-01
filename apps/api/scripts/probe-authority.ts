/**
 * Probe a candidate immigration authority for registry admission.
 *
 * WHY THIS EXISTS
 *
 * `docs/visa-data/COUNTRY_EXPANSION_RESEARCH.md` records five separate ways a
 * candidate destination has failed, and each one was discovered by hand after
 * the previous check passed. The checks are cumulative, so they belong in one
 * runnable place rather than in a paragraph somebody has to remember:
 *
 *   1. robots.txt readable, and the target paths ALLOWED for our own UA.
 *      Australia returns 403 on robots.txt itself — we cannot read what is
 *      permitted, so we stop. A 404 is different: conventionally no
 *      restrictions (Germany/BAMF).
 *   2. The page returns usable text TO US. make-it-in-germany.com renders in a
 *      browser and returns 94 characters server-side.
 *   3. The text carries requirement-shaped language, not just navigation.
 *   4. FRESHNESS: the page's own dateline, and the latest year its body
 *      mentions. A five-year-old page that presents as current is the German
 *      failure mode, and reachability checks cannot see it.
 *
 * A PASS here is permission to extract, not a decision to publish. The excerpt
 * verification and bounds checks still apply afterwards.
 *
 * AND A PASS SAYS NOTHING ABOUT THE CATALOGUE.
 *
 * These checks run against pages you already have URLs for. They cannot tell
 * you whether the authority's route INDEX can be read, and admission needs
 * both: §84 asks for exact official class/subclass/stream coverage, and the
 * rule is to read source URLs off the site rather than construct them.
 *
 * Check the index separately before recording a country as ready.
 *
 * AND CHECK IT AGAINST THE WHOLE RESPONSE, NOT THE RENDERED TEXT.
 *
 * Denmark used to be the worked example here: two leaf pages passed everything
 * below, its navigation looked entirely client-rendered, and there is no
 * sitemap.xml, so the permit list appeared unreadable. That was wrong twice over
 * — and it was wrong in a way this comment taught.
 *
 * nyidanmark.dk is a Sitecore-backed Angular app that hands its components data
 * server-side as JSON inside an HTML ATTRIBUTE:
 *
 *   <app-cards model="{&quot;LinkBoxes&quot;:[{&quot;Header&quot;:&quot;Short
 *   stay (visa)&quot;,&quot;LinkToPage&quot;:&quot;/en-GB/You-want-to-apply/
 *   Short-stay-visa&quot;}, ...]}">
 *
 * The server sends 25KB for a page whose visible text is one heading, and both
 * probes asked what it RENDERS rather than what it contains. Walking those
 * attributes enumerates 169 pages, all HTTP 200 — see
 * `scripts/visa-registry/dk-route-catalogue.mjs`.
 *
 * So "the catalogue is client-rendered" is a claim about a payload, and reading
 * the stripped text cannot support it. Before recording a country as
 * unenumerable, search the raw response for embedded JSON — script blocks,
 * `data-` attributes, and framework `model=` attributes alike.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/probe-authority.ts <url> [url...]
 */
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';
import { isAllowed } from '../src/modules/visa-sync/robots';

const UA = DEFAULT_FETCH_POLICY.userAgent;

/** Words that indicate a requirements page rather than a landing page. */
const REQUIREMENT_MARKERS = [
  'requirement', 'eligib', 'document', 'apply', 'fee', 'valid passport',
  // non-English equivalents seen in the registry so far
  'krav', 'ansök', 'ansøg', 'voraussetz', 'antrag', 'vereist', 'aanvraag',
  'hakemus', 'edellyt', 'exigence', 'demande', 'requisito', 'solicitud',
];

const robotsCache = new Map<string, { text: string | null; httpStatus: number | null }>();

async function robotsFor(origin: string) {
  const hit = robotsCache.get(origin);
  if (hit) return hit;
  const r = await fetchSource(`${origin}/robots.txt`, DEFAULT_FETCH_POLICY);
  const v =
    r.status === 'ok'
      ? { text: r.body, httpStatus: r.httpStatus }
      : { text: null, httpStatus: 'httpStatus' in r ? r.httpStatus : null };
  robotsCache.set(origin, v);
  return v;
}

/** The page's own self-declared modification date, if it publishes one. */
function declaredDate(html: string): string | null {
  const pats = [
    /"dateModified"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:last-?modified|dcterms\.modified|rek:moddate)["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

/** The latest year the BODY mentions. Beats the metadata when they disagree. */
function latestYearInText(text: string): number | null {
  const thisYear = new Date().getUTCFullYear();
  let best: number | null = null;
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(m[1]);
    if (y >= 2015 && y <= thisYear + 1 && (best === null || y > best)) best = y;
  }
  return best;
}

/**
 * Split text into comparable lines, so two pages from one site can be diffed.
 * Short fragments are dropped: menu labels and single words are noise either way,
 * and keeping them would let a long nav dominate the ratio in both directions.
 */
function contentLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length >= 25);
}

/**
 * How much of this page is NOT on its sibling.
 *
 * WHY THIS CHECK EXISTS
 *
 * `imi.gov.my` (Malaysia) passed every other check on this page and was wrong.
 * Its Employment Pass page returns 227KB of HTML normalizing to 10,922
 * characters, hits all five requirement markers, and mentions the current year.
 * It reads as a rich requirements page.
 *
 * It is a 820-line shared navigation menu with THREE unique lines of content.
 * The markers — "apply", "document", "fee", "requirement", "eligib" — are all
 * menu labels. The character count is the menu. Every page on the site scores
 * the same, because it IS the same.
 *
 * Character count cannot see this and neither can marker matching: both are
 * properties of one page in isolation, and boilerplate is by definition what
 * two pages have in common. So the check has to be comparative.
 */
function uniqueRatio(text: string, others: string[]): { ratio: number; uniqueLines: number; totalLines: number } {
  const mine = contentLines(text);
  const theirs = new Set(others.flatMap(contentLines));
  const unique = mine.filter((l) => !theirs.has(l));
  return {
    ratio: mine.length === 0 ? 0 : unique.length / mine.length,
    uniqueLines: unique.length,
    totalLines: mine.length,
  };
}

async function probe(url: string) {
  const origin = new URL(url).origin;
  const rb = await robotsFor(origin);

  let robotsVerdict: string;
  if (rb.text === null && rb.httpStatus === 404) {
    robotsVerdict = 'robots 404 — conventionally unrestricted';
  } else if (rb.text === null) {
    console.log(`\n=== ${url}`);
    /**
     * Two very different failures used to print the same line, and the
     * difference decides whose problem it is.
     *
     * An HTTP STATUS means the authority answered and refused. 403 on
     * robots.txt is Australia, Japan's MOFA and France-Visas: we cannot read
     * what is permitted, so we stop. That is their policy and no amount of
     * engineering changes it.
     *
     * NO status at all means the connection never completed — DNS resolved,
     * TCP connected, and the TLS handshake was reset. Portugal's vistos.mne.gov.pt
     * and aima.gov.pt do exactly that from the VPS in 0.22s while answering 200
     * from a laptop. That is not the authority refusing a bot; it is our egress
     * being dropped by source IP, the same shape as migri.fi. It is OUR problem
     * and it is fixable.
     *
     * Recording the second as "blocked by the authority" would file an
     * infrastructure fault as a permanent exception and quietly shrink the
     * world.
     */
    // A REDIRECT is not a refusal. robots.txt answering 301/302/307/308 means
    // "the file is elsewhere", and calling that "REFUSED" retires a candidate
    // country over a moved file. This is the third time this tool has been
    // wrong in the same way: 404 was read as refusal (it means unrestricted),
    // a dropped connection was read as refusal (it means our egress), and now a
    // redirect. HTTP statuses carry distinct meanings and bucketing them by
    // "not 200" throws every one of those meanings away.
    if (rb.httpStatus != null && rb.httpStatus >= 300 && rb.httpStatus < 400) {
      console.log(
        `  robots.txt REDIRECTS (http ${rb.httpStatus}) — not a refusal, the file moved.`,
      );
      console.log(
        `  Follow the redirect and probe the target before concluding anything.`,
      );
      return;
    }

    if (rb.httpStatus == null) {
      console.log(
        `  robots.txt UNREACHABLE — no HTTP status; the connection did not complete.`,
      );
      console.log(
        `  This is NOT evidence that the authority refuses us. Check the same URL`,
      );
      console.log(
        `  from a different egress before concluding: if it answers there, the block`,
      );
      console.log(`  is ours (BL-3), not theirs.`);
      return;
    }
    console.log(
      `  robots.txt REFUSED (http ${rb.httpStatus}) — STOP. We cannot read what is permitted.`,
    );
    console.log(
      `  The authority answered and declined. Confirm it behaves the same from another`,
    );
    console.log(
      `  egress — identical results from two paths mean policy, not IP reputation.`,
    );
    return;
  } else {
    const v = isAllowed(rb.text, url, UA);
    const disallows = (rb.text.match(/^\s*disallow:/gim) ?? []).length;
    if (!v.allowed) {
      console.log(`\n=== ${url}`);
      console.log(`  robots DISALLOWS this path (rule: ${v.matchedRule}) — STOP.`);
      return;
    }
    robotsVerdict = `robots 200, ${disallows} disallow lines, path ALLOWED${
      v.crawlDelaySeconds ? `, crawl-delay ${v.crawlDelaySeconds}s` : ''
    }`;
  }

  const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
  console.log(`\n=== ${url}`);
  console.log(`  ${robotsVerdict}`);
  if (r.status !== 'ok') {
    console.log(`  FETCH ${r.status}: ${JSON.stringify(r)}`);
    return undefined;
  }

  const text = normalizeContent(r.body, r.contentType);
  const lower = text.toLowerCase();
  const markers = REQUIREMENT_MARKERS.filter((m) => lower.includes(m));
  const dd = declaredDate(r.body);
  const yr = latestYearInText(text);

  console.log(`  http ${r.httpStatus}, ${r.bytes} bytes raw, ${text.length} chars normalized`);
  console.log(`  markers hit: ${markers.length ? markers.join(', ') : 'NONE'}`);
  console.log(`  declared date: ${dd ?? 'none published'}`);
  console.log(`  latest year in body: ${yr ?? 'none'}`);

  const verdict: string[] = [];

  if (text.length < 1500) verdict.push('THIN — likely JS-rendered; not extractable server-side');
  if (markers.length < 2) verdict.push('NO REQUIREMENT LANGUAGE — probably a landing page');
  if (dd && yr && new Date(dd).getUTCFullYear() < yr) {
    verdict.push(`DATE CONTRADICTED — metadata ${new Date(dd).getUTCFullYear()} < body ${yr}; treat metadata as unmaintained`);
  }
  if (dd && !Number.isNaN(new Date(dd).getTime())) {
    const months = (Date.now() - new Date(dd).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (months > 24) verdict.push(`STALE — self-declared ${months.toFixed(0)} months old`);
  }
  if (!dd && yr === null) verdict.push('NO FRESHNESS SIGNAL AT ALL — unknown, not fresh');

  console.log(`  VERDICT: ${verdict.length ? verdict.join(' | ') : 'READABLE and requirement-shaped'}`);
  return text;
}

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.error('usage: probe-authority.ts <url> [url...]');
    console.error('');
    console.error('Pass TWO OR MORE sibling pages from the same authority. The');
    console.error('boilerplate check needs something to compare against, and it is');
    console.error('the check that catches a navigation menu masquerading as content.');
    process.exit(2);
  }
  if (urls.length === 1) {
    console.log(
      'NOTE: one URL only. The boilerplate check is skipped — pass a sibling page\n' +
        'from the same site to find out whether the text is the page or the menu.',
    );
  }

  // Keyed by host: comparing across hosts would find nothing in common and
  // report every page as 100% unique.
  const byHost = new Map<string, { url: string; text: string }[]>();

  for (const u of urls) {
    try {
      const text = await probe(u);
      if (text) {
        const host = new URL(u).host;
        const list = byHost.get(host) ?? [];
        list.push({ url: u, text });
        byHost.set(host, list);
      }
    } catch (e) {
      console.log(`\n=== ${u}\n  ERROR ${(e as Error).message}`);
    }
  }

  // The boilerplate check runs at the END, against every OTHER page fetched on
  // the same host — not against the previous one. Comparing pairwise in order
  // made the result depend on argument order and let the first page off
  // entirely, which is how imi.gov.my's Employment Pass page passed: it was
  // listed first, so nothing was subtracted from it.
  for (const [host, pages] of byHost) {
    if (pages.length < 2) continue;
    console.log(`\n=== boilerplate check — ${host} (${pages.length} pages)`);
    for (const [i, p] of pages.entries()) {
      const others = pages.filter((_, j) => j !== i).map((o) => o.text);
      const u = uniqueRatio(p.text, others);
      const flag = u.uniqueLines < 8 ? '  <-- BOILERPLATE: this page is the menu' : '';
      console.log(
        `  ${u.uniqueLines}/${u.totalLines} lines unique (${(u.ratio * 100).toFixed(0)}%)  ${p.url}${flag}`,
      );
    }
    console.log(
      '  A page whose unique content is a handful of lines is a navigation shell.\n' +
        '  Its character count and its requirement markers both come from the menu,\n' +
        '  and neither check can see that from one page alone.',
    );
  }
}
main();
