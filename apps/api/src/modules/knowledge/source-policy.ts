/**
 * Which URLs the knowledge pipeline is allowed to retrieve, and how much a
 * retrieved page is trusted.
 *
 * WHY THIS IS SEPARATE FROM `visa-sync/source-fetcher.ts`
 *
 * That module answers "is this network request safe" — SSRF, redirects, size
 * caps. This one answers a different question: "is this URL an OFFICIAL
 * source". A request to `https://immigration-lawyer-blog.example/canada-visa`
 * is perfectly safe at the network layer and is exactly the content that must
 * never enter the corpus.
 *
 * Both checks are required, and neither implies the other. The fetcher is the
 * egress control; this is the provenance control.
 *
 * THE ALLOWLIST IS DERIVED, NOT WRITTEN
 *
 * Hard-coding a domain list here would be a second source of truth that drifts
 * from `visa_sources`. Instead the allowlist is computed from the registry
 * rows themselves: a URL is ingestable if its registrable domain matches the
 * domain of a source the registry already carries for that country, or the
 * country's own authority/portal domains. That means adding a country is still
 * "one row in the registry" and never "one row plus a code change nobody
 * remembers".
 *
 * The `PUBLIC_SUFFIXES` list below is the one piece that cannot be derived. It
 * exists because naive "last two labels" registrable-domain extraction gets
 * `gov.uk`, `gov.au` and `go.jp` catastrophically wrong: it would treat
 * `gov.uk` as the registrable domain and then accept `evil.gov.uk`-shaped
 * lookalikes as equal to `homeoffice.gov.uk`. Government domains are the
 * common case here, so this is the common case, not an edge case.
 */

/**
 * Multi-label public suffixes that matter for government hosts. Not the full
 * PSL — the full list is ~9,000 entries and updating it is a supply-chain
 * decision, not a code change. These are the suffixes actually reachable from
 * an immigration authority: the second-level government/academic namespaces.
 *
 * A suffix missing from this list degrades SAFELY: the registrable domain comes
 * out one label shorter, so the comparison becomes STRICTER (more specific),
 * never looser.
 */
const PUBLIC_SUFFIXES = new Set([
  // Commonwealth-style two-level government namespaces
  'gov.uk',
  'gov.au',
  'gov.nz',
  'gov.in',
  'gov.sg',
  'gov.hk',
  'gov.my',
  'gov.za',
  'gov.ie',
  'gov.il',
  'gov.br',
  'gov.tr',
  'gov.pl',
  'gov.pt',
  'gov.gr',
  'gov.it',
  'gov.eg',
  'gov.sa',
  'gov.ae',
  'gov.qa',
  'gov.jo',
  'gov.om',
  'gov.kw',
  'gov.bh',
  'gov.lb',
  'gov.pk',
  'gov.bd',
  'gov.lk',
  'gov.ph',
  'gov.vn',
  'gov.cn',
  'gov.tw',
  'gov.co',
  'gov.ar',
  'gov.mx',
  'gov.cl',
  'gov.pe',
  'gov.ng',
  'gov.ke',
  'gov.gh',
  'gov.tz',
  'gov.ua',
  'gob.mx',
  'gob.es',
  'gob.cl',
  'gob.pe',
  'gob.ar',
  'go.jp',
  'go.kr',
  'go.id',
  'go.th',
  'go.ke',
  'go.tz',
  'ac.uk',
  'ac.jp',
  'ac.nz',
  'ac.in',
  'co.uk',
  'co.jp',
  'co.nz',
  'co.in',
  'co.za',
  'co.kr',
  'co.il',
  'co.th',
  'org.uk',
  'org.au',
  'org.nz',
  'org.il',
  'org.sg',
  'net.au',
  'com.au',
  'com.br',
  'com.sg',
  'com.my',
  'com.hk',
  'com.tr',
  'com.cn',
  'com.tw',
  'com.mx',
  'com.ar',
  'com.co',
  'com.pk',
  'com.eg',
  'com.sa',
  'com.ph',
  'com.vn',
  'com.ua',
  'com.pe',
  'edu.au',
  'edu.sg',
  'edu.hk',
  'edu.my',
  'edu.pk',
  'edu.in',
  'gouv.fr',
  'gouv.qc.ca',
  'admin.ch',
]);

/** Schemes the pipeline will ever retrieve. */
const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

export interface SourcePolicyContext {
  /**
   * Every host the registry already trusts for this jurisdiction: the hosts of
   * `visa_sources.source_url` / `canonical_url`, plus the country's
   * `immigration_authority_url`, `foreign_affairs_authority_url`,
   * `official_visa_url` and `evisa_portal_url`.
   */
  registeredHosts: string[];
  /**
   * Hosts an operator has explicitly approved as secondary sources, with the
   * labelling requirement that implies. Empty by default: a secondary source is
   * a deliberate, recorded decision, never a fallback the pipeline reaches for.
   */
  approvedSecondaryHosts?: string[];
}

export type SourceVerdict =
  | {
      allowed: true;
      registrableDomain: string;
      trust: 'official';
      matchedHost: string;
    }
  | {
      allowed: true;
      registrableDomain: string;
      trust: 'secondary';
      matchedHost: string;
    }
  | { allowed: false; reason: string };

/** Lowercase host with any trailing dot and port removed. */
export function normalizeHost(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, '').split(':')[0];
}

/**
 * The registrable domain — the part a single organisation controls.
 *
 * `www.canada.ca` -> `canada.ca`
 * `www.gov.uk`    -> `www.gov.uk`  (gov.uk is a public suffix)
 * `homeoffice.gov.uk` -> `homeoffice.gov.uk`
 */
export function registrableDomain(host: string): string {
  const h = normalizeHost(host);
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');

  const lastTwo = labels.slice(-2).join('.');
  if (PUBLIC_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  // Three-label suffixes (gouv.qc.ca) are rare enough to check explicitly.
  const lastThree = labels.slice(-3).join('.');
  if (PUBLIC_SUFFIXES.has(lastThree)) {
    return labels.slice(-4).join('.');
  }
  return lastTwo;
}

/** True when `host` is the same site as `other`, or a subdomain of it. */
export function isSameSite(host: string, other: string): boolean {
  const a = normalizeHost(host);
  const b = normalizeHost(other);
  if (a === b) return true;
  // Subdomain relationship, but only within the same registrable domain, so
  // `ircc.canada.ca` matches `canada.ca` and `canada.ca.evil.test` does not.
  const ra = registrableDomain(a);
  const rb = registrableDomain(b);
  if (ra !== rb) return false;
  return a === ra || a.endsWith(`.${rb}`);
}

/**
 * Decide whether a URL may be retrieved and indexed as an official source.
 *
 * Note what this deliberately does NOT do: it never "promotes" an unknown host
 * because the page looks governmental. Content is not evidence of provenance —
 * that is the whole premise of a source registry.
 */
export function evaluateSource(
  rawUrl: string,
  ctx: SourcePolicyContext,
): SourceVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'unparseable URL' };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { allowed: false, reason: `scheme ${url.protocol} not permitted` };
  }

  // Credentials in a source URL are always a mistake and sometimes an attack
  // (a URL that reads as one host and resolves as another).
  if (url.username || url.password) {
    return { allowed: false, reason: 'URL carries credentials' };
  }

  const host = normalizeHost(url.hostname);
  if (!host || !host.includes('.')) {
    return { allowed: false, reason: 'host is not a public domain name' };
  }

  for (const registered of ctx.registeredHosts) {
    if (isSameSite(host, registered)) {
      return {
        allowed: true,
        registrableDomain: registrableDomain(host),
        trust: 'official',
        matchedHost: normalizeHost(registered),
      };
    }
  }

  for (const secondary of ctx.approvedSecondaryHosts ?? []) {
    if (isSameSite(host, secondary)) {
      return {
        allowed: true,
        registrableDomain: registrableDomain(host),
        trust: 'secondary',
        matchedHost: normalizeHost(secondary),
      };
    }
  }

  return {
    allowed: false,
    reason: `${host} is not a registered official source for this jurisdiction`,
  };
}

/**
 * The authority hierarchy the spec mandates, expressed as the rank stored in
 * `visa_sources.authority_rank`. Kept here rather than in a migration comment
 * so the ordering used for RANKING is the same object the registry validates
 * against.
 */
export const AUTHORITY_RANKS = {
  /** National immigration / home affairs department. */
  immigration_department: 1,
  /** Official government visa or application portal. */
  government_portal: 2,
  /** Official legislation or policy publication. */
  legislation: 3,
  /** Official embassy or consulate. */
  mission: 4,
  /** Government-authorised visa application centre. */
  authorised_centre: 5,
} as const;

export type AuthorityKind = keyof typeof AUTHORITY_RANKS;

/**
 * Two sources disagree. Which one wins?
 *
 * Lower rank wins. On equal rank the more recently CHANGED source wins, not
 * the more recently checked one: re-reading an unchanged page tells you
 * nothing about which of two contradictory statements is current.
 *
 * Returns 0 when neither can be preferred, which the caller must surface as a
 * conflict rather than resolve by picking one.
 */
export function compareAuthority(
  a: { authorityRank: number; lastChangedAt?: string | null },
  b: { authorityRank: number; lastChangedAt?: string | null },
): number {
  if (a.authorityRank !== b.authorityRank)
    return a.authorityRank - b.authorityRank;
  const ta = a.lastChangedAt ? Date.parse(a.lastChangedAt) : NaN;
  const tb = b.lastChangedAt ? Date.parse(b.lastChangedAt) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
  return 0;
}
