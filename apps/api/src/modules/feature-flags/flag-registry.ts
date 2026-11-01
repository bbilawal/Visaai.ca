/**
 * The set of feature flags that exist.
 *
 * Flags are DECLARED here and only their *state* lives in `public.feature_flags`.
 * The split matters for three reasons:
 *
 *   1. A typo in an admin call cannot conjure a live flag — an unregistered key
 *      is rejected by the admin API and ignored by the evaluator.
 *   2. Every flag has a `defaultValue` the evaluator can fall back to when the
 *      database is unreachable, so a Supabase outage degrades to a known state
 *      instead of an arbitrary one.
 *   3. Removing a flag is a code change that goes through review, which is the
 *      only thing that reliably stops a codebase accumulating dead flags.
 *
 * `defaultValue` is the answer when we cannot ask the database. Choose it as
 * "what should happen if the flag system itself is broken", which is NOT always
 * `false`: turning AI generation off because a cache read failed would take the
 * product down, so its default is `true`. For a genuinely new feature, `false`.
 */
export interface FlagDefinition {
  key: string;
  description: string;
  /**
   * Evaluation result when flag state cannot be read (DB error, unseeded row).
   * Read it as "fail to this value", not "initial value".
   */
  defaultValue: boolean;
  /**
   * Whether `GET /feature-flags` may return this flag to a browser or mobile
   * client. Server-only flags stay off the wire entirely — a client that cannot
   * see a flag cannot infer what is being rolled out to whom.
   */
  clientExposed: boolean;
  /**
   * Kill switches guard a subsystem that is already carrying traffic. They are
   * called out so the admin UI and the incident runbook can list them together,
   * and so a reviewer notices when a new one is added.
   */
  killSwitch: boolean;
  owner: string;
}

export const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    key: 'ai_generation_enabled',
    description: 'AI document generation and case processing.',
    // Live subsystem: a flag-store failure must not stop the product.
    defaultValue: true,
    clientExposed: true,
    killSwitch: true,
    owner: 'ai',
  },
  {
    key: 'payments_enabled',
    description: 'Checkout, subscriptions and any charge path.',
    defaultValue: true,
    clientExposed: true,
    killSwitch: true,
    owner: 'payments',
  },
  {
    key: 'consultant_marketplace_enabled',
    description: 'Consultant discovery, booking and messaging.',
    defaultValue: true,
    clientExposed: true,
    killSwitch: true,
    owner: 'marketplace',
  },
  {
    key: 'portal_autofill_enabled',
    description:
      'Government-portal auto-fill via the extension/sidecar. Highest-risk surface.',
    // Defaults OFF: driving a browser against a government portal is the one
    // action here with an irreversible external effect, so an unknown flag
    // state must not permit it.
    defaultValue: false,
    clientExposed: true,
    killSwitch: true,
    owner: 'automation',
  },
  {
    key: 'voice_assistant_enabled',
    description: 'AI voice assistant sessions.',
    // Off until Task 10's missing device run is evidenced.
    defaultValue: false,
    clientExposed: true,
    killSwitch: true,
    owner: 'ai',
  },
  {
    key: 'beta_banner_enabled',
    description: 'Closed-beta banner: "do not use for a real filing".',
    defaultValue: false,
    clientExposed: true,
    killSwitch: false,
    owner: 'product',
  },
  {
    key: 'beta_feedback_widget_enabled',
    description: 'In-app feedback widget.',
    defaultValue: false,
    clientExposed: true,
    killSwitch: false,
    owner: 'product',
  },
] as const;

const BY_KEY = new Map(FLAG_DEFINITIONS.map((d) => [d.key, d]));

export function getFlagDefinition(key: string): FlagDefinition | undefined {
  return BY_KEY.get(key);
}

export function isRegisteredFlag(key: string): boolean {
  return BY_KEY.has(key);
}

export function registeredFlagKeys(): string[] {
  return [...BY_KEY.keys()];
}
