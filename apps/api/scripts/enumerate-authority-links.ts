/**
 * Stage 2: enumerate an authority's OWN links and find its visa catalogue.
 *
 * Stage 1 (`discover-authority-hosts.ts`) answers "does any government host for
 * this country answer and permit us?". This answers the next question, and it
 * is the one the ledger got wrong four times: "where on that host does the
 * authority publish its routes?"
 *
 * THE RULE THIS ENFORCES
 *
 * Read source URLs OFF the site. Never construct them. Ireland was recorded as
 * blocked at a 2,717-char router with the 16,600-char page one link below it;
 * Kuwait was recorded blocked after a CONSTRUCTED service URL 404'd, and the
 * link the ministry actually publishes was right there on the home page.
 *
 * WHERE IT LOOKS, in order:
 *   1. <a href> in the served markup.
 *   2. URLs inside embedded JSON — script blocks, __NEXT_DATA__, and JSON
 *      inside HTML attributes. nyidanmark.dk publishes 169 routes this way and
 *      renders one heading. Six countries in the exceptions ledger are filed as
 *      "client-rendered" on a reading of stripped text alone, which cannot see
 *      this.
 *   3. Sitemap indexes, followed ONE level into their child sitemaps.
 *
 * Every candidate is then HEAD/GET-probed so the output distinguishes "the
 * authority links to this" from "this page exists and answers".
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/enumerate-authority-links.ts \
 *     --url https://www.uscis.gov/ [--url ...] [--depth 1] [--max 40] \
 *     [--out artifacts/probe/links-us.json]
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';
import { isAllowed } from '../src/modules/visa-sync/robots';

const UA = DEFAULT_FETCH_POLICY.userAgent;

/**
 * Path/anchor fragments that mark a link as a visa route.
 *
 * Deliberately WIDE. A narrow list is how Sweden's English tree was missed:
 * the search was for `/English/` and the tree is at `/en/`, so a null came back
 * and was read as absence. Over-matching costs a probe; under-matching costs a
 * country.
 */
const VISA_HINTS = [
  'visa', 'evisa', 'e-visa', 'immigra', 'migrat', 'residen', 'permit', 'permis',
  'sejour', 'séjour', 'entry', 'entrada', 'foreigner', 'foreign-national',
  'etranger', 'étranger', 'passport', 'consular', 'nationality', 'citizenship',
  'work-permit', 'workpermit', 'employment-pass', 'stay', 'sponsor', 'iqama',
  'vistos', 'estrangeiro', 'aufenthalt', 'student', 'study', 'travel',
  'تأشيرة', 'اقامة', 'إقامة', 'جواز', 'زيارة', 'تاشيرات',
  '在留', '査証', 'ビザ', '入国',
  'วีซ่า', 'ตรวจคนเข้าเมือง',
];

const REQUIREMENT_MARKERS = [
  'requirement', 'eligib', 'document', 'apply', 'fee', 'valid passport',
  'exigence', 'demande', 'pièce', 'justificatif',
  'requisito', 'documento',
  'متطلبات', 'شروط', 'وثائق', 'مستندات', 'رسوم',
  '必要書類', '要件', '申請',
  'เอกสาร', 'คุณสมบัติ', 'ค่าธรรมเนียม',
];

function looksVisaLike(url: string, anchorText: string): boolean {
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* keep raw when percent-encoding is broken */ }
  const hay = `${u} ${anchorText}`.toLowerCase();
  return VISA_HINTS.some((h) => hay.includes(h.toLowerCase()));
}

/** Links the authority publishes as markup. */
function anchorLinks(raw: string, base: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  for (const m of raw.matchAll(/<a\b[^>]*?href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      out.push({ url: new URL(m[1], base).toString(), text });
    } catch { /* a malformed href is not a finding */ }
  }
  return out;
}

/**
 * Links the authority SENDS but does not render.
 *
 * This is the check that would have caught Denmark, and it is why a
 * "client-rendered" verdict taken from stripped text is not trustworthy.
 * Scans the whole raw response for anything URL-shaped inside JSON, including
 * entity-encoded attribute payloads.
 */
function payloadLinks(raw: string, base: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const decoded = raw
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/');
  const seen = new Set<string>();
  // "…":"/some/path" and "…":"https://host/path" inside any JSON payload.
  for (const m of decoded.matchAll(/"(?:url|href|link|Url|Href|Link|LinkToPage|path|Path|slug|Slug)"\s*:\s*"([^"]{2,300})"/g)) {
    const v = m[1];
    if (!v.startsWith('/') && !/^https?:\/\//i.test(v)) continue;
    try {
      const abs = new URL(v, base).toString();
      if (!seen.has(abs)) { seen.add(abs); out.push({ url: abs, text: '(from embedded JSON)' }); }
    } catch { /* ignore */ }
  }
  return out;
}

async function readSitemapTree(url: string, robotsText: string | null, budget = 8): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [url];
  const pages: string[] = [];
  let fetched = 0;
  while (queue.length && fetched < budget) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (robotsText && !isAllowed(robotsText, next, UA).allowed) continue;
    const r = await fetchSource(next, DEFAULT_FETCH_POLICY);
    fetched++;
    if (r.status !== 'ok') continue;
    const locs = [...r.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
    if (/<sitemapindex/i.test(r.body)) queue.push(...locs);
    else pages.push(...locs);
  }
  return pages;
}

async function probeCandidate(url: string, robotsText: string | null) {
  if (robotsText && !isAllowed(robotsText, url, UA).allowed) {
    return { url, outcome: 'robots_disallows', httpStatus: null, chars: 0, markers: [] as string[], latestYear: null as number | null };
  }
  const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
  if (r.status !== 'ok') {
    return { url, outcome: r.status, httpStatus: 'httpStatus' in r ? r.httpStatus : null, chars: 0, markers: [], latestYear: null };
  }
  const text = normalizeContent(r.body, r.contentType);
  const lower = text.toLowerCase();
  const thisYear = new Date().getUTCFullYear();
  let latestYear: number | null = null;
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(m[1]);
    if (y >= 2015 && y <= thisYear + 1 && (latestYear === null || y > latestYear)) latestYear = y;
  }
  return {
    url,
    outcome: 'ok',
    httpStatus: r.httpStatus,
    chars: text.length,
    bytesRaw: r.bytes,
    markers: REQUIREMENT_MARKERS.filter((m) => lower.includes(m.toLowerCase())),
    latestYear,
  } as any;
}

async function main() {
  const args = process.argv.slice(2);
  const urls: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--url') urls.push(args[++i]);
  const max = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : 40;
  const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  if (!urls.length) { console.error('need at least one --url'); process.exit(2); }

  const report: any[] = [];

  for (const start of urls) {
    const origin = new URL(start).origin;
    const rb = await fetchSource(`${origin}/robots.txt`, DEFAULT_FETCH_POLICY);
    const robotsText = rb.status === 'ok' ? rb.body : null;
    const declaredSitemaps = robotsText
      ? [...robotsText.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
      : [];

    console.log(`\n########## ${start}`);
    if (robotsText && !isAllowed(robotsText, start, UA).allowed) {
      console.log('  robots DISALLOWS this path — stopping.');
      report.push({ start, error: 'robots_disallows' });
      continue;
    }

    const r = await fetchSource(start, DEFAULT_FETCH_POLICY);
    if (r.status !== 'ok') {
      console.log(`  FETCH ${r.status} ${'httpStatus' in r ? r.httpStatus : ''} — ${'reason' in r ? r.reason : ''}`);
      report.push({ start, error: `${r.status}` });
      continue;
    }

    const anchors = anchorLinks(r.body, r.finalUrl);
    const payload = payloadLinks(r.body, r.finalUrl);
    const sitemapPages = declaredSitemaps.length
      ? await readSitemapTree(declaredSitemaps[0], robotsText)
      : await readSitemapTree(`${origin}/sitemap.xml`, robotsText);

    const all = new Map<string, string>();
    for (const a of anchors) if (!all.has(a.url)) all.set(a.url, a.text);
    for (const p of payload) if (!all.has(p.url)) all.set(p.url, p.text);
    for (const s of sitemapPages) if (!all.has(s)) all.set(s, '(from sitemap)');

    const sameHost = [...all.entries()].filter(([u]) => {
      try { return new URL(u).hostname.endsWith(new URL(origin).hostname.replace(/^www\./, '')); } catch { return false; }
    });
    const candidates = sameHost.filter(([u, t]) => looksVisaLike(u, t));

    console.log(`  ${anchors.length} anchors, ${payload.length} payload links, ${sitemapPages.length} sitemap pages`);
    console.log(`  → ${sameHost.length} same-host links, ${candidates.length} visa-like`);

    const probes: any[] = [];
    for (const [u, t] of candidates.slice(0, max)) {
      const p = await probeCandidate(u, robotsText);
      probes.push({ ...p, anchorText: t });
      const flag = p.outcome === 'ok' && p.chars >= 3000 && p.markers.length >= 2 ? '  <<< SUBSTANTIVE' : '';
      console.log(`    [${String(p.httpStatus ?? p.outcome).padEnd(6)}] ${String(p.chars).padStart(6)} chars  ${p.markers.length} markers  ${u}${flag}`);
      if (t && t !== '(from sitemap)' && t !== '(from embedded JSON)') console.log(`             “${t.slice(0, 90)}”`);
    }

    report.push({
      start, origin,
      counts: { anchors: anchors.length, payload: payload.length, sitemapPages: sitemapPages.length, sameHost: sameHost.length, visaLike: candidates.length },
      declaredSitemaps,
      probes,
      allVisaLikeUrls: candidates.map(([u, t]) => ({ url: u, text: t })),
    });
  }

  if (outArg) {
    const outPath = resolve(process.cwd(), outArg);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ probedAt: new Date().toISOString(), userAgent: UA, report }, null, 2));
    console.log(`\nWrote → ${outPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
