import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type EventSource = 'server' | 'client';
export type JsonScalar = string | number | boolean | null;

// All event names, grouped by producer. Client-emittable names are a subset.
export const SERVER_EVENT_NAMES = [
  'user.registered',
  'user.signed_in',
  'user.active',
  'user.identified',
  'application.created',
  'application.visa_type_set',
  'application.stage_advanced',
  'application.completed',
  'consultant.assigned',
  'review.completed',
  'admin.action',
  'ai.request',
  'ai.completed',
  'ai.escalated',
  'quote.generated',
  'payment.succeeded',
  'payment.failed',
  'subscription.started',
  'subscription.canceled',
  'notification.sent',
  'audit.mirrored',
] as const;

export const CLIENT_EVENT_NAMES = [
  'page.viewed',
  'session.started',
  'session.ended',
  'funnel.step',
  'feature.used',
  'user.identified', // client emits this at login to link anon → user
] as const;

export type AnalyticsEventName =
  | (typeof SERVER_EVENT_NAMES)[number]
  | (typeof CLIENT_EVENT_NAMES)[number];

const ALL_NAMES = new Set<string>([
  ...SERVER_EVENT_NAMES,
  ...CLIENT_EVENT_NAMES,
]);
const CLIENT_NAMES = new Set<string>(CLIENT_EVENT_NAMES);

export interface AnalyticsEvent {
  event_id: string;
  name: AnalyticsEventName;
  occurred_at: string;
  source: EventSource;
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  application_id: string | null;
  schema_version: number;
  props: Record<string, JsonScalar>;
}

const SCHEMA_VERSION = 1;

export function makeServerEvent(
  name: (typeof SERVER_EVENT_NAMES)[number],
  partial: Partial<
    Omit<
      AnalyticsEvent,
      'name' | 'source' | 'event_id' | 'occurred_at' | 'schema_version'
    >
  > = {},
): AnalyticsEvent {
  return {
    event_id: randomUUID(),
    name,
    occurred_at: new Date().toISOString(),
    source: 'server',
    user_id: partial.user_id ?? null,
    anonymous_id: partial.anonymous_id ?? null,
    session_id: partial.session_id ?? null,
    application_id: partial.application_id ?? null,
    schema_version: SCHEMA_VERSION,
    props: partial.props ?? {},
  };
}

// Untrusted client payload → validated AnalyticsEvent, or null if invalid.
// NOTE: zod v4's `.uuid()` enforces RFC-4122 variant/version nibbles, which
// would reject otherwise-well-formed 36-char UUID strings (e.g. all-1s test
// vectors). We only need shape validation for an id the client generates, so
// we match the canonical 8-4-4-4-12 hex layout instead.
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const jsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const clientSchema = z.object({
  event_id: z.string().regex(UUID_RE, 'invalid event_id'),
  name: z
    .string()
    .refine((n) => CLIENT_NAMES.has(n), 'not a client-emittable event'),
  occurred_at: z.string().datetime(),
  anonymous_id: z.string().min(1).max(128).nullable().optional(),
  session_id: z.string().min(1).max(128).nullable().optional(),
  application_id: z
    .string()
    .regex(UUID_RE, 'invalid application_id')
    .nullable()
    .optional(),
  props: z.record(z.string(), jsonScalar).default({}),
});

export function parseClientEvent(raw: unknown): AnalyticsEvent | null {
  const r = clientSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  if (!ALL_NAMES.has(d.name)) return null;
  return {
    event_id: d.event_id,
    name: d.name as AnalyticsEventName,
    occurred_at: d.occurred_at,
    source: 'client',
    user_id: null, // set by the controller from the JWT for non-anon callers
    anonymous_id: d.anonymous_id ?? null,
    session_id: d.session_id ?? null,
    application_id: d.application_id ?? null,
    schema_version: SCHEMA_VERSION,
    props: d.props,
  };
}
