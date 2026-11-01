/**
 * robots.txt evaluation for the source monitor.
 *
 * The spec's non-negotiable rule 9 is "respect source terms, robots directives,
 * copyright and access controls". That is not only an ethics position: a
 * monitoring job that ignores robots.txt gets VisaAI's egress IP banned from
 * the exact government sites the product depends on, and the failure mode is
 * silent — sources start returning 403 and the data quietly goes stale.
 *
 * So robots is evaluated per-URL, per-run, and a `disallowed` result is
 * recorded on the source row rather than retried. A disallowed source is not a
 * broken source: VisaAI keeps its metadata and links users to the official page
 * instead of caching it. That is the correct product behaviour anyway.
 *
 * IMPLEMENTATION NOTES
 *
 * Follows the Robots Exclusion Protocol as standardised in RFC 9309:
 *   - the most SPECIFIC matching group wins (longest matching user-agent),
 *     not the first
 *   - within a group, the longest matching path rule wins
 *   - Allow beats Disallow on an equal-length match
 *   - `Disallow:` with an empty value allows everything
 *   - a missing or unparseable robots.txt means allowed (RFC 9309 §2.3.1.4:
 *     "unavailable" status means unrestricted crawling)
 *   - `*` and `$` wildcards are supported
 */

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one group; a rule line closes the
  // agent list, so the next User-agent starts a new group.
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue;
    collectingAgents = false;

    if (field === 'allow') current.rules.push({ allow: true, path: value });
    else if (field === 'disallow')
      current.rules.push({ allow: false, path: value });
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    }
  }

  return groups;
}

/** Longest matching user-agent token wins; `*` is the fallback group. */
export function selectGroup(
  groups: RobotsGroup[],
  userAgentToken: string,
): RobotsGroup | null {
  const token = userAgentToken.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLen = -1;

  for (const g of groups) {
    for (const a of g.agents) {
      if (a === '*') {
        if (bestLen < 0) {
          best = g;
          bestLen = 0;
        }
        continue;
      }
      if (token.includes(a) && a.length > bestLen) {
        best = g;
        bestLen = a.length;
      }
    }
  }
  return best;
}

/** Translate a robots path pattern (with `*` and `$`) into a regex. */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  // A trailing `$` in the ORIGINAL pattern anchors the match. After escaping,
  // it appears as `\$`.
  if (escaped.endsWith('\\$')) {
    return new RegExp(`^${escaped.slice(0, -2)}$`);
  }
  return new RegExp(`^${escaped}`);
}

export interface RobotsVerdict {
  allowed: boolean;
  /** The rule that decided it, for the audit trail. */
  matchedRule: string | null;
  crawlDelaySeconds: number | null;
}

export function isAllowed(
  robotsTxt: string | null,
  url: string,
  userAgentToken: string,
): RobotsVerdict {
  // RFC 9309: an unavailable robots.txt means unrestricted crawling. This is
  // the ONE place a missing file means "yes"; everywhere else in this codebase
  // missing data means "we do not know".
  if (robotsTxt === null || robotsTxt.trim() === '') {
    return { allowed: true, matchedRule: null, crawlDelaySeconds: null };
  }

  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return {
      allowed: false,
      matchedRule: 'malformed url',
      crawlDelaySeconds: null,
    };
  }

  const group = selectGroup(parseRobots(robotsTxt), userAgentToken);
  if (!group) {
    return { allowed: true, matchedRule: null, crawlDelaySeconds: null };
  }

  let decision: RobotsVerdict = {
    allowed: true,
    matchedRule: null,
    crawlDelaySeconds: group.crawlDelaySeconds ?? null,
  };
  let bestLength = -1;

  for (const rule of group.rules) {
    // `Disallow:` with an empty value explicitly allows everything and must
    // not be treated as a zero-length match on every path.
    if (rule.path === '') {
      if (!rule.allow && bestLength < 0) {
        decision = {
          ...decision,
          allowed: true,
          matchedRule: 'Disallow: (empty)',
        };
      }
      continue;
    }
    if (!patternToRegex(rule.path).test(path)) continue;

    const len = rule.path.length;
    // Longest match wins; on a tie, Allow beats Disallow (RFC 9309 §2.2.2).
    if (
      len > bestLength ||
      (len === bestLength && rule.allow && !decision.allowed)
    ) {
      bestLength = len;
      decision = {
        ...decision,
        allowed: rule.allow,
        matchedRule: `${rule.allow ? 'Allow' : 'Disallow'}: ${rule.path}`,
      };
    }
  }

  return decision;
}
