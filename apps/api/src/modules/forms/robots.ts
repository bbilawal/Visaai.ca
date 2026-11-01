import { defaultHttp, type FetchLike } from './http';

/**
 * A deliberately small robots.txt reader.
 *
 * Scope: the `User-agent: *` group only. VisaAI does not register a named
 * crawler, so a rule addressed to some other agent is not ours to obey or to
 * ignore — it simply does not apply.
 *
 * This exists because canada.ca disallows INDIVIDUAL form PDFs by filename
 * (imm0143e.pdf, imm0144e.pdf) alongside directory prefixes (imm5444/). A
 * host-level allow/deny would either block every IRCC form or fetch ones we
 * have been asked not to. The check must be per URL.
 */

/** Disallow patterns of the `User-agent: *` group, in file order. */
export function parseRobots(body: string): string[] {
  const out: string[] = [];
  let inStar = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      inStar = value === '*';
      continue;
    }
    // An empty Disallow means "allow everything" — it is not a pattern.
    if (field === 'disallow' && inStar && value) out.push(value);
  }
  return out;
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  // Escape every regex metacharacter, THEN reinstate `*` as a wildcard.
  // Escaping after expanding `*` would re-escape the `.*` we just inserted.
  const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    '^' + escaped.replace(/\\\*/g, '.*') + (anchored ? '$' : ''),
  );
}

export function isPathAllowed(patterns: string[], path: string): boolean {
  return !patterns.some((p) => toRegExp(p).test(path));
}

/** The three states a robots.txt check can settle to. See `RobotsGate.check`. */
export type RobotsCheck = 'allowed' | 'disallowed' | 'unknown';

/**
 * Per-host robots.txt cache. One fetch per host per process lifetime for a
 * SUCCESSFUL load — the refresh job runs daily, so staleness is bounded by
 * the process, and a restart re-reads.
 *
 * A successful load and a failed one are cached very differently:
 *
 *   - Success (rules parsed, OR a 404 meaning "no rules, allow everything")
 *     is cached for the life of the process, same as before.
 *   - Failure (the fetch threw, or returned a non-404 non-OK status) is
 *     explicitly NOT cached. Caching it would mean one transient canada.ca
 *     503 permanently blacks out the whole feature until a process restart —
 *     every later call would keep reusing the same failed result forever.
 *     Instead a failed load's cache entry is evicted the moment it settles,
 *     so the NEXT call (not a concurrent racer — see below) retries the
 *     fetch from scratch.
 *
 * The cache still stores the in-flight PROMISE, not the resolved value, and
 * it is set synchronously before the first `await`. Two `check()` calls that
 * race for the same uncached host both see the same pending promise on the
 * second one's turn, so only one `/robots.txt` request is ever issued for
 * that race — the second caller awaits the first fetch instead of starting
 * its own. Eviction on failure happens only AFTER that shared promise
 * settles, so it never defeats the race-collapsing behaviour; it only
 * affects calls that come after the failure is already known.
 */
export class RobotsGate {
  private readonly cache = new Map<string, Promise<string[] | null>>();

  constructor(private readonly http: FetchLike = defaultHttp) {}

  /**
   * The tri-state result. Callers that need to react differently to "this
   * URL is explicitly disallowed" versus "we could not determine the rules"
   * MUST use this — collapsing both to a single boolean is exactly the bug
   * that let one robots.txt fetch failure masquerade as a permanent
   * disallow (Important 1).
   */
  async check(url: string): Promise<RobotsCheck> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'unknown';
    }

    const host = parsed.origin;
    let pending = this.cache.get(host);
    if (!pending) {
      pending = this.load(host);
      this.cache.set(host, pending);
      // Do not let a failed load poison the cache forever. This attaches
      // BEFORE the `await pending` below, so it always settles first and a
      // failure is evicted before any caller — including this one — acts on
      // the result. Concurrent racers awaiting the same `pending` promise
      // still only ever trigger the one fetch above.
      pending.then((patterns) => {
        if (patterns === null) this.cache.delete(host);
      });
    }
    const patterns = await pending;
    if (patterns === null) return 'unknown';
    return isPathAllowed(patterns, parsed.pathname) ? 'allowed' : 'disallowed';
  }

  /**
   * Boolean convenience wrapper over `check()`. Fails closed: both
   * 'disallowed' and 'unknown' resolve to `false`. Kept for callers that
   * only need a yes/no answer; anything that must distinguish "explicitly
   * disallowed" from "could not determine" (the refresh service) must call
   * `check()` directly instead.
   */
  async allows(url: string): Promise<boolean> {
    return (await this.check(url)) === 'allowed';
  }

  private async load(origin: string): Promise<string[] | null> {
    try {
      const res = await this.http(`${origin}/robots.txt`);
      if (res.status === 404) return [];
      if (!res.ok) return null;
      return parseRobots(await res.text());
    } catch {
      return null;
    }
  }
}
