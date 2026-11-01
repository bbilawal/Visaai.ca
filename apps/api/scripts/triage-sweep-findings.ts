#!/usr/bin/env ts-node
/**
 * Triage the form-sweep queue with EVIDENCE instead of a keyword hunch.
 *
 * WHY
 *
 * `docs/operations/FORM_SWEEP_TRIAGE.md` records 257 open findings grouped into
 * three buckets by a keyword heuristic, and says plainly that the grouping "is a
 * reading aid, not a decision". Nothing had been dismissed, correctly:
 * `ignored` is terminal, and dismissing 257 government forms in an immigration
 * product on a keyword match is clearing a queue by deleting the question.
 *
 * The migration that closed 8 of them used the one basis that needs no
 * judgement — the form code is cited by an ACTIVE visa requirement, so the form
 * already reaches applicants. That basis is now exhausted: re-running it against
 * the remaining 257 matches nothing.
 *
 * This adds the next basis that is still a measurement rather than an opinion:
 *
 *   does any OFFICIAL PAGE VisaAI already tracks name this form?
 *
 * A form named on a page in `visa_sources` is, by the registry's own reckoning,
 * part of a route VisaAI covers. That is not proof it must be ingested, but it
 * is a fact about the authority's own publishing, and it splits the queue into
 * "the government links this from a page we already read" and "no page we track
 * mentions it at all" — two piles a person can work through differently.
 *
 * WHAT IT WILL NOT DO
 *
 * It never writes `ignored`. Absence of a mention is weak evidence: VisaAI
 * tracks 6 pages for Canada, not the whole of canada.ca, so "unmentioned" mostly
 * means "we do not read the page that would mention it". Marking those terminal
 * would convert our own coverage gap into a decision about a government form.
 *
 * Findings with evidence are marked `acknowledged` — the schema's "seen it,
 * still open" state — with the citing URL in the note. Nothing becomes `added`,
 * because `added` should mean the template was actually ingested and this
 * script ingests nothing.
 *
 * AND THE MENTION HAS TO BE IN THE PAGE, NOT IN THE SITE FURNITURE
 *
 * The first run of this script reported 25 cited findings, and most of them were
 * wrong in a specific way: uscis.gov prints a "most accessed forms" menu on
 * every page, so I-9, I-90, N-400 and I-129F appeared on all six USCIS pages we
 * track — identically, in the navigation, at the same offset. A signal that
 * fires from a site menu says nothing about the route.
 *
 * That is the same shape as the "site-wide republish" rule in
 * check-source-freshness.ts, and it gets the same treatment: a match is
 * discarded when the 160-character window around it appears VERBATIM on three or
 * more other pages from the same host. Repeated text is furniture. Anything that
 * survives is a sentence written about this page — "you may need to file form
 * i-824" — and IRCC's eTA page naming the US forms I-90, I-751 and I-829 as
 * proof of permanent residence survives it, correctly.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx ts-node -P tsconfig.json scripts/triage-sweep-findings.ts [--write]
 *
 * Without --write it prints the report and changes nothing.
 */
import './lib/node20-websocket';
import { createClient } from '@supabase/supabase-js';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';
import { isAllowed } from '../src/modules/visa-sync/robots';

const PER_HOST_DELAY_MS = 2_000;

interface Finding { id: string; authority: string; code: string; title: string; url: string }
interface Source { id: string; source_url: string; role: string }

/**
 * Match a form code the way a government page writes it.
 *
 * IRCC prints "IMM 5257" and also "IMM5257"; USCIS prints "I-539" and "Form
 * I-539". Comparing the raw code alone misses half of them, and comparing
 * loosely matches too much: bare "I-9" would hit "section I-9" and any
 * "IMM 1" would be a substring of "IMM 1000". So the code is normalised to
 * alphanumerics and matched against the page with optional separators, bounded
 * on both sides so a longer code cannot swallow a shorter one.
 */
function codeRegex(code: string): RegExp {
  const parts = code.trim().toUpperCase().match(/[A-Z]+|\d+/g) ?? [];
  if (parts.length === 0) return /$^/;
  const body = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]?');
  return new RegExp(`(?<![A-Z0-9])${body}(?![A-Z0-9])`, 'i');
}

const flat = (t: string) => t.replace(/\s+/g, ' ');

/** How many of a host's other pages carry this exact stretch of text. */
const WINDOW = 80;
const FURNITURE_AT = 3;

/**
 * Classify a code's appearances on one page.
 *
 * 'none'      the code is not on the page
 * 'furniture' every appearance sits inside text repeated across the host
 * 'body'      at least one appearance is in text unique to this page
 */
function findRealMention(
  text: string,
  re: RegExp,
  siblings: Array<{ text: string }>,
): 'none' | 'furniture' | 'body' {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let seen = false;
  while ((m = re.exec(text))) {
    seen = true;
    const window = text.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW);
    const repeats = siblings.filter((s) => s.text.includes(window)).length;
    if (repeats < FURNITURE_AT) return 'body';
  }
  return seen ? 'furniture' : 'none';
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  const write = process.argv.includes('--write');

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: findingRows, error: fErr } = await db
    .from('template_sweep_findings')
    .select('id, authority, code, title, url')
    .eq('status', 'new')
    .order('authority')
    .order('code');
  if (fErr) throw new Error(fErr.message);
  const findings = (findingRows ?? []) as Finding[];

  const { data: sourceRows, error: sErr } = await db
    .from('visa_sources')
    .select('id, source_url, role')
    .eq('active', true)
    .neq('robots_state', 'disallowed');
  if (sErr) throw new Error(sErr.message);
  const sources = (sourceRows ?? []) as Source[];

  console.log(`${findings.length} open findings; ${sources.length} readable registered sources.\n`);

  const patterns = findings.map((f) => ({ f, re: new RegExp(codeRegex(f.code), 'gi') }));
  const citedBy = new Map<string, string[]>();
  const pages: Array<{ url: string; host: string; text: string }> = [];

  const robotsCache = new Map<string, string | null>();
  const lastHit = new Map<string, number>();
  let read = 0;
  let unreadable = 0;

  for (const s of sources) {
    const host = new URL(s.source_url).host;
    const since = Date.now() - (lastHit.get(host) ?? 0);
    if (since < PER_HOST_DELAY_MS) await new Promise((r) => setTimeout(r, PER_HOST_DELAY_MS - since));
    lastHit.set(host, Date.now());

    // Same robots discipline as the monitor. This script reads nothing the
    // daily sync would not read.
    if (!robotsCache.has(host)) {
      const rb = await fetchSource(`https://${host}/robots.txt`, DEFAULT_FETCH_POLICY);
      robotsCache.set(host, rb.status === 'ok' ? rb.body : null);
    }
    const robots = robotsCache.get(host);
    if (robots && !isAllowed(robots, s.source_url, DEFAULT_FETCH_POLICY.userAgent).allowed) {
      unreadable++;
      continue;
    }

    const r = await fetchSource(s.source_url, DEFAULT_FETCH_POLICY);
    if (r.status !== 'ok') { unreadable++; continue; }
    read++;
    pages.push({ url: s.source_url, host, text: flat(normalizeContent(r.body, r.contentType)) });
  }

  console.log(`read ${read} pages, ${unreadable} unreadable or robots-disallowed.\n`);

  // Second pass, once every page is in hand: a match only counts if the text
  // around it is NOT repeated across the host's other pages.
  let furniture = 0;
  for (const page of pages) {
    const siblings = pages.filter((p) => p.host === page.host && p.url !== page.url);
    for (const { f, re } of patterns) {
      const m = findRealMention(page.text, re, siblings);
      if (m === 'none') continue;
      if (m === 'furniture') { furniture++; continue; }
      const list = citedBy.get(f.id) ?? [];
      if (!list.includes(page.url)) list.push(page.url);
      citedBy.set(f.id, list);
    }
  }
  console.log(`discarded ${furniture} match(es) that were site navigation rather than page text.\n`);

  const cited = findings.filter((f) => citedBy.has(f.id));
  const uncited = findings.filter((f) => !citedBy.has(f.id));
  console.log(`CITED by a page we already track: ${cited.length}`);
  console.log(`NOT mentioned on any tracked page: ${uncited.length}\n`);
  for (const f of cited) {
    console.log(`  ${f.authority}  ${f.code}  <- ${citedBy.get(f.id)!.join(', ')}`);
  }

  if (!write) {
    console.log('\n(dry run — pass --write to record these as acknowledged)');
    return;
  }

  for (const f of cited) {
    const urls = citedBy.get(f.id)!;
    const note =
      `In scope by the registry's own reading: named on ${urls.length} official page(s) ` +
      `VisaAI already tracks (${urls[0]}${urls.length > 1 ? ` +${urls.length - 1} more` : ''}). ` +
      `Acknowledged, not added — the template has not been ingested. ` +
      `Recorded by scripts/triage-sweep-findings.ts.`;
    const { error } = await db
      .from('template_sweep_findings')
      .update({ status: 'acknowledged', note: note.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('id', f.id);
    if (error) throw new Error(`${f.code}: ${error.message}`);
  }
  console.log(`\nmarked ${cited.length} finding(s) acknowledged. Nothing was ignored.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
