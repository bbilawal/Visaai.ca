#!/usr/bin/env ts-node
/**
 * Report how long ago each registered source page was last changed BY ITS
 * AUTHORITY - not by us.
 *
 * WHY THIS EXISTS
 *
 * Every check in this repo asks whether a quote is faithful. None asks whether
 * the page is CURRENT. Those are different failures, and the second one is
 * invisible: a superseded government page states its old figures in exactly the
 * same confident voice as a fresh one, and our excerpt verifies against it
 * perfectly.
 *
 * Germany is the worked example. auswaertiges-amt.de publishes EU Blue Card
 * salary thresholds on an article dated 06.01.2021, and contradicts BAMF on the
 * settlement timeline (33 months vs 27). Fully readable, verifiable, and wrong.
 * It was caught only by reading the dateline.
 *
 * `visa_source_versions.fetched_at` cannot answer this: it records when WE
 * fetched, which is always recent, and says nothing about when the authority
 * last touched the page.
 *
 * WHAT IT READS
 *
 * A page's own published/modified metadata, in whatever convention its
 * government uses. These differ per authority and none is universal:
 *
 *   rek:moddate            Swedish government (Migrationsverket)
 *   article:modified_time  OpenGraph (Irish ISD)
 *   og:updated_time        OpenGraph
 *   dateModified           schema.org JSON-LD
 *   <time datetime="...">  HTML5
 *   "last update: <date>"  visible text (IND)
 *
 * Several authorities publish NOTHING - UDI and INZ among them. A missing date
 * is reported as unknown rather than assumed fresh, because "no signal" and
 * "recently updated" are not the same claim and collapsing them is how the
 * German page would have slipped through.
 *
 * BULK TIMESTAMPS ARE NOT CONTENT EDITS
 *
 * The first run of this script flagged twelve GOV.UK pages as 22 months stale.
 * They were not. Their dateModified values fall on one day within SECONDS of one
 * another - 2024-10-31T17:00:02 and 17:00:39 on two unrelated visas - which is a
 * platform-wide republish, not somebody editing visa rules. Irish ISD does the
 * same, to the second.
 *
 * A freshness tool that cries wolf gets muted, and a muted tool protects
 * nothing. So timestamps shared by several unrelated pages within one minute are
 * reported as site-wide republishes and excluded from the stale count: they say
 * nothing either way about whether the content is current.
 *
 * THE METADATA CAN ALSO BE TOO OLD, AND THAT IS WORSE
 *
 * Migrationsverket's EU Blue Card page declares rek:moddate 2025-02-19 while its
 * body reads "since 15 july 2026, the salary threshold is sek 53,625 per month".
 * A page cannot describe a change that post-dates its own last modification, so
 * the metadata is simply not maintained.
 *
 * This matters more than the GOV.UK case. A too-new timestamp merely hides
 * staleness; a too-old one manufactures it, and acting on it would mean
 * re-extracting current pages while trusting the metadata elsewhere.
 *
 * So every dated page is cross-checked against the LATEST YEAR MENTIONED IN ITS
 * OWN TEXT. If the body talks about a year after the metadata date, the metadata
 * is contradicted by the content and is reported as unreliable rather than as
 * age. Self-declared dates are evidence, not truth.
 *
 * Usage: ts-node scripts/check-source-freshness.ts [--months N]
 *        (--months sets the age at which a page is called out; default 18)
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';

const DIR = join(__dirname, '../../../data/requirements');

/** Ordered by trustworthiness: explicit modified beats published beats visible text. */
const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'rek:moddate', re: /rek:moddate"?\s+content="([^"]+)"/i },
  { label: 'article:modified_time', re: /article:modified_time"?\s+content="([^"]+)"/i },
  { label: 'og:updated_time', re: /og:updated_time"?\s+content="([^"]+)"/i },
  { label: 'dateModified', re: /"dateModified"\s*:\s*"([^"]+)"/i },
  { label: 'rek:pubdate', re: /rek:pubdate"?\s+content="([^"]+)"/i },
  { label: 'article:published_time', re: /article:published_time"?\s+content="([^"]+)"/i },
  { label: 'time[datetime]', re: /<time[^>]+datetime="([^"]+)"/i },
];

/** Visible datelines, used only when no metadata exists. */
const TEXT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'text "last update"', re: /last update[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i },
  { label: 'text "stand"', re: /stand[:\s]+(\d{1,2}\.\d{1,2}\.\d{4})/i },
  { label: 'text dd.mm.yyyy article', re: /(\d{2}\.\d{2}\.\d{4})\s*-?\s*artikel/i },
];

interface Row {
  visaai_id: string;
  role: string;
  url: string;
  date: Date | null;
  signal: string;
  /** Latest 4-digit year appearing in the page body, if any. */
  latestYearInText: number | null;
}

/**
 * The most recent year the page's own prose refers to. Used to catch metadata
 * that is older than the content it describes.
 *
 * Bounded to plausible years so that amounts like "sek 53,625" and phone numbers
 * cannot masquerade as dates.
 */
function latestYearIn(text: string): number | null {
  const years = [...text.matchAll(/\b(20[0-4]\d)\b/g)]
    .map((m) => Number(m[1]))
    .filter((y) => y >= 2000 && y <= new Date().getFullYear() + 2);
  return years.length ? Math.max(...years) : null;
}

function parseDate(raw: string): Date | null {
  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) return new Date(iso);
  // dd.mm.yyyy
  const de = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.trim());
  if (de) return new Date(`${de[3]}-${de[2]}-${de[1]}`);
  return null;
}

function detect(html: string, text: string): { date: Date | null; signal: string } {
  for (const { label, re } of PATTERNS) {
    const m = re.exec(html);
    if (m) {
      const d = parseDate(m[1]);
      if (d) return { date: d, signal: label };
    }
  }
  for (const { label, re } of TEXT_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const d = parseDate(m[1]);
      if (d) return { date: d, signal: label };
    }
  }
  return { date: null, signal: 'none published' };
}

function sources(): Array<{ visaai_id: string; role: string; url: string }> {
  const out: Array<{ visaai_id: string; role: string; url: string }> = [];
  const seen = new Set<string>();
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    if (typeof doc.visaai_id !== 'string') continue;
    for (const [role, url] of Object.entries(doc.source_roles ?? {})) {
      // One page can serve several visa types; fetch it once.
      if (seen.has(String(url))) continue;
      seen.add(String(url));
      out.push({ visaai_id: doc.visaai_id, role, url: String(url) });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const arg = process.argv.indexOf('--months');
  const thresholdMonths = arg === -1 ? 18 : Number(process.argv[arg + 1]);
  const now = Date.now();

  const rows: Row[] = [];
  for (const s of sources()) {
    const r = await fetchSource(s.url, DEFAULT_FETCH_POLICY);
    if (r.status !== 'ok') {
      rows.push({ ...s, date: null, signal: `UNFETCHABLE (${r.status})`, latestYearInText: null });
      continue;
    }
    const html = String(r.body ?? '');
    const text = normalizeContent(r.body, r.contentType);
    rows.push({ ...s, ...detect(html, text), latestYearInText: latestYearIn(text) });
    await new Promise((res) => setTimeout(res, 2_000)); // polite between pages
  }

  const months = (d: Date) => (now - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

  // A timestamp shared by several unrelated pages to the minute is a platform
  // republish, not an edit. Treat it as no signal rather than as staleness.
  const BULK_MIN_PAGES = 3;
  const byMinute = new Map<number, number>();
  for (const r of rows) {
    if (!r.date) continue;
    const minute = Math.floor(r.date.getTime() / 60_000);
    byMinute.set(minute, (byMinute.get(minute) ?? 0) + 1);
  }
  const isBulk = (d: Date) =>
    (byMinute.get(Math.floor(d.getTime() / 60_000)) ?? 0) >= BULK_MIN_PAGES;

  // The body refers to a year after the page's declared modification date, so
  // the page has been edited since and the metadata was not updated with it.
  const contradicted = (r: Row) =>
    r.date != null &&
    r.latestYearInText != null &&
    r.latestYearInText > r.date.getUTCFullYear();

  const bulk = rows.filter((r) => r.date && isBulk(r.date) && !contradicted(r));
  const unreliable = rows.filter((r) => r.date && contradicted(r));
  const dated = rows
    .filter((r) => r.date && !isBulk(r.date) && !contradicted(r))
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());
  const undated = rows.filter((r) => !r.date);

  console.log(`Checked ${rows.length} distinct source pages.\n`);
  console.log('OLDEST FIRST (age is since the AUTHORITY last changed the page):');
  for (const r of dated) {
    const age = months(r.date!);
    const flag = age >= thresholdMonths ? ' <-- STALE?' : '';
    console.log(
      `  ${r.date!.toISOString().slice(0, 10)}  ${String(Math.round(age)).padStart(3)}mo  ` +
        `${r.visaai_id}/${r.role}  [${r.signal}]${flag}`,
    );
  }

  if (unreliable.length > 0) {
    console.log(
      `\nMETADATA CONTRADICTED BY CONTENT (${unreliable.length}) - the page's own text` +
        `\nmentions a later year than its declared date, so the date is not maintained:`,
    );
    for (const r of unreliable) {
      console.log(
        `  declared ${r.date!.toISOString().slice(0, 10)} but text mentions ${r.latestYearInText}  ` +
          `${r.visaai_id}/${r.role}  [${r.signal}]`,
      );
    }
    console.log('  Treat these as UNKNOWN age, not as stale.');
  }

  if (bulk.length > 0) {
    const stamps = [...new Set(bulk.map((r) => r.date!.toISOString().slice(0, 16)))];
    console.log(
      `\nSITE-WIDE REPUBLISH (${bulk.length} pages across ${stamps.length} timestamp(s)) - NOT a content signal:`,
    );
    for (const stamp of stamps) {
      const group = bulk.filter((r) => r.date!.toISOString().slice(0, 16) === stamp);
      const hosts = [...new Set(group.map((r) => new URL(r.url).host))];
      console.log(`  ${stamp}  ${group.length} pages on ${hosts.join(', ')}`);
    }
    console.log('  These say nothing about whether the content is current.');
  }

  if (undated.length > 0) {
    console.log(`\nNO DATE PUBLISHED (${undated.length}) - unknown, NOT assumed fresh:`);
    for (const r of undated) console.log(`  ${r.visaai_id}/${r.role}  [${r.signal}]`);
  }

  const stale = dated.filter((r) => months(r.date!) >= thresholdMonths);
  console.log(
    `\n${stale.length} page(s) older than ${thresholdMonths} months.` +
      (stale.length
        ? '\nRe-read each one before trusting its figures, and cross-check one figure' +
          '\nagainst a second authority of the same government.'
        : ''),
  );
}

main();
