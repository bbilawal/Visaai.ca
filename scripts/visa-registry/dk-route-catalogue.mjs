#!/usr/bin/env node
/**
 * Enumerate Denmark's permit catalogue off nyidanmark.dk.
 *
 * WHY THIS EXISTS — AND WHY DENMARK WAS WRONGLY REJECTED TWICE
 *
 * Denmark was probed on 2026-08-24 and filed as
 * `readable_but_catalogue_not_enumerable`: leaf pages read fine, but the route
 * index looked client-rendered, so we could read a permit page whose URL we
 * already knew and could not say which permits exist. Under ledger rule 24 that
 * is a refusal — admission needs pages that read AND an index that enumerates,
 * because publishing routes found by search claims a catalogue we cannot show is
 * complete.
 *
 * That verdict was re-confirmed on 2026-08-26 by measuring the sitemap (404, in
 * two locations) and re-reading the index. Both passes made the SAME mistake:
 * they asked what the page RENDERS. The server sends 25KB for a page whose
 * visible text is one heading, and neither pass asked what the other 24KB was.
 *
 * It is the catalogue. This is a Sitecore-backed Angular app, and it hands its
 * components their data server-side as JSON inside an HTML attribute:
 *
 *   <app-cards model="{&quot;Header&quot;:&quot;For you who want to apply
 *   based on&quot;,&quot;LinkBoxes&quot;:[{&quot;Header&quot;:&quot;Short stay
 *   (visa)&quot;,&quot;LinkToPage&quot;:&quot;/en-GB/You-want-to-apply/Short-
 *   stay-visa&quot;}, ...]}">
 *
 * So every route, its official title, its lead text and its URL are in the
 * server response — entity-encoded, invisible to a text extractor, and fully
 * enumerable. "Client-rendered" described the PIXELS, not the payload.
 *
 * THE LESSON, which is the same one Cyprus taught: a negative finding about a
 * page needs the whole response, not the part that happens to be legible. Cyprus
 * looked unblocked because only the first twelve lines of robots.txt were read.
 * Denmark looked unenumerable because only the rendered text was read. Both are
 * the same error — concluding from a convenient slice.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not construct URLs. Every URL it returns was read from a LinkToPage
 * the authority itself published, which is exactly what rule 24 demands. Pages
 * that carry no app-cards grid are leaves and terminate the walk.
 *
 * Usage:
 *   node scripts/visa-registry/dk-route-catalogue.mjs [--json out.json]
 *
 * Run it FROM THE VPS. Production egress is what has to be able to read an
 * authority; a laptop fetch proves nothing about whether the monitor can.
 *
 * Exits 1 if the root grid disappears or returns fewer than 20 boxes — either
 * means the site changed shape and the walk below is no longer reading the
 * catalogue it was written against.
 */

const ORIGIN = 'https://www.nyidanmark.dk';
const ROOT = '/en-GB/You-want-to-apply';
const UA =
  'VisaAI-SourceMonitor/1.0 (+https://visaai.co/bots; visa requirement change monitoring)';

/** robots.txt is 404 here — conventionally unrestricted. Still: go slowly. */
const DELAY_MS = 900;
const MAX_PAGES = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Undo the HTML attribute encoding around the embedded JSON.
 *
 * Only the five XML entities plus numeric escapes: the payload is JSON, so any
 * further "helpful" unescaping would corrupt strings that legitimately contain
 * backslashes.
 */
function decodeAttr(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // last, or the others double-decode
}

/** Every app-cards grid on a page, parsed. A page may carry more than one. */
function gridsFrom(html) {
  const out = [];
  const re = /<app-cards[^>]*\smodel\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(decodeAttr(m[1])));
    } catch {
      // A grid we cannot parse is reported, not silently dropped: silence here
      // would look identical to a page that genuinely has no sub-routes.
      out.push({ Header: '<<UNPARSEABLE MODEL>>', LinkBoxes: [] });
    }
  }
  return out;
}

/**
 * One page, with backoff.
 *
 * The site resets the connection intermittently under a sustained walk — not a
 * refusal (the same URL succeeds moments later), but a real limit. Retrying
 * with a widening gap is the polite reading of it; retrying immediately and
 * harder is how a monitoring job turns into an attack.
 */
async function get(path, attempt = 0) {
  try {
    const res = await fetch(ORIGIN + path, {
      headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'en' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, html: res.ok ? await res.text() : '' };
  } catch (err) {
    if (attempt >= 4) return { status: 0, html: '', error: String(err?.cause?.code || err) };
    await sleep(2000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
}

async function main() {
  const seen = new Map();
  const queued = new Set([ROOT]);
  const queue = [{ path: ROOT, depth: 0, parent: null }];
  let fetched = 0;
  let rootBoxes = 0;
  const failed = [];

  while (queue.length && fetched < MAX_PAGES) {
    const { path, depth, parent } = queue.shift();
    if (seen.has(path)) continue;

    if (fetched) await sleep(DELAY_MS);
    const { status, html } = await get(path);
    fetched++;

    const grids = html ? gridsFrom(html) : [];
    const boxes = grids.flatMap((g) =>
      (g.LinkBoxes || []).map((b) => ({
        title: b.Header,
        lead: b.LeadText || '',
        path: b.LinkToPage,
        grid: g.Header || '',
      })),
    );
    if (path === ROOT) rootBoxes = boxes.length;

    seen.set(path, { path, status, depth, parent, children: boxes.map((b) => b.path) });
    if (status === 0) failed.push(path);
    process.stderr.write(`${String(status).padEnd(4)} d${depth} ${path} (${boxes.length} sub)\n`);

    for (const b of boxes) {
      // Only in-catalogue English routes. An off-site or Danish link is a real
      // part of the page but not part of the English route tree we publish.
      if (!b.path || !b.path.startsWith('/en-GB/')) continue;
      if (queued.has(b.path)) continue;
      queued.add(b.path);
      queue.push({ path: b.path, depth: depth + 1, parent: path });
    }
  }

  if (rootBoxes < 20) {
    console.error(
      `\nFAIL: the root grid at ${ROOT} yielded ${rootBoxes} link boxes (expected >= 20).\n` +
        `Either the page no longer carries an app-cards model attribute, or its shape changed.\n` +
        `Do NOT fall back to guessing URLs — re-read the page and fix this script.`,
    );
    process.exit(1);
  }

  if (failed.length) {
    // Named, never swallowed: a page we could not read is a hole in the
    // catalogue, and a catalogue with unreported holes is the exact failure
    // rule 24 exists to prevent.
    console.error(`\nUNREAD (${failed.length}): ${failed.join(', ')}`);
  }
  const rows = [...seen.values()];
  const leaves = rows.filter((r) => r.children.length === 0);
  console.error(
    `\nWalked ${rows.length} pages: ${rows.length - leaves.length} with sub-routes, ${leaves.length} leaves.`,
  );

  const outFlag = process.argv.indexOf('--json');
  const payload = JSON.stringify(
    { origin: ORIGIN, root: ROOT, read_at: new Date().toISOString(), pages: rows },
    null,
    2,
  );
  if (outFlag > -1 && process.argv[outFlag + 1]) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.argv[outFlag + 1], payload);
    console.error(`wrote ${process.argv[outFlag + 1]}`);
  } else {
    console.log(payload);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
