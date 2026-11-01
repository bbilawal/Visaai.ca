import type {
  PartnerApiProduct,
  PartnerEnvironment,
  PartnerScope,
} from '@visaai/types';

/**
 * The scope catalog and the rules for granting and checking scopes.
 *
 * Design rule, applied throughout: a scope may only ever NARROW access.
 *   application scopes ⊆ approved catalog
 *   key scopes         ⊆ application scopes
 *   token scopes       ⊆ application scopes (∩ requested)
 *   consented scopes   ⊆ token scopes for anything touching a user's data
 *
 * Nothing in this file can widen a grant. That is deliberate: every widening
 * path is a privilege-escalation bug waiting to be written.
 */

export interface ScopeDefinition {
  scope: PartnerScope;
  description: string;
  /** Reading a real person's immigration data requires their consent. */
  requiresUserConsent: boolean;
  /** Whether a partner can self-grant this in sandbox without review. */
  selfServiceSandbox: boolean;
  /** Live use requires explicit platform approval. */
  requiresApprovalForLive: boolean;
  dataClassification: 'public' | 'internal' | 'personal' | 'sensitive_personal';
}

export const SCOPE_CATALOG: readonly ScopeDefinition[] = [
  {
    scope: 'partner:read',
    description: 'Read your own partner identity, application and scopes',
    requiresUserConsent: false,
    selfServiceSandbox: true,
    requiresApprovalForLive: false,
    dataClassification: 'internal',
  },
  {
    scope: 'usage:read',
    description: 'Read your API usage, rate-limit and quota status',
    requiresUserConsent: false,
    selfServiceSandbox: true,
    requiresApprovalForLive: false,
    dataClassification: 'internal',
  },
  {
    scope: 'webhooks:read',
    description: 'List webhook endpoints and delivery history',
    requiresUserConsent: false,
    selfServiceSandbox: true,
    requiresApprovalForLive: false,
    dataClassification: 'internal',
  },
  {
    scope: 'webhooks:write',
    description: 'Create, update, rotate and delete webhook endpoints',
    requiresUserConsent: false,
    selfServiceSandbox: true,
    requiresApprovalForLive: false,
    dataClassification: 'internal',
  },
  {
    scope: 'applications:read',
    description: "Read a consenting user's visa applications and their status",
    requiresUserConsent: true,
    selfServiceSandbox: true,
    requiresApprovalForLive: true,
    dataClassification: 'sensitive_personal',
  },
  {
    scope: 'applications:write',
    description: 'Create a visa application on behalf of a consenting user',
    requiresUserConsent: true,
    selfServiceSandbox: true,
    requiresApprovalForLive: true,
    dataClassification: 'sensitive_personal',
  },
  {
    scope: 'documents:read',
    description:
      'Read document metadata and processing status (never document contents)',
    requiresUserConsent: true,
    selfServiceSandbox: true,
    requiresApprovalForLive: true,
    dataClassification: 'sensitive_personal',
  },
  {
    scope: 'consents:read',
    description: 'Read which users have granted your application access',
    requiresUserConsent: false,
    selfServiceSandbox: true,
    requiresApprovalForLive: true,
    dataClassification: 'personal',
  },
] as const;

const BY_SCOPE = new Map<string, ScopeDefinition>(
  SCOPE_CATALOG.map((d) => [d.scope, d]),
);

export const ALL_SCOPES: readonly PartnerScope[] = SCOPE_CATALOG.map(
  (d) => d.scope,
);

/** True when `value` is a scope the platform recognises. */
export function isKnownScope(value: string): value is PartnerScope {
  return BY_SCOPE.has(value);
}

export function scopeDefinition(scope: PartnerScope): ScopeDefinition {
  const def = BY_SCOPE.get(scope);
  // Unreachable for a PartnerScope; the throw documents the invariant.
  if (!def) throw new Error(`unknown scope: ${scope}`);
  return def;
}

/**
 * Filter an untrusted list down to recognised scopes, de-duplicated and
 * ordered by the catalog. Unknown entries are DROPPED, not rejected: an OAuth
 * client asking for a scope we do not have should get the subset it can have
 * (RFC 6749 §3.3 allows a narrower grant), and the response always states the
 * scopes actually issued.
 */
export function normalizeScopes(requested: readonly string[]): PartnerScope[] {
  const wanted = new Set(requested);
  return ALL_SCOPES.filter((s) => wanted.has(s));
}

/** Parse an OAuth space-delimited scope string. */
export function parseScopeString(value: string | undefined | null): string[] {
  if (!value) return [];
  return value.split(/\s+/).filter(Boolean);
}

export function formatScopeString(scopes: readonly PartnerScope[]): string {
  return scopes.join(' ');
}

/** True when every scope in `subset` is present in `granted`. */
export function isSubset(
  subset: readonly string[],
  granted: readonly string[],
): boolean {
  const set = new Set(granted);
  return subset.every((s) => set.has(s));
}

/**
 * The scopes a credential may actually carry: the intersection of what was
 * requested with what the application holds. Requesting more than the
 * application has yields the intersection, never an error — and never more.
 */
export function effectiveScopes(
  requested: readonly string[],
  applicationScopes: readonly PartnerScope[],
): PartnerScope[] {
  const held = new Set<string>(applicationScopes);
  const normalized = normalizeScopes(requested);
  const narrowed = normalized.filter((s) => held.has(s));
  // An empty request means "everything this application holds" (RFC 6749 §3.3
  // leaves the default to the server; issuing nothing would make the common
  // case unusable).
  return requested.length === 0 ? [...applicationScopes] : narrowed;
}

/** True when the caller's scopes satisfy the route's requirement. */
export function hasScope(
  granted: readonly string[],
  required: PartnerScope,
): boolean {
  return granted.includes(required);
}

/** Scopes in this set need a consent record from the subject user. */
export function consentRequiredScopes(
  scopes: readonly PartnerScope[],
): PartnerScope[] {
  return scopes.filter((s) => scopeDefinition(s).requiresUserConsent);
}

/**
 * Whether an application may hold `scopes` in `environment` given its approval
 * state. Sandbox is permissive by design — that is what a sandbox is for — but
 * live access to personal data requires a human approval.
 */
export function scopesGrantableWithoutApproval(
  scopes: readonly PartnerScope[],
  environment: PartnerEnvironment,
): boolean {
  if (environment === 'sandbox') {
    return scopes.every((s) => scopeDefinition(s).selfServiceSandbox);
  }
  return scopes.every((s) => !scopeDefinition(s).requiresApprovalForLive);
}

// ---- API product catalog ---------------------------------------------

/**
 * The partner-visible catalog. Governed, not open: every product states its
 * data classification, whether it needs user consent, and whether live access
 * needs approval. `planned` entries are listed honestly as planned rather than
 * implied by an undocumented gap.
 */
export const API_PRODUCTS: readonly PartnerApiProduct[] = [
  {
    key: 'partner-identity',
    name: 'Partner Identity',
    description:
      'Who you are calling as: application, environment, granted scopes.',
    required_scopes: ['partner:read'],
    data_classification: 'internal',
    environments: ['sandbox', 'live'],
    status: 'ga',
    requires_user_consent: false,
    requires_approval: false,
    slo: { availability: '99.9%', p95_latency_ms: 150 },
    docs_url: '/docs/partner-api/api-reference#partner-identity',
  },
  {
    key: 'usage-and-limits',
    name: 'Usage & Limits',
    description: 'Current rate-limit window, daily and monthly quota state.',
    required_scopes: ['usage:read'],
    data_classification: 'internal',
    environments: ['sandbox', 'live'],
    status: 'ga',
    requires_user_consent: false,
    requires_approval: false,
    slo: { availability: '99.9%', p95_latency_ms: 200 },
    docs_url: '/docs/partner-api/api-reference#usage',
  },
  {
    key: 'webhooks',
    name: 'Webhooks',
    description:
      'Register endpoints, subscribe to events, inspect and replay deliveries.',
    required_scopes: ['webhooks:read', 'webhooks:write'],
    data_classification: 'internal',
    environments: ['sandbox', 'live'],
    status: 'ga',
    requires_user_consent: false,
    requires_approval: false,
    slo: { availability: '99.9%', p95_latency_ms: 250 },
    docs_url: '/VISAAIDocs/partner-api/webhook-standard.md',
  },
  {
    key: 'visa-applications',
    name: 'Visa Applications',
    description:
      'Create and read visa applications for users who have consented.',
    required_scopes: ['applications:read', 'applications:write'],
    data_classification: 'sensitive_personal',
    environments: ['sandbox', 'live'],
    status: 'beta',
    requires_user_consent: true,
    requires_approval: true,
    slo: { availability: '99.5%', p95_latency_ms: 600 },
    docs_url: '/docs/partner-api/api-reference#applications',
  },
  {
    key: 'document-status',
    name: 'Document Status',
    description:
      "Metadata and processing status for a consenting user's documents. Never returns document contents or extracted field values.",
    required_scopes: ['documents:read'],
    data_classification: 'sensitive_personal',
    environments: ['sandbox', 'live'],
    status: 'beta',
    requires_user_consent: true,
    requires_approval: true,
    slo: { availability: '99.5%', p95_latency_ms: 600 },
    docs_url: '/docs/partner-api/api-reference#documents',
  },
  {
    key: 'eligibility',
    name: 'Eligibility Assessment',
    description:
      'Submit an eligibility assessment and retrieve its result. Not yet exposed — the internal assessment contract is still changing.',
    required_scopes: [],
    data_classification: 'sensitive_personal',
    environments: ['sandbox'],
    status: 'planned',
    requires_user_consent: true,
    requires_approval: true,
    slo: null,
    docs_url: '/docs/partner-api/api-reference#eligibility',
  },
  {
    key: 'appointments',
    name: 'Appointments & Consultant Booking',
    description:
      'Availability and booking against the consultant marketplace. Not yet exposed.',
    required_scopes: [],
    data_classification: 'personal',
    environments: ['sandbox'],
    status: 'planned',
    requires_user_consent: true,
    requires_approval: true,
    slo: null,
    docs_url: '/docs/partner-api/api-reference#appointments',
  },
  {
    key: 'payments',
    name: 'Payments & Subscriptions',
    description:
      'Initiate a payment or subscription on behalf of a user. Not exposed: partner-initiated payment needs a commercial and regulatory review that has not happened.',
    required_scopes: [],
    data_classification: 'sensitive_personal',
    environments: [],
    status: 'planned',
    requires_user_consent: true,
    requires_approval: true,
    slo: null,
    docs_url: '/docs/partner-api/api-reference#payments',
  },
] as const;

/** Products a caller holding `scopes` can actually use today. */
export function availableProducts(
  scopes: readonly PartnerScope[],
): PartnerApiProduct[] {
  return API_PRODUCTS.filter(
    (p) =>
      p.status !== 'planned' &&
      p.required_scopes.some((s) => scopes.includes(s)),
  );
}
