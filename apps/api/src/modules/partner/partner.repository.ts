import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PartnerEnvironment,
  PartnerEventType,
  PartnerScope,
} from '@visaai/types';

/**
 * Persistence contract for the partner platform.
 *
 * Every method takes the client explicitly rather than closing over one. That
 * is deliberate and load-bearing here: partner traffic has no user JWT, so the
 * runtime path uses the service-role client and the caller is responsible for
 * passing the right one. Making it a parameter keeps that choice visible at
 * every call site instead of hidden in a constructor.
 */

export interface PartnerRow {
  id: string;
  organization_id: string;
  legal_name: string;
  contact_email: string;
  website: string | null;
  status: 'pending' | 'approved' | 'suspended' | 'rejected';
  tier: 'standard' | 'scale' | 'enterprise';
  status_reason: string | null;
  created_at: string;
}

export interface PartnerApplicationRow {
  id: string;
  partner_id: string;
  name: string;
  description: string | null;
  environment: PartnerEnvironment;
  client_id: string;
  client_secret_hash: string | null;
  client_type: 'confidential' | 'public';
  status: 'pending_review' | 'active' | 'suspended' | 'revoked';
  scopes: PartnerScope[];
  requested_scopes: PartnerScope[];
  grant_types: string[];
  redirect_uris: string[];
  ip_allowlist: string[];
  status_reason: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PartnerApiKeyRow {
  id: string;
  application_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  last_four: string;
  scopes: PartnerScope[];
  status: 'active' | 'rotating' | 'revoked';
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PartnerAccessTokenRow {
  id: string;
  application_id: string;
  token_hash: string;
  scopes: PartnerScope[];
  grant_type: 'client_credentials' | 'authorization_code';
  subject_user_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface PartnerAuthorizationCodeRow {
  id: string;
  application_id: string;
  code_hash: string;
  subject_user_id: string;
  scopes: PartnerScope[];
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface PartnerConsentRow {
  id: string;
  application_id: string;
  user_id: string;
  scopes: PartnerScope[];
  granted_at: string;
  revoked_at: string | null;
}

export interface PartnerEventRow {
  id: string;
  organization_id: string | null;
  subject_user_id: string | null;
  event_type: PartnerEventType;
  resource_type: string;
  resource_id: string | null;
  environment: PartnerEnvironment;
  payload: Record<string, unknown>;
  sequence: number;
  created_at: string;
}

export interface PartnerWebhookEndpointRow {
  id: string;
  application_id: string;
  url: string;
  description: string | null;
  events: PartnerEventType[];
  status: 'pending_verification' | 'active' | 'disabled';
  secret_encrypted: string;
  previous_secret_encrypted: string | null;
  previous_secret_expires_at: string | null;
  verification_token: string | null;
  verified_at: string | null;
  consecutive_failures: number;
  disabled_reason: string | null;
  created_at: string;
}

export interface PartnerWebhookDeliveryRow {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: PartnerEventType;
  status: 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead';
  attempt_count: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error: string | null;
  duration_ms: number | null;
  delivered_at: string | null;
  replayed_from: string | null;
  created_at: string;
}

export interface IdempotencyRecord {
  idempotency_key: string;
  request_hash: string;
  state: 'in_progress' | 'completed';
  status_code: number | null;
  response_body: unknown;
}

export interface RequestLogEntry {
  applicationId: string;
  environment: PartnerEnvironment;
  method: string;
  routeTemplate: string;
  apiVersion: string;
  statusCode: number;
  latencyMs: number;
  requestId: string;
  credentialKind: 'api_key' | 'oauth_token';
  credentialId: string | null;
  errorCode: string | null;
}

export interface SandboxResourceRow {
  id: string;
  application_id: string;
  resource_type: string;
  resource_key: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface IPartnerRepository {
  // --- partners & applications ---
  getPartnerByOrganization(
    db: SupabaseClient,
    organizationId: string,
  ): Promise<PartnerRow | null>;
  getPartner(db: SupabaseClient, id: string): Promise<PartnerRow | null>;
  createPartner(
    db: SupabaseClient,
    input: Omit<PartnerRow, 'id' | 'created_at' | 'status_reason'>,
  ): Promise<PartnerRow>;
  updatePartnerStatus(
    db: SupabaseClient,
    id: string,
    status: PartnerRow['status'],
    reason: string | null,
    approverId: string | null,
  ): Promise<PartnerRow>;

  listApplications(
    db: SupabaseClient,
    partnerId: string,
  ): Promise<PartnerApplicationRow[]>;
  getApplication(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerApplicationRow | null>;
  getApplicationByClientId(
    db: SupabaseClient,
    clientId: string,
  ): Promise<PartnerApplicationRow | null>;
  createApplication(
    db: SupabaseClient,
    input: Partial<PartnerApplicationRow> & {
      partner_id: string;
      name: string;
      environment: PartnerEnvironment;
      client_id: string;
      created_by?: string | null;
    },
  ): Promise<PartnerApplicationRow>;
  updateApplication(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerApplicationRow>,
  ): Promise<PartnerApplicationRow>;

  // --- credentials ---
  listApiKeys(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<PartnerApiKeyRow[]>;
  getApiKeyByPrefix(
    db: SupabaseClient,
    prefix: string,
  ): Promise<PartnerApiKeyRow | null>;
  getApiKey(db: SupabaseClient, id: string): Promise<PartnerApiKeyRow | null>;
  createApiKey(
    db: SupabaseClient,
    input: Omit<
      PartnerApiKeyRow,
      'id' | 'created_at' | 'last_used_at' | 'revoked_at'
    > & { rotated_from?: string | null; created_by?: string | null },
  ): Promise<PartnerApiKeyRow>;
  updateApiKey(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerApiKeyRow> & { revoked_reason?: string | null },
  ): Promise<PartnerApiKeyRow>;
  touchApiKey(db: SupabaseClient, id: string, at: string): Promise<void>;

  createAccessToken(
    db: SupabaseClient,
    input: Omit<PartnerAccessTokenRow, 'id' | 'created_at' | 'revoked_at'>,
  ): Promise<PartnerAccessTokenRow>;
  getAccessTokenByHash(
    db: SupabaseClient,
    hash: string,
  ): Promise<PartnerAccessTokenRow | null>;
  revokeAccessToken(
    db: SupabaseClient,
    hash: string,
    at: string,
  ): Promise<boolean>;
  revokeTokensForApplication(
    db: SupabaseClient,
    applicationId: string,
    at: string,
  ): Promise<number>;
  touchAccessToken(db: SupabaseClient, id: string, at: string): Promise<void>;

  createAuthorizationCode(
    db: SupabaseClient,
    input: Omit<PartnerAuthorizationCodeRow, 'id' | 'consumed_at'>,
  ): Promise<PartnerAuthorizationCodeRow>;
  /** Atomically consume a code; null when it does not exist or was already used. */
  consumeAuthorizationCode(
    db: SupabaseClient,
    codeHash: string,
    at: string,
  ): Promise<PartnerAuthorizationCodeRow | null>;

  // --- consent ---
  getConsent(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ): Promise<PartnerConsentRow | null>;
  upsertConsent(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    scopes: PartnerScope[],
  ): Promise<PartnerConsentRow>;
  revokeConsent(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    at: string,
  ): Promise<boolean>;
  listConsentsForApplication(
    db: SupabaseClient,
    applicationId: string,
    limit: number,
    cursor: { createdAt: string; id: string } | null,
  ): Promise<PartnerConsentRow[]>;
  listConsentsForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<PartnerConsentRow[]>;

  // --- events & webhooks ---
  createEvent(
    db: SupabaseClient,
    input: Omit<PartnerEventRow, 'id' | 'sequence' | 'created_at'>,
  ): Promise<PartnerEventRow>;
  getEvent(db: SupabaseClient, id: string): Promise<PartnerEventRow | null>;

  listEndpoints(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<PartnerWebhookEndpointRow[]>;
  listEndpointsForOrganization(
    db: SupabaseClient,
    organizationId: string,
    environment: PartnerEnvironment,
  ): Promise<PartnerWebhookEndpointRow[]>;
  getEndpoint(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerWebhookEndpointRow | null>;
  createEndpoint(
    db: SupabaseClient,
    input: Omit<
      PartnerWebhookEndpointRow,
      | 'id'
      | 'created_at'
      | 'consecutive_failures'
      | 'verified_at'
      | 'disabled_reason'
    >,
  ): Promise<PartnerWebhookEndpointRow>;
  updateEndpoint(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerWebhookEndpointRow> & { disabled_at?: string | null },
  ): Promise<PartnerWebhookEndpointRow>;
  deleteEndpoint(db: SupabaseClient, id: string): Promise<void>;

  /** Insert-if-absent; returns null when this event was already queued here. */
  enqueueDelivery(
    db: SupabaseClient,
    endpointId: string,
    event: PartnerEventRow,
    replayedFrom?: string | null,
  ): Promise<PartnerWebhookDeliveryRow | null>;
  claimDueDeliveries(
    db: SupabaseClient,
    limit: number,
    now: string,
  ): Promise<PartnerWebhookDeliveryRow[]>;
  updateDelivery(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerWebhookDeliveryRow>,
  ): Promise<void>;
  getDelivery(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerWebhookDeliveryRow | null>;
  listDeliveries(
    db: SupabaseClient,
    endpointId: string,
    limit: number,
    cursor: { createdAt: string; id: string } | null,
  ): Promise<PartnerWebhookDeliveryRow[]>;

  // --- usage, logging, idempotency ---
  incrementUsage(
    db: SupabaseClient,
    applicationId: string,
    windowKind: 'minute' | 'day' | 'month',
    windowStart: string,
  ): Promise<number>;
  readUsage(
    db: SupabaseClient,
    applicationId: string,
    windows: { kind: 'minute' | 'day' | 'month'; start: string }[],
  ): Promise<Record<string, number>>;
  logRequest(db: SupabaseClient, entry: RequestLogEntry): Promise<void>;

  /** Claim a key; returns the existing record when the key was seen before. */
  claimIdempotencyKey(
    db: SupabaseClient,
    applicationId: string,
    key: string,
    requestHash: string,
    routeTemplate: string,
    expiresAt: string,
  ): Promise<
    { claimed: true } | { claimed: false; existing: IdempotencyRecord }
  >;
  completeIdempotencyKey(
    db: SupabaseClient,
    applicationId: string,
    key: string,
    statusCode: number,
    body: unknown,
  ): Promise<void>;
  releaseIdempotencyKey(
    db: SupabaseClient,
    applicationId: string,
    key: string,
  ): Promise<void>;

  // --- sandbox ---
  listSandboxResources(
    db: SupabaseClient,
    applicationId: string,
    resourceType: string,
  ): Promise<SandboxResourceRow[]>;
  getSandboxResource(
    db: SupabaseClient,
    applicationId: string,
    resourceType: string,
    resourceKey: string,
  ): Promise<SandboxResourceRow | null>;
  upsertSandboxResource(
    db: SupabaseClient,
    applicationId: string,
    resourceType: string,
    resourceKey: string,
    data: Record<string, unknown>,
  ): Promise<SandboxResourceRow>;
  resetSandbox(db: SupabaseClient, applicationId: string): Promise<number>;
}
