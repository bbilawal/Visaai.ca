/**
 * Align an extraction file's excerpts to the authority's own punctuation.
 *
 * WHY THIS EXISTS
 *
 * `verify-excerpts.ts` compares an excerpt to the page byte for byte after
 * collapsing whitespace, and it is right to. But there is one class of
 * mismatch it reports that is NOT drift and NOT a wrong claim: an excerpt that
 * says exactly what the page says, typed with an ASCII apostrophe where the
 * authority published U+2019, or ASCII quotes where the authority published
 * curly ones.
 *
 * Nine of twenty-six excerpts on the first US E-1/E-2 extraction failed for
 * precisely this. Left alone, that failure mode is corrosive in a specific
 * way: it produces a red run that is mostly noise, and a reviewer who learns
 * to skim past punctuation failures will skim past a real one.
 *
 * WHAT IT WILL AND WILL NOT CHANGE
 *
 * It rewrites an excerpt ONLY to the exact characters found on the page, and
 * only where the two differ by:
 *   - apostrophe family   '  U+2018  U+2019  U+02BC
 *   - quote family        "  U+201C  U+201D
 *   - dash family         -  U+2010  U+2013  U+2014
 *   - whitespace runs
 *
 * Every other difference — a changed word, a dropped clause, a number that
 * moved — still fails, because those are the differences that mean something.
 * The replacement text is taken FROM THE PAGE, so the result cannot say
 * anything the page does not.
 *
 * It refuses to touch a file whose excerpt matches nothing, and it never
 * invents an elision: declared ` ... ` fragments are aligned one at a time and
 * rejoined, so an excerpt cannot silently gain or lose a gap.
 *
 * Run it BEFORE verify-excerpts, then let verify-excerpts have the last word.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/align-excerpt-punctuation.ts <file.json> [...]
 *   npx ts-node -P tsconfig.json scripts/align-excerpt-punctuation.ts --check <file.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';

const APOSTROPHES = "'‘’ʼ";
const QUOTES = '"“”';
const DASHES = '-‐–—';

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Escape for regex, then widen the three punctuation families and whitespace. */
function loosePattern(fragment: string): RegExp {
  let out = '';
  for (const ch of flat(fragment)) {
    if (APOSTROPHES.includes(ch)) out += `[${APOSTROPHES.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`;
    else if (QUOTES.includes(ch)) out += `[${QUOTES}]`;
    else if (DASHES.includes(ch)) out += `[${DASHES}]`;
    else if (ch === ' ') out += '\\s+';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out);
}

interface Doc {
  visaai_id: string;
  source_roles: Record<string, string>;
  requirements: { requirement_code: string; source_role: string; source_excerpt: string }[];
}

async function alignFile(path: string, check: boolean) {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Doc;
  const pages = new Map<string, string | null>();

  for (const [role, url] of Object.entries(doc.source_roles)) {
    if (!doc.requirements.some((r) => r.source_role === role)) continue;
    const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
    pages.set(role, r.status === 'ok' ? flat(normalizeContent(r.body, r.contentType)) : null);
    if (r.status !== 'ok') console.error(`  UNREADABLE role=${role} (${r.status}) ${url}`);
  }

  let changed = 0;
  let unmatched = 0;

  for (const req of doc.requirements) {
    const page = pages.get(req.source_role);
    if (!page) continue;

    // Already exact? Leave it completely alone.
    if (page.includes(flat(req.source_excerpt))) continue;

    const fragments = flat(req.source_excerpt).split(/ \.\.\. /).filter(Boolean);
    const aligned: string[] = [];
    let cursor = 0;
    let ok = true;

    for (const frag of fragments) {
      const m = loosePattern(frag).exec(page.slice(cursor));
      if (!m) { ok = false; break; }
      aligned.push(m[0]);
      cursor += m.index + m[0].length;
    }

    if (!ok) {
      unmatched++;
      console.error(`  NO MATCH  ${req.requirement_code} (role=${req.source_role})`);
      console.error(`            not a punctuation difference — verify-excerpts will explain`);
      continue;
    }

    const next = aligned.join(' ... ');
    if (next !== req.source_excerpt) {
      changed++;
      console.log(`  ALIGNED   ${req.requirement_code}`);
      if (!check) req.source_excerpt = next;
    }
  }

  if (changed && !check) {
    writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
    console.log(`  wrote ${changed} aligned excerpt(s) -> ${path}`);
  }
  return { changed, unmatched };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const files = args.filter((a) => a !== '--check');
  if (!files.length) { console.error('usage: align-excerpt-punctuation.ts [--check] <file.json> ...'); process.exit(2); }

  let changed = 0, unmatched = 0;
  for (const f of files) {
    console.log(`\n${f}`);
    const r = await alignFile(f, check);
    changed += r.changed; unmatched += r.unmatched;
  }
  console.log(`\n${changed} excerpt(s) aligned, ${unmatched} unmatched.`);
  // Unmatched is NOT failed here — verify-excerpts is the authority on that,
  // and reporting it twice with two exit codes teaches people to ignore one.
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
