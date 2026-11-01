/**
 * HOST-LEVEL discovery pass for countries the registry cannot publish.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT probe-authority.ts
 *
 * `probe-authority.ts` answers "can I extract requirements from THIS page?".
 * It needs a URL you already have. Every country in
 * `docs/visa-data/GLOBAL_COVERAGE_EXCEPTIONS.md` failed at a step BEFORE that:
 * the one host we tried refused us, or served a shell, or never connected.
 *
 * The ledger's own history says that judgement was wrong four times out of
 * four, and wrong the same way each time — a null from ONE probe was read as a
 * fact about the COUNTRY:
 *
 *   UDI     — read the visible <select>, missed <input type="hidden" name="c">
 *   Sweden  — searched /English/, missed the English tree at /en/
 *   Ireland — stopped at a 2,717-char router, missed the 16,600-char page below
 *   Hong Kong — probed hk.gov.hk (robots unreadable) instead of immd.gov.hk
 *               (robots 404, unrestricted, 30 visa pages in one fetch)
 *
 * So this script asks a different question, one host at a time and across MANY
 * hosts per country: does ANY government host for this country answer, permit
 * us, and carry text?
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   - It does not circumvent anything. A bot challenge, a WAF 403 or a
 *     `Disallow: /` is recorded and obeyed. Rotating egress to defeat a
 *     challenge is bot-detection evasion (Bahrain, ledger 2026-08-26).
 *   - It does not enumerate a slug space. It reads sitemaps the site itself
 *     declares, plus the two conventional well-known paths. Probing to FIND a
 *     URL is fine; guessing what a page SAYS is not.
 *   - It does not conclude. Every field is a measurement; the verdict strings
 *     name the measurement, never the country.
 *
 * THREE MEASUREMENTS THE OLD PASS DID NOT TAKE
 *
 * 1. DNS is separated from connection. "No such host" and "host exists and the
 *    handshake was reset" have been recorded identically before (Yemen's four
 *    hosts, Syria's three) and they mean opposite things: the first says we
 *    named the wrong authority, the second says something sits in the path.
 *
 * 2. EMBEDDED JSON in the raw response. nyidanmark.dk hands its Angular
 *    components 25KB of route data inside an HTML attribute, and both earlier
 *    probes asked what the page RENDERS. "The catalogue is client-rendered" is
 *    a claim about a payload, and reading stripped text cannot support it.
 *    Six countries in the ledger are filed as `blocked_by_client_rendering` on
 *    exactly that reading.
 *
 * 3. SITEMAPS, and how many of their URLs look like visa routes. A site that
 *    serves a 900-character shell at its root may still declare 4,000 URLs.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/discover-authority-hosts.ts \
 *     [--iso AU,US] [--out artifacts/probe/host-discovery.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { promises as dns } from 'dns';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';
import { isAllowed } from '../src/modules/visa-sync/robots';

const UA = DEFAULT_FETCH_POLICY.userAgent;

/** Requirement-shaped language, in the languages these 19 countries publish in. */
const REQUIREMENT_MARKERS = [
  'requirement', 'eligib', 'document', 'apply', 'fee', 'valid passport', 'visa',
  'exigence', 'demande', 'séjour', 'titre de séjour', 'ressortissant',
  'requisito', 'autorização de residência', 'vistos',
  'متطلبات', 'تأشيرة', 'إقامة', 'جواز', 'وثائق', 'رسوم',
  'ویزا', 'روادید', 'گذرنامه',
  'ビザ', '査証', '在留', '申請', '必要書類',
  'วีซ่า', 'เอกสาร', 'คนต่างด้าว',
  'ויזה', 'אשרה', 'דרכון',
  'άδεια', 'θεώρηση', 'διαβατήριο',
];

/** Path fragments that mark a URL as a visa/immigration route rather than news. */
const VISA_PATH_HINTS = [
  'visa', 'visas', 'immigra', 'residen', 'permit', 'permis', 'sejour', 'séjour',
  'entry', 'entrada', 'foreigner', 'foreign-national', 'etranger', 'étranger',
  'passport', 'travel', 'consular', 'nationality', 'work-permit', 'stay',
  'vistos', 'estrangeiro', 'aufenthalt', 'iqama', 'eservices/visa',
];

type HostResult = {
  iso: string;
  country: string;
  host: string;
  role: string;
  dns: { a: string[]; aaaa: string[]; error: string | null };
  robots: {
    outcome: string;
    httpStatus: number | null;
    reason: string | null;
    disallowLines: number | null;
    rootAllowed: boolean | null;
    matchedRule: string | null;
    sitemapsDeclared: string[];
  };
  root: {
    outcome: string;
    httpStatus: number | null;
    reason: string | null;
    finalUrl: string | null;
    bytesRaw: number | null;
    charsNormalized: number | null;
    markers: string[];
    latestYear: number | null;
    embeddedJson: { kind: string; chars: number }[];
    challengeSignals: string[];
  };
  sitemaps: { url: string; outcome: string; httpStatus: number | null; urlCount: number; visaLikeCount: number; sampleVisaUrls: string[] }[];
  verdict: string;
};

async function resolveHost(host: string) {
  const out = { a: [] as string[], aaaa: [] as string[], error: null as string | null };
  try {
    out.a = await dns.resolve4(host);
  } catch (e: any) {
    out.error = e?.code ?? String(e);
  }
  try {
    out.aaaa = await dns.resolve6(host);
    if (out.aaaa.length) out.error = null;
  } catch {
    /* AAAA absence is normal; only record the v4 error */
  }
  return out;
}

/**
 * Cloudflare and friends answer 403 for two different reasons and the
 * difference decides what we are allowed to do about it. A POLICY refusal is
 * final. A BOT CHALLENGE is an invitation to prove we are a browser, and
 * accepting that invitation is evasion — so we record it precisely and stop.
 */
function challengeSignals(body: string, headersHint: string): string[] {
  const s: string[] = [];
  const b = body.slice(0, 4000).toLowerCase();
  if (b.includes('just a moment')) s.push('cf "Just a moment..." interstitial');
  if (b.includes('cf-browser-verification') || b.includes('cf_chl')) s.push('cf challenge script');
  if (b.includes('enable javascript and cookies to continue')) s.push('js+cookies gate');
  if (b.includes('incapsula') || b.includes('_incapsula_resource')) s.push('Imperva/Incapsula');
  if (b.includes('akamai') && b.includes('reference')) s.push('Akamai reference error');
  if (headersHint.toLowerCase().includes('cf-mitigated')) s.push('cf-mitigated header');
  return s;
}

/**
 * Look for data the server DID send but the renderer hides.
 *
 * Denmark's nyidanmark.dk is the worked example: 169 route pages live inside
 * `model="{&quot;LinkBoxes&quot;:[...]}"` attributes on a page whose visible
 * text is one heading. Six of the nineteen countries here are filed as
 * client-rendered on a reading of stripped text alone.
 */
function embeddedJson(raw: string): { kind: string; chars: number }[] {
  const found: { kind: string; chars: number }[] = [];
  const push = (kind: string, chars: number) => {
    if (chars < 400) return;
    const hit = found.find((f) => f.kind === kind);
    if (hit) hit.chars = Math.max(hit.chars, chars);
    else found.push({ kind, chars });
  };

  for (const m of raw.matchAll(/<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    push(m[0].includes('ld+json') ? 'script application/ld+json' : 'script application/json', m[1].length);
  }
  const nextData = raw.match(/id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) push('__NEXT_DATA__', nextData[1].length);
  for (const m of raw.matchAll(/window\.__[A-Z_]+__\s*=\s*(\{[\s\S]{400,}?\});/g)) {
    push('window.__STATE__ assignment', m[1].length);
  }
  // Sitecore/Angular style: JSON inside an HTML attribute, entity-encoded.
  for (const m of raw.matchAll(/\s(?:model|data-[\w-]+|ng-init)=["'](\{&quot;[\s\S]{400,}?)["']/g)) {
    push('JSON inside an HTML attribute (entity-encoded)', m[1].length);
  }
  for (const m of raw.matchAll(/\s(?:model|data-[\w-]+)=["'](\{"[\s\S]{400,}?)["']/g)) {
    push('JSON inside an HTML attribute (raw)', m[1].length);
  }
  return found.sort((a, b) => b.chars - a.chars).slice(0, 5);
}

function latestYearInText(text: string): number | null {
  const thisYear = new Date().getUTCFullYear();
  let best: number | null = null;
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(m[1]);
    if (y >= 2015 && y <= thisYear + 1 && (best === null || y > best)) best = y;
  }
  return best;
}

function looksVisaLike(url: string): boolean {
  const u = decodeURIComponent(url).toLowerCase();
  return VISA_PATH_HINTS.some((h) => u.includes(h));
}

async function readSitemap(url: string) {
  const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
  if (r.status !== 'ok') {
    return {
      url,
      outcome: r.status,
      httpStatus: 'httpStatus' in r ? r.httpStatus : null,
      urlCount: 0,
      visaLikeCount: 0,
      sampleVisaUrls: [] as string[],
    };
  }
  const locs = [...r.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
  const visa = locs.filter(looksVisaLike);
  return {
    url,
    outcome: 'ok',
    httpStatus: r.httpStatus,
    urlCount: locs.length,
    visaLikeCount: visa.length,
    sampleVisaUrls: visa.slice(0, 12),
    // A sitemap INDEX declares child sitemaps rather than pages; keep them so
    // a zero page-count does not read as "no pages".
    childSitemaps: /<sitemapindex/i.test(r.body) ? locs.slice(0, 25) : [],
  } as any;
}

async function probeHost(iso: string, country: string, host: string, role: string): Promise<HostResult> {
  const origin = `https://${host}`;
  const res: HostResult = {
    iso, country, host, role,
    dns: await resolveHost(host),
    robots: { outcome: 'not attempted', httpStatus: null, reason: null, disallowLines: null, rootAllowed: null, matchedRule: null, sitemapsDeclared: [] },
    root: { outcome: 'not attempted', httpStatus: null, reason: null, finalUrl: null, bytesRaw: null, charsNormalized: null, markers: [], latestYear: null, embeddedJson: [], challengeSignals: [] },
    sitemaps: [],
    verdict: '',
  };

  if (!res.dns.a.length && !res.dns.aaaa.length) {
    res.verdict = `DNS_FAILS (${res.dns.error ?? 'no address'}) — the host does not exist for us; this is evidence about the NAME, not about the country`;
    return res;
  }

  const rb = await fetchSource(`${origin}/robots.txt`, DEFAULT_FETCH_POLICY);
  res.robots.outcome = rb.status;
  res.robots.httpStatus = 'httpStatus' in rb ? rb.httpStatus : null;
  res.robots.reason = 'reason' in rb ? rb.reason : null;

  let robotsText: string | null = null;
  if (rb.status === 'ok') {
    robotsText = rb.body;
    res.robots.disallowLines = (robotsText.match(/^\s*disallow:/gim) ?? []).length;
    res.robots.sitemapsDeclared = [...robotsText.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    const v = isAllowed(robotsText, `${origin}/`, UA);
    res.robots.rootAllowed = v.allowed;
    res.robots.matchedRule = v.matchedRule ?? null;
    if (!v.allowed) {
      res.verdict = `ROBOTS_DISALLOWS_ROOT (rule: ${v.matchedRule}) — the authority publishes crawl rules and they say no. Obeyed.`;
      return res;
    }
  } else if (res.robots.httpStatus === 404) {
    res.robots.rootAllowed = true; // conventional: no restrictions
  } else if (res.robots.httpStatus != null && res.robots.httpStatus >= 300 && res.robots.httpStatus < 400) {
    res.verdict = `ROBOTS_REDIRECTS (${res.robots.httpStatus}) — the file moved or loops; not a refusal`;
    return res;
  } else if (res.robots.httpStatus != null) {
    res.verdict = `ROBOTS_REFUSED (http ${res.robots.httpStatus}) — we cannot read what is permitted, so we stop`;
    return res;
  } else {
    res.verdict = `ROBOTS_UNREACHABLE (${res.robots.reason ?? 'no HTTP status'}) — DNS resolved but nothing completed; not a refusal by anyone`;
    return res;
  }

  const r = await fetchSource(`${origin}/`, DEFAULT_FETCH_POLICY);
  res.root.outcome = r.status;
  res.root.httpStatus = 'httpStatus' in r ? r.httpStatus : null;
  res.root.reason = 'reason' in r ? r.reason : null;
  if (r.status === 'ok') {
    res.root.finalUrl = r.finalUrl;
    res.root.bytesRaw = r.bytes;
    const text = normalizeContent(r.body, r.contentType);
    res.root.charsNormalized = text.length;
    const lower = text.toLowerCase();
    res.root.markers = REQUIREMENT_MARKERS.filter((m) => lower.includes(m.toLowerCase()));
    res.root.latestYear = latestYearInText(text);
    res.root.embeddedJson = embeddedJson(r.body);
    res.root.challengeSignals = challengeSignals(r.body, '');
  }

  // Sitemaps the SITE declares first; the two well-known paths only as a fallback.
  const sitemapUrls = new Set<string>(res.robots.sitemapsDeclared);
  if (sitemapUrls.size === 0) {
    sitemapUrls.add(`${origin}/sitemap.xml`);
    sitemapUrls.add(`${origin}/sitemap_index.xml`);
  }
  for (const su of [...sitemapUrls].slice(0, 6)) {
    if (robotsText && !isAllowed(robotsText, su, UA).allowed) continue;
    res.sitemaps.push(await readSitemap(su));
  }

  const chars = res.root.charsNormalized ?? 0;
  const biggestJson = res.root.embeddedJson[0]?.chars ?? 0;
  const sitemapUrlTotal = res.sitemaps.reduce((a, s) => a + s.urlCount, 0);
  const sitemapVisaTotal = res.sitemaps.reduce((a, s) => a + s.visaLikeCount, 0);

  if (r.status !== 'ok' && res.root.challengeSignals.length) {
    res.verdict = `BOT_CHALLENGE (${res.root.challengeSignals.join('; ')}) — will not be circumvented`;
  } else if (r.status !== 'ok' && res.root.httpStatus != null) {
    res.verdict = `ROBOTS_PERMITS_SERVER_REFUSES (http ${res.root.httpStatus}) — the published rules say yes and the server says no; the refusal governs`;
  } else if (r.status !== 'ok') {
    res.verdict = `ROOT_UNREACHABLE (${res.root.reason ?? 'no status'}) — robots.txt answered but the page did not`;
  } else if (res.root.challengeSignals.length) {
    res.verdict = `BOT_CHALLENGE_BODY (${res.root.challengeSignals.join('; ')}) — 200 carrying an interstitial, not content`;
  } else if (chars >= 3000 && sitemapVisaTotal > 0) {
    res.verdict = `READABLE + SITEMAP (${chars} chars, ${sitemapVisaTotal}/${sitemapUrlTotal} visa-like URLs) — CANDIDATE`;
  } else if (chars >= 3000) {
    res.verdict = `READABLE (${chars} chars, no sitemap visa URLs) — enumerate its links`;
  } else if (biggestJson >= 2000) {
    res.verdict = `THIN TEXT BUT ${biggestJson} CHARS OF EMBEDDED JSON (${res.root.embeddedJson[0].kind}) — the Denmark condition; read the payload, not the render`;
  } else if (sitemapVisaTotal > 0) {
    res.verdict = `THIN ROOT (${chars} chars) BUT SITEMAP DECLARES ${sitemapVisaTotal}/${sitemapUrlTotal} visa-like URLs — probe those`;
  } else if (chars > 0) {
    res.verdict = `THIN (${chars} chars, no embedded payload, no sitemap) — consistent with client rendering`;
  } else {
    res.verdict = `ZERO CHARS SERVER-SIDE (${res.root.bytesRaw} bytes raw, ${biggestJson} chars embedded JSON)`;
  }
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const isoArg = args.includes('--iso') ? args[args.indexOf('--iso') + 1] : null;
  const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'artifacts/probe/host-discovery.json';
  const only = isoArg ? new Set(isoArg.split(',').map((s) => s.trim().toUpperCase())) : null;

  const specPath = resolve(__dirname, '../../../data/probe/blocked-country-candidates.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const countries = spec.countries.filter((c: any) => !only || only.has(c.iso));

  const results: HostResult[] = [];
  for (const c of countries) {
    console.log(`\n########## ${c.name} (${c.iso})`);
    console.log(`# ledger: ${c.known_verdict}`);
    for (const cand of c.candidates) {
      let r: HostResult;
      try {
        r = await probeHost(c.iso, c.name, cand.host, cand.role);
      } catch (e: any) {
        r = {
          iso: c.iso, country: c.name, host: cand.host, role: cand.role,
          dns: { a: [], aaaa: [], error: 'probe threw' },
          robots: { outcome: 'error', httpStatus: null, reason: String(e?.message ?? e), disallowLines: null, rootAllowed: null, matchedRule: null, sitemapsDeclared: [] },
          root: { outcome: 'error', httpStatus: null, reason: null, finalUrl: null, bytesRaw: null, charsNormalized: null, markers: [], latestYear: null, embeddedJson: [], challengeSignals: [] },
          sitemaps: [], verdict: `PROBE_ERROR: ${String(e?.message ?? e)}`,
        };
      }
      results.push(r);
      console.log(`  ${r.host.padEnd(48)} ${r.verdict}`);
      if (r.root.markers.length) console.log(`      markers: ${r.root.markers.slice(0, 8).join(', ')}  latestYear: ${r.root.latestYear ?? 'none'}`);
      for (const s of r.sitemaps) {
        if (s.urlCount || s.outcome === 'ok') {
          console.log(`      sitemap ${s.url} → ${s.outcome} ${s.httpStatus ?? ''} ${s.urlCount} urls, ${s.visaLikeCount} visa-like`);
          for (const u of s.sampleVisaUrls.slice(0, 6)) console.log(`         ${u}`);
        }
      }
    }
  }

  const outPath = resolve(process.cwd(), outArg);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ probedAt: new Date().toISOString(), userAgent: UA, results }, null, 2));
  console.log(`\nWrote ${results.length} host results → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
