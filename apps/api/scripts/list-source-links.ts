/**
 * Print the links a government page offers, so a new source URL is READ OFF the
 * site rather than constructed.
 *
 * WHY
 *
 * The coverage matrix reports which visa types have no usable source, but not
 * what to register instead. The tempting next step is to guess a URL from the
 * site's apparent pattern — `.../work-canada/permit-outside/eligibility.html`
 * looks obviously right, and sometimes is. A guessed URL that happens to 200 is
 * indistinguishable from a verified one once it is in the registry, and a
 * guessed URL that 404s quietly becomes a source that never yields a version.
 *
 * Both gaps closed on 2026-08-21 were found with this instead: the work permit
 * eligibility page was linked from the already-registered application page under
 * the anchor text "Check if you can apply", and the business visitor page was
 * linked from the visit-canada hub. Neither was typed from memory.
 *
 * Uses the same robots-respecting fetcher as the monitor, so it cannot reach
 * anything the monitor would not.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/list-source-links.ts <url> [substring-filter]
 */
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('Pass a URL.');
  const filter = (process.argv[3] ?? '').toLowerCase();

  const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
  if (r.status !== 'ok') {
    console.error(`FETCH ${r.status} — nothing to list.`);
    process.exit(1);
  }

  /**
   * Resolve relative hrefs against `<base href>` when the page declares one.
   *
   * WHY: migration.gv.at serves `<base href="/" />` and publishes hrefs like
   * `en/types-of-immigration/permanent-immigration/`. Resolved against the page
   * URL — which is what this script did — that becomes
   * `/en/types-of-immigration/en/types-of-immigration/permanent-immigration/`,
   * doubling the path. The real URL is the one the browser computes from the
   * base.
   *
   * The site happened to 303 the doubled form to the right place, which is
   * exactly why this was worth fixing rather than shrugging at: the whole point
   * of this script is that source URLs get READ off the site instead of
   * constructed, and it was handing back URLs the site never published. On a
   * site without that redirect it would produce a 404 — or worse, resolve to a
   * DIFFERENT real page and register the wrong source for a visa route.
   */
  const baseTag = /<base\b[^>]*href="([^"]+)"/i.exec(r.body);
  const base = baseTag ? new URL(baseTag[1], url).toString() : url;
  if (baseTag) {
    console.error(`  (page declares <base href="${baseTag[1]}"> — resolving against ${base})`);
  }

  const seen = new Set<string>();
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r.body))) {
    let href: string;
    try {
      href = new URL(m[1], base).toString();
    } catch {
      continue; // mailto:, tel:, javascript: and other non-navigable hrefs
    }
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || seen.has(href)) continue;
    if (filter && !`${href} ${text}`.toLowerCase().includes(filter)) continue;
    seen.add(href);
    console.log(`${text}\n    ${href}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
