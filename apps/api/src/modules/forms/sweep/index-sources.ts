import { FORM_FETCH_USER_AGENT, type FetchLike } from '../http';

/**
 * One artifact as the AUTHORITY lists it — not as VisaAI models it. These are
 * raw observations from a government index page and nothing here is trusted
 * enough to reach an applicant: the sweep only ever files them for review.
 */
export interface IndexEntry {
  /** The authority's own code, normalised to how our catalog writes it. */
  code: string;
  title: string;
  url: string;
}

export interface AuthorityIndex {
  /** Stable id, stored on the finding. */
  authority: string;
  label: string;
  indexUrl: string;
  parse(html: string, indexUrl: string): IndexEntry[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * IRCC — canada.ca "Application forms and guides" index.
 *
 * MEASURED 2026-08-13: 200, ~178 distinct immNNNN codes, each linked as
 * …/application-forms-guides/immNNNN.html with the human title as the anchor
 * text. Server-rendered, so a regex over the body is sufficient.
 *
 * The code is normalised back to catalog spelling ('imm5484' → 'IMM 5484') so
 * the diff compares like with like — without this every one of the 178 entries
 * would look new forever.
 */
export const irccIndex: AuthorityIndex = {
  authority: 'ircc',
  label: 'IRCC (canada.ca)',
  indexUrl:
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides.html',
  parse(html, indexUrl) {
    const out = new Map<string, IndexEntry>();
    const LINK =
      /<a[^>]+href="([^"]*application-forms-guides\/(imm\d{4,5})[^"]*\.html)"[^>]*>([^<]*)/gi;
    for (const m of html.matchAll(LINK)) {
      const [, href, rawCode, rawTitle] = m;
      const code = `IMM ${rawCode.slice(3)}`;
      // First occurrence wins: the index links some forms twice (a nav entry
      // above the table), and the first is the one carrying the real title.
      if (out.has(code)) continue;
      let url: string;
      try {
        url = new URL(href, indexUrl).toString();
      } catch {
        continue;
      }
      out.set(code, { code, title: decodeEntities(rawTitle) || code, url });
    }
    return [...out.values()];
  },
};

/**
 * USCIS — uscis.gov "All forms" index.
 *
 * MEASURED 2026-08-13: 200, ~97 form pages linked as bare paths (/i-130,
 * /g-1145, /n-400). The title lives in an anchor whose text is
 * "I-130 | Petition for Alien Relative"; other anchors to the same href carry
 * no text at all ("Form Details", nav items), so the parse keeps the longest
 * text seen for a code rather than the first.
 */
export const uscisIndex: AuthorityIndex = {
  authority: 'uscis',
  label: 'USCIS (uscis.gov)',
  indexUrl: 'https://www.uscis.gov/forms/all-forms',
  parse(html, indexUrl) {
    const best = new Map<string, IndexEntry>();
    const LINK =
      /<a[^>]+href="(\/((?:i|n|g|ar|eoir)-\d{1,4}[a-z]?))"[^>]*>([^<]*)/gi;
    for (const m of html.matchAll(LINK)) {
      const [, href, rawCode, rawTitle] = m;
      const code = rawCode.toUpperCase();
      const title = decodeEntities(rawTitle);
      let url: string;
      try {
        url = new URL(href, indexUrl).toString();
      } catch {
        continue;
      }
      const existing = best.get(code);
      // Longest anchor text wins: it is the one that includes the form's name.
      if (!existing || title.length > existing.title.length) {
        best.set(code, { code, title: title || code, url });
      }
    }
    return [...best.values()];
  },
};

/**
 * NOT IMPLEMENTED, deliberately, and recorded here so the gap is visible
 * rather than looking like an oversight:
 *
 *   Home Affairs (AU) — its forms index is a JavaScript-rendered SharePoint
 *   page. MEASURED 2026-08-12: 1.28 MB of HTML containing ZERO .pdf hrefs.
 *   A plain fetch has nothing to parse; this needs the headless-browser escape
 *   hatch the discovery interface was designed to accept.
 *
 *   GOV.UK — publishes guidance through a search index, not a stable forms
 *   list. /government/collections/visa-and-immigration-forms is a 404
 *   (MEASURED 2026-08-13). Crawling gov.uk search results would produce a
 *   stream of near-duplicates a human would have to sift, which is worse than
 *   no signal.
 *
 * Both authorities' EXISTING catalog entries are still refreshed and still
 * health-checked; only new-artifact discovery is unavailable for them.
 */
export const AUTHORITY_INDEXES: AuthorityIndex[] = [irccIndex, uscisIndex];

/** Fetch and parse one index. Returns [] on any failure — never throws. */
export async function fetchIndex(
  index: AuthorityIndex,
  http: FetchLike,
): Promise<IndexEntry[]> {
  try {
    const res = await http(index.indexUrl, {
      headers: { 'user-agent': FORM_FETCH_USER_AGENT },
    });
    if (!res.ok) return [];
    return index.parse(await res.text(), index.indexUrl);
  } catch {
    return [];
  }
}
