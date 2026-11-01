/* eslint-disable @typescript-eslint/require-await --
 * This implements a Promise-returning port over synchronous in-memory data.
 * The `async` keyword is the contract, not an oversight: dropping it would
 * mean hand-writing `Promise.resolve(...)` in ~40 methods.
 */
import { randomUUID } from 'node:crypto';
import type { PartnerEnvironment, PartnerScope } from '@visaai/types';
import type {
  IdempotencyRecord,
  IPartnerRepository,
  PartnerAccessTokenRow,
  PartnerApiKeyRow,
  PartnerApplicationRow,
  PartnerAuthorizationCodeRow,
  PartnerConsentRow,
  PartnerEventRow,
  PartnerRow,
  PartnerWebhookDeliveryRow,
  PartnerWebhookEndpointRow,
  RequestLogEntry,
  SandboxResourceRow,
} from './partner.repository';

/**
 * In-memory IPartnerRepository.
 *
 * Follows the MockAnalyticsReportsRepository precedent: a real implementation
 * of the port that lets the services be tested against their actual behaviour
 * rather than against `jest.fn()` stubs that agree with whatever the test
 * expects.
 *
 * It reproduces the two constraints the real schema enforces and the services
 * depend on — the unique (endpoint, event) delivery key and single-use
 * authorization codes — because a double that is more permissive than the
 * database turns a passing test into a false negative.
 *
 * `db` is ignored throughout; the signature exists so the double is
 * substitutable for the Supabase-backed implementation.
 */
export class InMemoryPartnerRepository implements IPartnerRepository {
  partners: PartnerRow[] = [];
  applications: PartnerApplicationRow[] = [];
  apiKeys: PartnerApiKeyRow[] = [];
  tokens: PartnerAccessTokenRow[] = [];
  codes: PartnerAuthorizationCodeRow[] = [];
  consents: PartnerConsentRow[] = [];
  events: PartnerEventRow[] = [];
  endpoints: PartnerWebhookEndpointRow[] = [];
  deliveries: PartnerWebhookDeliveryRow[] = [];
  requests: RequestLogEntry[] = [];
  usage = new Map<string, number>();
  idempotency = new Map<
    string,
    IdempotencyRecord & { application_id: string }
  >();
  sandbox: SandboxResourceRow[] = [];

  private sequence = 0;

  // ---- partners ---------------------------------------------------------

  async getPartnerByOrganization(_db: unknown, organizationId: string) {
    return (
      this.partners.find((p) => p.organization_id === organizationId) ?? null
    );
  }

  async getPartner(_db: unknown, id: string) {
    return this.partners.find((p) => p.id === id) ?? null;
  }

  async createPartner(
    _db: unknown,
    input: Omit<PartnerRow, 'id' | 'created_at' | 'status_reason'>,
  ) {
    const row: PartnerRow = {
      id: randomUUID(),
      status_reason: null,
      created_at: new Date().toISOString(),
      ...input,
    };
    this.partners.push(row);
    return row;
  }

  async updatePartnerStatus(
    _db: unknown,
    id: string,
    status: PartnerRow['status'],
    reason: string | null,
  ) {
    const row = this.partners.find((p) => p.id === id);
    if (!row) throw new Error('partner not found');
    row.status = status;
    row.status_reason = reason;
    return row;
  }

  // ---- applications -----------------------------------------------------

  async listApplications(_db: unknown, partnerId: string) {
    return this.applications.filter((a) => a.partner_id === partnerId);
  }

  async getApplication(_db: unknown, id: string) {
    return this.applications.find((a) => a.id === id) ?? null;
  }

  async getApplicationByClientId(_db: unknown, clientId: string) {
    return this.applications.find((a) => a.client_id === clientId) ?? null;
  }

  async createApplication(
    _db: unknown,
    input: Partial<PartnerApplicationRow> & {
      partner_id: string;
      name: string;
      environment: PartnerEnvironment;
      client_id: string;
    },
  ) {
    const row: PartnerApplicationRow = {
      id: randomUUID(),
      description: null,
      client_secret_hash: null,
      client_type: 'confidential',
      status: 'active',
      scopes: [],
      requested_scopes: [],
      grant_types: ['client_credentials'],
      redirect_uris: [],
      ip_allowlist: [],
      status_reason: null,
      revoked_at: null,
      created_at: new Date().toISOString(),
      ...input,
    };
    this.applications.push(row);
    return row;
  }

  async updateApplication(
    _db: unknown,
    id: string,
    patch: Partial<PartnerApplicationRow>,
  ) {
    const row = this.applications.find((a) => a.id === id);
    if (!row) throw new Error('application not found');
    Object.assign(row, patch);
    return row;
  }

  // ---- keys -------------------------------------------------------------

  async listApiKeys(_db: unknown, applicationId: string) {
    return this.apiKeys.filter((k) => k.application_id === applicationId);
  }

  async getApiKeyByPrefix(_db: unknown, prefix: string) {
    return this.apiKeys.find((k) => k.prefix === prefix) ?? null;
  }

  async getApiKey(_db: unknown, id: string) {
    return this.apiKeys.find((k) => k.id === id) ?? null;
  }

  async createApiKey(
    _db: unknown,
    input: Omit<
      PartnerApiKeyRow,
      'id' | 'created_at' | 'last_used_at' | 'revoked_at'
    >,
  ) {
    const row: PartnerApiKeyRow = {
      id: randomUUID(),
      last_used_at: null,
      revoked_at: null,
      created_at: new Date().toISOString(),
      ...input,
    };
    this.apiKeys.push(row);
    return row;
  }

  async updateApiKey(
    _db: unknown,
    id: string,
    patch: Partial<PartnerApiKeyRow>,
  ) {
    const row = this.apiKeys.find((k) => k.id === id);
    if (!row) throw new Error('key not found');
    Object.assign(row, patch);
    return row;
  }

  async touchApiKey(_db: unknown, id: string, at: string) {
    const row = this.apiKeys.find((k) => k.id === id);
    if (row) row.last_used_at = at;
  }

  // ---- tokens -----------------------------------------------------------

  async createAccessToken(
    _db: unknown,
    input: Omit<PartnerAccessTokenRow, 'id' | 'created_at' | 'revoked_at'>,
  ) {
    const row: PartnerAccessTokenRow = {
      id: randomUUID(),
      revoked_at: null,
      created_at: new Date().toISOString(),
      ...input,
    };
    this.tokens.push(row);
    return row;
  }

  async getAccessTokenByHash(_db: unknown, hash: string) {
    return this.tokens.find((t) => t.token_hash === hash) ?? null;
  }

  async revokeAccessToken(_db: unknown, hash: string, at: string) {
    const row = this.tokens.find((t) => t.token_hash === hash && !t.revoked_at);
    if (!row) return false;
    row.revoked_at = at;
    return true;
  }

  async revokeTokensForApplication(
    _db: unknown,
    applicationId: string,
    at: string,
  ) {
    let count = 0;
    for (const token of this.tokens) {
      if (token.application_id === applicationId && !token.revoked_at) {
        token.revoked_at = at;
        count += 1;
      }
    }
    return count;
  }

  async touchAccessToken(): Promise<void> {
    // No last_used tracking needed for the double.
  }

  // ---- authorization codes ----------------------------------------------

  async createAuthorizationCode(
    _db: unknown,
    input: Omit<PartnerAuthorizationCodeRow, 'id' | 'consumed_at'>,
  ) {
    const row: PartnerAuthorizationCodeRow = {
      id: randomUUID(),
      consumed_at: null,
      ...input,
    };
    this.codes.push(row);
    return row;
  }

  /** Single-use, like the real `is('consumed_at', null)` guard. */
  async consumeAuthorizationCode(_db: unknown, codeHash: string, at: string) {
    const row = this.codes.find(
      (c) => c.code_hash === codeHash && !c.consumed_at,
    );
    if (!row) return null;
    row.consumed_at = at;
    return row;
  }

  // ---- consent -----------------------------------------------------------

  async getConsent(_db: unknown, applicationId: string, userId: string) {
    return (
      this.consents.find(
        (c) => c.application_id === applicationId && c.user_id === userId,
      ) ?? null
    );
  }

  async upsertConsent(
    _db: unknown,
    applicationId: string,
    userId: string,
    scopes: PartnerScope[],
  ) {
    const existing = await this.getConsent(_db, applicationId, userId);
    if (existing) {
      existing.scopes = scopes;
      existing.revoked_at = null;
      existing.granted_at = new Date().toISOString();
      return existing;
    }
    const row: PartnerConsentRow = {
      id: randomUUID(),
      application_id: applicationId,
      user_id: userId,
      scopes,
      granted_at: new Date().toISOString(),
      revoked_at: null,
    };
    this.consents.push(row);
    return row;
  }

  async revokeConsent(
    _db: unknown,
    applicationId: string,
    userId: string,
    at: string,
  ) {
    const row = await this.getConsent(_db, applicationId, userId);
    if (!row || row.revoked_at) return false;
    row.revoked_at = at;
    return true;
  }

  async listConsentsForApplication(
    _db: unknown,
    applicationId: string,
    limit: number,
  ) {
    return this.consents
      .filter((c) => c.application_id === applicationId && !c.revoked_at)
      .slice(0, limit + 1);
  }

  async listConsentsForUser(_db: unknown, userId: string) {
    return this.consents.filter((c) => c.user_id === userId && !c.revoked_at);
  }

  // ---- events & webhooks --------------------------------------------------

  async createEvent(
    _db: unknown,
    input: Omit<PartnerEventRow, 'id' | 'sequence' | 'created_at'>,
  ) {
    this.sequence += 1;
    const row: PartnerEventRow = {
      id: randomUUID(),
      sequence: this.sequence,
      created_at: new Date().toISOString(),
      ...input,
    };
    this.events.push(row);
    return row;
  }

  async getEvent(_db: unknown, id: string) {
    return this.events.find((e) => e.id === id) ?? null;
  }

  async listEndpoints(_db: unknown, applicationId: string) {
    return this.endpoints.filter((e) => e.application_id === applicationId);
  }

  async listEndpointsForOrganization(
    _db: unknown,
    organizationId: string,
    environment: PartnerEnvironment,
  ) {
    const partnerIds = this.partners
      .filter((p) => p.organization_id === organizationId)
      .map((p) => p.id);
    const appIds = this.applications
      .filter(
        (a) =>
          partnerIds.includes(a.partner_id) &&
          a.environment === environment &&
          a.status === 'active',
      )
      .map((a) => a.id);
    return this.endpoints.filter(
      (e) => appIds.includes(e.application_id) && e.status === 'active',
    );
  }

  async getEndpoint(_db: unknown, id: string) {
    return this.endpoints.find((e) => e.id === id) ?? null;
  }

  async createEndpoint(
    _db: unknown,
    input: Omit<
      PartnerWebhookEndpointRow,
      | 'id'
      | 'created_at'
      | 'consecutive_failures'
      | 'verified_at'
      | 'disabled_reason'
    >,
  ) {
    const row: PartnerWebhookEndpointRow = {
      id: randomUUID(),
      consecutive_failures: 0,
      verified_at: null,
      disabled_reason: null,
      created_at: new Date().toISOString(),
      ...input,
    };
    this.endpoints.push(row);
    return row;
  }

  async updateEndpoint(
    _db: unknown,
    id: string,
    patch: Partial<PartnerWebhookEndpointRow>,
  ) {
    const row = this.endpoints.find((e) => e.id === id);
    if (!row) throw new Error('endpoint not found');
    Object.assign(row, patch);
    return row;
  }

  async deleteEndpoint(_db: unknown, id: string) {
    this.endpoints = this.endpoints.filter((e) => e.id !== id);
  }

  /** Honours the unique (endpoint_id, event_id) constraint. */
  async enqueueDelivery(
    _db: unknown,
    endpointId: string,
    event: PartnerEventRow,
    replayedFrom: string | null = null,
  ) {
    const clash = this.deliveries.find(
      (d) => d.endpoint_id === endpointId && d.event_id === event.id,
    );
    if (clash) return null;
    const row: PartnerWebhookDeliveryRow = {
      id: randomUUID(),
      endpoint_id: endpointId,
      event_id: event.id,
      event_type: event.event_type,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
      last_status_code: null,
      last_error: null,
      duration_ms: null,
      delivered_at: null,
      replayed_from: replayedFrom,
      created_at: new Date().toISOString(),
    };
    this.deliveries.push(row);
    return row;
  }

  async claimDueDeliveries(_db: unknown, limit: number, now: string) {
    const due = this.deliveries
      .filter(
        (d) =>
          (d.status === 'pending' || d.status === 'failed') &&
          new Date(d.next_attempt_at).getTime() <= new Date(now).getTime(),
      )
      .slice(0, limit);
    for (const row of due) row.status = 'delivering';
    return due;
  }

  async updateDelivery(
    _db: unknown,
    id: string,
    patch: Partial<PartnerWebhookDeliveryRow>,
  ) {
    const row = this.deliveries.find((d) => d.id === id);
    if (row) Object.assign(row, patch);
  }

  async getDelivery(_db: unknown, id: string) {
    return this.deliveries.find((d) => d.id === id) ?? null;
  }

  async listDeliveries(_db: unknown, endpointId: string, limit: number) {
    return this.deliveries
      .filter((d) => d.endpoint_id === endpointId)
      .slice(0, limit + 1);
  }

  // ---- usage --------------------------------------------------------------

  async incrementUsage(
    _db: unknown,
    applicationId: string,
    windowKind: string,
    windowStart: string,
  ) {
    const key = `${applicationId}:${windowKind}:${windowStart}`;
    const next = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, next);
    return next;
  }

  async readUsage(
    _db: unknown,
    applicationId: string,
    windows: { kind: 'minute' | 'day' | 'month'; start: string }[],
  ) {
    const out: Record<string, number> = { minute: 0, day: 0, month: 0 };
    for (const w of windows) {
      out[w.kind] =
        this.usage.get(`${applicationId}:${w.kind}:${w.start}`) ?? 0;
    }
    return out;
  }

  async logRequest(_db: unknown, entry: RequestLogEntry) {
    this.requests.push(entry);
  }

  // ---- idempotency ---------------------------------------------------------

  async claimIdempotencyKey(
    _db: unknown,
    applicationId: string,
    key: string,
    requestHash: string,
    // These two are on IPartnerRepository but had been dropped from this
    // implementation. TypeScript permits a shorter parameter list when
    // checking `implements`, so the omission compiled silently and callers
    // passing 6 arguments failed to typecheck at the call site instead.
    //
    // They are accepted but NOT persisted: IdempotencyRecord carries neither
    // field, so this fake cannot model key expiry. Any test that needs to
    // exercise expiry must use the real repository.
    _routeTemplate?: string,
    _expiresAt?: string,
  ): Promise<
    { claimed: true } | { claimed: false; existing: IdempotencyRecord }
  > {
    const composite = `${applicationId}:${key}`;
    const existing = this.idempotency.get(composite);
    if (existing) return { claimed: false, existing };
    this.idempotency.set(composite, {
      application_id: applicationId,
      idempotency_key: key,
      request_hash: requestHash,
      state: 'in_progress',
      status_code: null,
      response_body: null,
    });
    return { claimed: true };
  }

  async completeIdempotencyKey(
    _db: unknown,
    applicationId: string,
    key: string,
    statusCode: number,
    body: unknown,
  ) {
    const row = this.idempotency.get(`${applicationId}:${key}`);
    if (row) {
      row.state = 'completed';
      row.status_code = statusCode;
      row.response_body = body;
    }
  }

  async releaseIdempotencyKey(
    _db: unknown,
    applicationId: string,
    key: string,
  ) {
    const composite = `${applicationId}:${key}`;
    const row = this.idempotency.get(composite);
    if (row?.state === 'in_progress') this.idempotency.delete(composite);
  }

  // ---- sandbox --------------------------------------------------------------

  async listSandboxResources(
    _db: unknown,
    applicationId: string,
    resourceType: string,
  ) {
    return this.sandbox.filter(
      (r) =>
        r.application_id === applicationId && r.resource_type === resourceType,
    );
  }

  async getSandboxResource(
    _db: unknown,
    applicationId: string,
    resourceType: string,
    resourceKey: string,
  ) {
    return (
      this.sandbox.find(
        (r) =>
          r.application_id === applicationId &&
          r.resource_type === resourceType &&
          r.resource_key === resourceKey,
      ) ?? null
    );
  }

  async upsertSandboxResource(
    _db: unknown,
    applicationId: string,
    resourceType: string,
    resourceKey: string,
    data: Record<string, unknown>,
  ) {
    const existing = await this.getSandboxResource(
      _db,
      applicationId,
      resourceType,
      resourceKey,
    );
    if (existing) {
      existing.data = data;
      return existing;
    }
    const row: SandboxResourceRow = {
      id: randomUUID(),
      application_id: applicationId,
      resource_type: resourceType,
      resource_key: resourceKey,
      data,
      created_at: new Date().toISOString(),
    };
    this.sandbox.push(row);
    return row;
  }

  async resetSandbox(_db: unknown, applicationId: string) {
    const before = this.sandbox.length;
    this.sandbox = this.sandbox.filter(
      (r) => r.application_id !== applicationId,
    );
    return before - this.sandbox.length;
  }
}
