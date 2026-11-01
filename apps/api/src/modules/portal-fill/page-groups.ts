import type { SignedWriteIntent } from '@visaai/types';

export interface SelectorProbeResult {
  selector: string;
  found: boolean;
}

export type PageGroupSelection =
  | { ok: true; intents: SignedWriteIntent[]; pages: string[] }
  | { ok: false; reason: 'none_present' | 'partial_page'; missing: string[] };

/**
 * Probed = present when the page loads. A revealed target (a follow-up
 * question) or one inside an "add row" dialog does not exist until an earlier
 * step runs, so it is waited for during the run instead of probed up front.
 */
export function isProbed(i: Pick<SignedWriteIntent, 'reveal' | 'dialog'>) {
  return !i.reveal && !i.dialog;
}

/** Does the tab's URL path name this mapping page? ("/x/nationality" ↔ "/nationality") */
export function pageMatches(path: string, page: string): boolean {
  const norm = (s: string) => s.replace(/\/+$/, '') || '/';
  const p = norm(path);
  const g = norm(page);
  return p === g || p.endsWith(g.startsWith('/') ? g : `/${g}`);
}

/**
 * Which intents may run on the page the extension is bound to.
 *
 * With `currentPage` (the bound tab's URL path — what every protocol-2
 * extension reports): only the page group whose `page` is that path runs, and
 * only when every probed selector of it is present. Other pages' groups are
 * ignored outright. IRCC reuses ids across pages (`#lastName_input` is the
 * applicant on /bio-data, the spouse on /family-info and a child in the
 * children dialog), so the path decides the page, never the ids that happen
 * to resolve.
 *
 * Without it (older callers), intents are grouped by `page` (no page = one
 * legacy group). A group runs only when EVERY one of its probed selectors is
 * present, and the whole run is refused if any group is only partly present: a
 * half-matched group means the page is not the one the mapping was written
 * for, and writing the matching half would put the applicant's data in someone
 * else's fields. With a single page-less group this is exactly the old
 * all-or-nothing rule.
 */
export function selectPageGroups(
  intents: SignedWriteIntent[],
  probe: SelectorProbeResult[],
  currentPage?: string | null,
): PageGroupSelection {
  // Nothing to write is not a mismatch (and was never refused before).
  if (intents.length === 0) return { ok: true, intents: [], pages: [] };
  const found = new Map(probe.map((p) => [p.selector, p.found]));
  const missingIn = (group: SignedWriteIntent[]) =>
    group
      .filter((i) => isProbed(i) && found.get(i.selector) !== true)
      .map((i) => i.selector);

  if (currentPage) {
    const group = intents.filter(
      (i) => i.page != null && pageMatches(currentPage, i.page),
    );
    if (group.length > 0) {
      const missing = missingIn(group);
      if (missing.length > 0)
        return { ok: false, reason: 'partial_page', missing };
      return { ok: true, intents: group, pages: [group[0].page as string] };
    }
    // No page group for this path. Page-less (legacy) mappings still get the
    // all-or-nothing rule below; page-bound ones have nothing to do here.
    if (!intents.some((i) => i.page == null))
      return {
        ok: false,
        reason: 'none_present',
        missing: intents.map((i) => i.selector),
      };
  }

  const groups = new Map<string, SignedWriteIntent[]>();
  for (const i of intents) {
    if (currentPage && i.page != null) continue;
    const key = i.page ?? '';
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }

  const complete: string[] = [];
  const partialMissing: string[] = [];
  for (const [page, group] of groups) {
    const missing = missingIn(group);
    const probed = group.filter(isProbed).length;
    if (missing.length === 0) complete.push(page);
    else if (missing.length < probed) partialMissing.push(...missing);
  }

  if (partialMissing.length > 0)
    return { ok: false, reason: 'partial_page', missing: partialMissing };
  if (complete.length === 0)
    return {
      ok: false,
      reason: 'none_present',
      missing: intents.map((i) => i.selector),
    };
  const run = new Set(complete);
  return {
    ok: true,
    intents: intents.filter(
      (i) => !(currentPage && i.page != null) && run.has(i.page ?? ''),
    ),
    pages: complete,
  };
}
