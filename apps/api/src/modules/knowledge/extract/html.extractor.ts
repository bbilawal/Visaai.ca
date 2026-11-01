/**
 * HTML extraction that keeps the structure a visa page carries its meaning in.
 *
 * `visa-sync/normalize.ts` already strips HTML to text, and this module does
 * NOT replace it: that one exists to produce a stable hash for change
 * detection, so it deliberately flattens everything and throws structure away.
 * Retrieval needs the opposite — headings, list membership and table cells are
 * the difference between "documents you must provide" and "documents you must
 * not send".
 *
 * A dependency-free parser rather than cheerio/jsdom. Three reasons, in order
 * of weight:
 *
 *   1. This code parses HTML from arbitrary external servers. A full DOM
 *      parser is a much larger attack surface for a hostile document than a
 *      tokeniser that only recognises tags and text.
 *   2. Government HTML is frequently invalid — unclosed <p>, <li> without
 *      </li>, tables nested in ways no validator permits. A forgiving
 *      tokeniser degrades to "slightly wrong section boundaries"; a strict
 *      parser throws, and a page we cannot parse is a page we cannot serve.
 *   3. It keeps the extraction path free of native modules, which matters on
 *      the VPS deployment.
 */
import {
  assemble,
  emptyDocument,
  ExtractionError,
  type ExtractedDocument,
  type ExtractedSection,
  type ExtractInput,
  type Extractor,
} from './types';
import { stripActiveContent } from '../content-safety';
import { decodeEntities } from '../../visa-sync/normalize';

const VERSION = 'v1';

/** Tags whose content is never body text. */
const DROP_CONTENT =
  /<(script|style|noscript|template|svg|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * Markup that is not a tag and is not content: the doctype, comments, CDATA
 * and processing instructions.
 *
 * The tokeniser below matches `<` followed by a LETTER, which is correct for
 * elements and silently wrong for everything else — `<!doctype html>` does not
 * match, so it was never recognised as markup and fell through as TEXT.
 *
 * Every page therefore opened with a chunk beginning `<!doctype html>`, and
 * because that chunk also swept up the navigation that precedes the first
 * heading, its content was a menu rather than a document. Measured on the
 * production corpus 2026-09-04: 275 such chunks across 275 sources — one per
 * page, on all 28 registered hosts. They are retrievable and citable, so a
 * grounded answer could quote a site menu at an applicant.
 *
 * Comments matter for a second reason: government pages carry commented-out
 * blocks of old guidance, and a comment is exactly the place an injected
 * instruction hides from a human reviewer while staying visible to a parser.
 */
const DROP_MARKUP =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>/g;

/** Block-level tags that force a text break. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'br',
  'hr',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'address',
  'form',
  'fieldset',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
]);

interface Token {
  type: 'tag' | 'endtag' | 'text';
  name?: string;
  attrs?: Record<string, string>;
  text?: string;
}

/**
 * Tokenise. Not a parse tree: a flat token stream is enough for the section
 * walk below and cannot be tricked into unbounded recursion by nesting depth.
 */
export function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (m.index > last) {
      tokens.push({ type: 'text', text: html.slice(last, m.index) });
    }
    const isEnd = m[0].startsWith('</');
    const name = m[1].toLowerCase();
    if (isEnd) {
      tokens.push({ type: 'endtag', name });
    } else {
      tokens.push({ type: 'tag', name, attrs: parseAttrs(m[2] ?? '') });
    }
    last = re.lastIndex;
  }
  if (last < html.length) tokens.push({ type: 'text', text: html.slice(last) });
  return tokens;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1].toLowerCase();
    out[key] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function cleanText(s: string): string {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/**
 * Boilerplate a government CMS repeats on every page. Dropping it is not
 * cosmetic: cookie banners and "Skip to main content" are the single most
 * duplicated text in the corpus, and indexing them means every query has a few
 * hundred perfectly-matching but useless chunks competing for the top slots.
 */
const BOILERPLATE = [
  /^skip to (main )?content$/i,
  /^cookies? (policy|settings|notice)$/i,
  /^we use cookies/i,
  /^accept (all )?cookies$/i,
  /^(share|print) this page$/i,
  /^back to top$/i,
  /^(menu|search|close|toggle navigation)$/i,
  /^javascript is (disabled|required)/i,
  /^(français|english|español|中文|عربى)$/i,
];

function isBoilerplate(text: string): boolean {
  return BOILERPLATE.some((re) => re.test(text));
}

/** Containers whose text is navigation chrome rather than content. */
const CHROME_TAGS = new Set(['nav', 'header', 'footer', 'aside']);

export class HtmlExtractor implements Extractor {
  readonly name = 'html';
  readonly version = VERSION;

  supports(contentType: string): boolean {
    return (
      contentType === 'text/html' || contentType === 'application/xhtml+xml'
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const raw = Buffer.from(input.bytes).toString('utf8');
    // Active content and hidden directives go first, before anything reads the
    // document — see content-safety.ts for why hidden blocks matter.
    const html = stripActiveContent(raw)
      .replace(DROP_CONTENT, ' ')
      // Before tokenising: the tokeniser cannot see these as markup, so
      // anything left here is emitted as body text.
      .replace(DROP_MARKUP, ' ');

    const tokens = tokenizeHtml(html);
    const doc = emptyDocument(this.name, VERSION);

    const title = extractTitle(html);
    if (title) doc.title = title;

    const dates = extractMetaDates(html);
    if (dates.publishedAt) doc.publishedAt = dates.publishedAt;
    if (dates.effectiveFrom) doc.effectiveFrom = dates.effectiveFrom;

    const built: Array<
      Omit<ExtractedSection, 'charStart' | 'charEnd' | 'ordinal'>
    > = [];
    const headingPath: string[] = [];
    const headingLevels: number[] = [];

    // Buffers for the section currently being accumulated.
    let buffer: string[] = [];
    let listItems: string[] = [];
    let inList = false;
    let listIsChecklist = false;
    let chromeDepth = 0;
    const chromeStack: string[] = [];

    // Table state. Tables are handled by accumulating rows and emitting one
    // section per table so the header can be attached — see below.
    let inTable = false;
    let tableRows: string[][] = [];
    let currentRow: string[] | null = null;
    let currentCell: string[] | null = null;
    let tableHeader: string[] | undefined;
    let cellIsHeader = false;

    const flushProse = () => {
      const text = cleanText(buffer.join(' '));
      buffer = [];
      if (!text || isBoilerplate(text)) return;
      built.push({ kind: 'prose', headingPath: [...headingPath], text });
    };

    const flushList = () => {
      const items = listItems.filter((i) => i && !isBoilerplate(i));
      listItems = [];
      if (items.length === 0) return;
      built.push({
        // A list under a heading whose text frames it as required documents is
        // a CHECKLIST, and retrieval treats checklists as higher-value than
        // prose. The signal is the heading, not the markup — no government CMS
        // marks up a document checklist any differently from a nav list.
        kind: listIsChecklist ? 'checklist' : 'list',
        headingPath: [...headingPath],
        // Bullets are preserved. Stripping them merges "passport" and
        // "photograph" into one sentence and the chunker can no longer tell
        // where one requirement ends.
        text: items.map((i) => `• ${i}`).join('\n'),
      });
      listIsChecklist = false;
    };

    const flushTable = () => {
      if (tableRows.length === 0) {
        inTable = false;
        return;
      }
      const header =
        tableHeader ?? (tableRows.length > 1 ? tableRows[0] : undefined);
      const bodyRows =
        header && tableRows[0] === header ? tableRows.slice(1) : tableRows;
      // Row-wise serialisation with the header repeated per row. A fee table
      // chunked mid-way otherwise yields "£127" with no indication of which
      // visa or nationality it belongs to, which is exactly the failure mode
      // that makes a wrong fee quotable.
      const lines = bodyRows.map((row) =>
        header && header.length === row.length
          ? row.map((cell, i) => `${header[i]}: ${cell}`).join(' | ')
          : row.join(' | '),
      );
      built.push({
        kind: 'table',
        headingPath: [...headingPath],
        text: lines.join('\n'),
        tableHeader: header,
      });
      doc.tableCount++;
      tableRows = [];
      tableHeader = undefined;
      inTable = false;
    };

    const CHECKLIST_HEADING =
      /(document|checklist|what you (need|must)|required|supporting|evidence|you must (provide|submit|include)|apply with)/i;

    for (const t of tokens) {
      if (t.type === 'text') {
        if (chromeDepth > 0) continue;
        const text = t.text ?? '';
        if (!text.trim()) continue;
        if (inTable) {
          if (currentCell) currentCell.push(text);
          continue;
        }
        if (inList) {
          // Text between <li> boundaries; appended to the open item.
          if (listItems.length > 0) {
            listItems[listItems.length - 1] += ` ${cleanText(text)}`;
          } else {
            buffer.push(text);
          }
          continue;
        }
        buffer.push(text);
        continue;
      }

      const name = t.name!;

      if (t.type === 'tag') {
        if (CHROME_TAGS.has(name)) {
          // Chrome regions are skipped wholesale. Tracking a stack rather than
          // a counter so an unclosed <nav> — common — does not swallow the
          // whole page: the end tag pops by name.
          flushProse();
          chromeStack.push(name);
          chromeDepth++;
          continue;
        }
        if (chromeDepth > 0) continue;

        if (/^h[1-6]$/.test(name)) {
          flushProse();
          flushList();
          flushTable();
          const level = Number(name[1]);
          // Pop any heading at or below this level, then push. This is what
          // keeps headingPath a real path rather than an ever-growing list.
          while (
            headingLevels.length &&
            headingLevels[headingLevels.length - 1] >= level
          ) {
            headingLevels.pop();
            headingPath.pop();
          }
          // Heading text is the next run of text tokens; captured by a marker
          // section that the walker fills on the matching end tag.
          built.push({
            kind: 'heading',
            headingPath: [...headingPath],
            headingLevel: level,
            text: ' PENDING',
          });
          headingLevels.push(level);
          headingPath.push('');
          continue;
        }

        if (name === 'ul' || name === 'ol') {
          flushProse();
          inList = true;
          listIsChecklist = headingPath.some((h) => CHECKLIST_HEADING.test(h));
          continue;
        }
        if (name === 'li') {
          listItems.push('');
          continue;
        }
        if (name === 'table') {
          flushProse();
          flushList();
          inTable = true;
          tableRows = [];
          continue;
        }
        if (name === 'tr' && inTable) {
          currentRow = [];
          continue;
        }
        if ((name === 'td' || name === 'th') && inTable) {
          currentCell = [];
          cellIsHeader = name === 'th';
          continue;
        }
        if (name === 'a') {
          const href = t.attrs?.href;
          if (href) {
            try {
              doc.links.push({
                href: new URL(href, input.url).toString(),
                text: '',
              });
            } catch {
              /* relative URL we cannot resolve — not worth failing extraction */
            }
          }
          continue;
        }
        if (BLOCK_TAGS.has(name) && !inList && !inTable) {
          flushProse();
        }
        continue;
      }

      // End tags
      if (CHROME_TAGS.has(name)) {
        const idx = chromeStack.lastIndexOf(name);
        if (idx >= 0) {
          chromeStack.splice(idx, 1);
          chromeDepth = chromeStack.length;
        }
        continue;
      }
      if (chromeDepth > 0) continue;

      if (/^h[1-6]$/.test(name)) {
        const text = cleanText(buffer.join(' '));
        buffer = [];
        const pending = built[built.length - 1];
        if (pending && pending.text === ' PENDING') {
          pending.text = text;
          headingPath[headingPath.length - 1] = text;
        }
        continue;
      }
      if (name === 'li') {
        if (listItems.length) {
          listItems[listItems.length - 1] = cleanText(
            `${listItems[listItems.length - 1]} ${buffer.join(' ')}`,
          );
          buffer = [];
        }
        continue;
      }
      if (name === 'ul' || name === 'ol') {
        flushList();
        inList = false;
        continue;
      }
      if ((name === 'td' || name === 'th') && inTable) {
        if (currentRow && currentCell) {
          currentRow.push(cleanText(currentCell.join(' ')));
          if (cellIsHeader && !tableHeader && tableRows.length === 0) {
            // header cells accumulate into the header row
          }
        }
        currentCell = null;
        continue;
      }
      if (name === 'tr' && inTable) {
        if (currentRow && currentRow.length) {
          if (
            !tableHeader &&
            currentRow.every((c) => c.length > 0) &&
            tableRows.length === 0
          ) {
            tableHeader = currentRow;
          } else {
            tableRows.push(currentRow);
          }
        }
        currentRow = null;
        continue;
      }
      if (name === 'table') {
        flushTable();
        continue;
      }
      if (BLOCK_TAGS.has(name) && !inList && !inTable) {
        flushProse();
      }
    }

    flushProse();
    flushList();
    flushTable();

    // Drop heading markers that never received text (an <h2> with only an
    // image inside, for instance).
    const usable = built.filter((s) => s.text && s.text !== ' PENDING');

    const { text, sections } = assemble(usable);
    doc.text = text;
    doc.sections = sections;

    if (!doc.text.trim()) {
      throw new ExtractionError('HTML produced no text', 'empty');
    }
    return doc;
  }
}

export function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (m) {
    const t = cleanText(m[1]);
    if (t) return t.slice(0, 500);
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html);
  if (h1) {
    const t = cleanText(h1[1].replace(/<[^>]+>/g, ' '));
    if (t) return t.slice(0, 500);
  }
  return undefined;
}

/**
 * Dates the page states about ITSELF.
 *
 * Only meta tags and explicit "last updated" lines are read. A date found in
 * body prose is usually a date in an example ("if you applied before 1 January
 * 2024"), and treating that as the page's effective date would misdate every
 * requirement extracted from it.
 */
export function extractMetaDates(html: string): {
  publishedAt?: string;
  effectiveFrom?: string;
} {
  const out: { publishedAt?: string; effectiveFrom?: string } = {};

  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const nameMatch = /(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i.exec(
      tag,
    );
    const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!nameMatch || !contentMatch) continue;
    const key = nameMatch[1].toLowerCase();
    const value = contentMatch[1];
    const iso = toIsoDate(value);
    if (!iso) continue;
    if (
      /(article:modified_time|dcterms\.modified|last-?modified|dateModified|og:updated_time)/i.test(
        key,
      )
    ) {
      out.publishedAt = iso;
    } else if (
      /(article:published_time|dcterms\.(created|issued)|datePublished|date)/i.test(
        key,
      ) &&
      !out.publishedAt
    ) {
      out.publishedAt = iso;
    } else if (/(dcterms\.valid|effective)/i.test(key)) {
      out.effectiveFrom = iso;
    }
  }

  if (!out.publishedAt) {
    // The tag-skip is `(?:<[^>]{0,200}>\s*)*` — a sequence of WHOLE tags —
    // and not `<?[^>]*>?`. The latter is greedy over any non-'>' character, so
    // on "Last updated: 15 March 2026" it swallowed the date and backtracked
    // to the shortest capture that still matched, yielding "5 March 2026" and
    // a page date ten days early. A date that is silently wrong is worse than
    // one that is absent, because nothing downstream can detect it.
    const updated =
      /(?:last\s+(?:updated|modified|reviewed)|date\s+modified)\s*[:\-–]?\s*(?:<[^>]{0,200}>\s*)*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(
        html,
      );
    if (updated) {
      const iso = toIsoDate(updated[1]);
      if (iso) out.publishedAt = iso;
    }
  }

  return out;
}

/**
 * Parse a date string to yyyy-mm-dd, or return null.
 *
 * Deliberately narrow. `Date.parse` on an ambiguous string like "01/02/2024"
 * silently picks a locale interpretation, and an effective date that is a
 * month wrong is worse than one that is absent.
 */
export function toIsoDate(value: string): string | null {
  const v = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const MONTHS: Record<string, string> = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    sept: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };

  let m = /^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/.exec(v);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
  }
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (m) {
    const mm = MONTHS[m[1].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
  }
  return null;
}
