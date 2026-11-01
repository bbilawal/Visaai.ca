/**
 * Deep-link routing and authorization.
 *
 * Two untrusted sources land here: a push payload (`data.path`) and a
 * universal/app link opened from outside the app. Both are attacker-influencable
 * — anyone can craft `visaai://...` and a compromised push channel could send an
 * arbitrary path — so a link may only ever *navigate*. It can never authenticate,
 * authorize, or carry data that the app then trusts.
 *
 * Rules enforced here:
 *  1. Allowlist of route shapes. An unknown path resolves to the dashboard.
 *  2. Ids must be UUIDs; anything else is rejected rather than interpolated
 *     into an API path.
 *  3. Protected targets are marked `requiresAuth`, so the router parks them
 *     until the session (and the biometric gate) is satisfied. The API re-checks
 *     ownership regardless — a deep link never widens access.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Destination {
  /** expo-router pathname. */
  pathname: string;
  params?: Record<string, string>;
  requiresAuth: boolean;
}

export const DASHBOARD: Destination = { pathname: '/(app)/dashboard', requiresAuth: true };

interface RoutePattern {
  /** Path segments; `:param` captures a UUID. */
  pattern: string[];
  build: (params: Record<string, string>) => Destination;
}

const ROUTES: RoutePattern[] = [
  {
    pattern: ['applications', ':id'],
    build: (p) => ({
      pathname: '/(app)/applications/[id]',
      params: { id: p.id as string },
      requiresAuth: true,
    }),
  },
  {
    pattern: ['applications', ':id', 'messages'],
    build: (p) => ({
      pathname: '/(app)/applications/[id]/messages',
      params: { id: p.id as string },
      requiresAuth: true,
    }),
  },
  {
    pattern: ['applications', ':id', 'documents'],
    build: (p) => ({
      pathname: '/(app)/applications/[id]/documents',
      params: { id: p.id as string },
      requiresAuth: true,
    }),
  },
  {
    // Shape emitted by the server's notification feed
    // (notification-feed.service.ts builds `/messages/<applicationId>`).
    // Without this every message notification fell back to the dashboard.
    pattern: ['messages', ':id'],
    build: (p) => ({
      pathname: '/(app)/applications/[id]/messages',
      params: { id: p.id as string },
      requiresAuth: true,
    }),
  },
  {
    pattern: ['appointments'],
    build: () => ({ pathname: '/(app)/appointments', requiresAuth: true }),
  },
  {
    pattern: ['notifications'],
    build: () => ({ pathname: '/(app)/notifications', requiresAuth: true }),
  },
  {
    pattern: ['billing'],
    build: () => ({ pathname: '/(app)/billing', requiresAuth: true }),
  },
  {
    // Payment return leg from the external browser. Carries no secret: the app
    // re-reads billing state from the API rather than trusting the URL.
    pattern: ['payment', 'return'],
    build: () => ({ pathname: '/(app)/billing', params: { returned: '1' }, requiresAuth: true }),
  },
  {
    pattern: ['consultants'],
    build: () => ({ pathname: '/(app)/consultants', requiresAuth: true }),
  },
];

function segments(path: string): string[] {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(path);
  let rest = schemeMatch ? path.slice(schemeMatch[0].length) : path;

  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase();
    // For a web URL the first segment is the host and must be discarded
    // (`https://visaai.co/applications/…`). For a custom scheme it is already
    // part of the path (`visaai://applications/…`) — dropping it there would
    // silently turn every deep link into its own sub-path and route wrongly.
    if (scheme === 'http' || scheme === 'https') {
      const slash = rest.indexOf('/');
      rest = slash === -1 ? '/' : rest.slice(slash);
    }
  }

  return rest
    .split('?')[0]!
    .split('#')[0]!
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment).trim();
      } catch {
        // decodeURIComponent THROWS URIError on a lone '%' or a bad escape.
        // Unguarded, a hostile push payload crashed the app on tap and again on
        // every cold start until the notification was cleared.
        return segment.trim();
      }
    })
    .filter(Boolean);
}

/**
 * Resolve an untrusted path to a destination. Unknown or malformed input falls
 * back to the dashboard — never to a raw pathname, which would let a crafted
 * link push an arbitrary route.
 */
export function resolveDeepLink(rawPath: string | null | undefined): Destination {
  if (!rawPath) return DASHBOARD;
  let parts: string[];
  try {
    parts = segments(rawPath);
  } catch {
    // Belt and braces: resolution must never be able to throw into a caller.
    return DASHBOARD;
  }
  if (parts.length === 0) return DASHBOARD;

  for (const route of ROUTES) {
    if (route.pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < route.pattern.length; i++) {
      const expected = route.pattern[i] as string;
      const actual = parts[i] as string;
      if (expected.startsWith(':')) {
        // Reject anything that is not a UUID before it reaches an API path.
        if (!UUID.test(actual)) {
          matched = false;
          break;
        }
        params[expected.slice(1)] = actual;
      } else if (expected !== actual.toLowerCase()) {
        matched = false;
        break;
      }
    }

    if (matched) return route.build(params);
  }

  return DASHBOARD;
}

/** Extract the routable path from a push notification payload. */
export function destinationFromPushData(data: unknown): Destination {
  if (!data || typeof data !== 'object') return DASHBOARD;
  const record = data as Record<string, unknown>;

  if (typeof record.path === 'string') return resolveDeepLink(record.path);

  // Fall back to reconstructing from ids when the sender omitted `path`.
  const applicationId = record.applicationId;
  if (typeof applicationId === 'string' && UUID.test(applicationId)) {
    return record.conversationId
      ? resolveDeepLink(`/applications/${applicationId}/messages`)
      : resolveDeepLink(`/applications/${applicationId}`);
  }
  return DASHBOARD;
}
