import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
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

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error) {
    throw new Error((res.error as { message?: string }).message ?? ctx);
  }
  return res.data as T;
}

function maybe<T>(res: { data: unknown; error: unknown }): T | null {
  if (res.error) throw new Error((res.error as { message?: string }).message);
  return (res.data as T | null) ?? null;
}

/** Postgres unique-violation. Used to turn a race into a defined outcome. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

@Injectable()
export class PartnerRepository implements IPartnerRepository {
  // ---- partners -------------------------------------------------------

  async getPartnerByOrganization(
    db: SupabaseClient,
    organizationId: string,
  ): Promise<PartnerRow | null> {
    return maybe<PartnerRow>(
      await db
        .from('partners')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle(),
    );
  }

  async getPartner(db: SupabaseClient, id: string): Promise<PartnerRow | null> {
    return maybe<PartnerRow>(
      await db.from('partners').select('*').eq('id', id).maybeSingle(),
    );
  }

  async createPartner(
    db: SupabaseClient,
    input: Omit<PartnerRow, 'id' | 'created_at' | 'status_reason'>,
  ): Promise<PartnerRow> {
    return unwrap<PartnerRow>(
      await db.from('partners').insert(input).select('*').single(),
      'create partner',
    );
  }

  async updatePartnerStatus(
    db: SupabaseClient,
    id: string,
    status: PartnerRow['status'],
    reason: string | null,
    approverId: string | null,
  ): Promise<PartnerRow> {
    return unwrap<PartnerRow>(
      await db
        .from('partners')
        .update({
          status,
          status_reason: reason,
          updated_at: new Date().toISOString(),
          ...(status === 'approved'
            ? { approved_at: new Date().toISOString(), approved_by: approverId }
            : {}),
        })
        .eq('id', id)
        .select('*')
        .single(),
      'update partner status',
    );
  }

  // ---- applications ---------------------------------------------------

  async listApplications(
    db: SupabaseClient,
    partnerId: string,
  ): Promise<PartnerApplicationRow[]> {
    return unwrap<PartnerApplicationRow[]>(
      await db
        .from('partner_applications')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false }),
      'list partner applications',
    );
  }

  async getApplication(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerApplicationRow | null> {
    return maybe<PartnerApplicationRow>(
      await db
        .from('partner_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle(),
    );
  }

  async getApplicationByClientId(
    db: SupabaseClient,
    clientId: string,
  ): Promise<PartnerApplicationRow | null> {
    return maybe<PartnerApplicationRow>(
      await db
        .from('partner_applications')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle(),
    );
  }

  async createApplication(
    db: SupabaseClient,
    input: Partial<PartnerApplicationRow> & {
      partner_id: string;
      name: string;
      environment: PartnerEnvironment;
      client_id: string;
      created_by?: string | null;
    },
  ): Promise<PartnerApplicationRow> {
    return unwrap<PartnerApplicationRow>(
      await db.from('partner_applications').insert(input).select('*').single(),
      'create partner application',
    );
  }

  async updateApplication(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerApplicationRow>,
  ): Promise<PartnerApplicationRow> {
    return unwrap<PartnerApplicationRow>(
      await db
        .from('partner_applications')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single(),
      'update partner application',
    );
  }

  // ---- API keys -------------------------------------------------------

  async listApiKeys(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<PartnerApiKeyRow[]> {
    return unwrap<PartnerApiKeyRow[]>(
      await db
        .from('partner_api_keys')
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false }),
      'list api keys',
    );
  }

  async getApiKeyByPrefix(
    db: SupabaseClient,
    prefix: string,
  ): Promise<PartnerApiKeyRow | null> {
    return maybe<PartnerApiKeyRow>(
      await db
        .from('partner_api_keys')
        .select('*')
        .eq('prefix', prefix)
        .maybeSingle(),
    );
  }

  async getApiKey(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerApiKeyRow | null> {
    return maybe<PartnerApiKeyRow>(
      await db.from('partner_api_keys').select('*').eq('id', id).maybeSingle(),
    );
  }

  async createApiKey(
    db: SupabaseClient,
    input: Omit<
      PartnerApiKeyRow,
      'id' | 'created_at' | 'last_used_at' | 'revoked_at'
    > & { rotated_from?: string | null; created_by?: string | null },
  ): Promise<PartnerApiKeyRow> {
    return unwrap<PartnerApiKeyRow>(
      await db.from('partner_api_keys').insert(input).select('*').single(),
      'create api key',
    );
  }

  async updateApiKey(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerApiKeyRow> & { revoked_reason?: string | null },
  ): Promise<PartnerApiKeyRow> {
    return unwrap<PartnerApiKeyRow>(
      await db
        .from('partner_api_keys')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single(),
      'update api key',
    );
  }

  /**
   * Best-effort last-used stamp. Never throws: failing to record telemetry
   * must not fail an otherwise valid request.
   */
  async touchApiKey(db: SupabaseClient, id: string, at: string): Promise<void> {
    await db
      .from('partner_api_keys')
      .update({ last_used_at: at })
      .eq('id', id)
      .then(undefined, () => undefined);
  }

  // ---- tokens ---------------------------------------------------------

  async createAccessToken(
    db: SupabaseClient,
    input: Omit<PartnerAccessTokenRow, 'id' | 'created_at' | 'revoked_at'>,
  ): Promise<PartnerAccessTokenRow> {
    return unwrap<PartnerAccessTokenRow>(
      await db.from('partner_access_tokens').insert(input).select('*').single(),
      'create access token',
    );
  }

  async getAccessTokenByHash(
    db: SupabaseClient,
    hash: string,
  ): Promise<PartnerAccessTokenRow | null> {
    return maybe<PartnerAccessTokenRow>(
      await db
        .from('partner_access_tokens')
        .select('*')
        .eq('token_hash', hash)
        .maybeSingle(),
    );
  }

  async revokeAccessToken(
    db: SupabaseClient,
    hash: string,
    at: string,
  ): Promise<boolean> {
    const res = await db
      .from('partner_access_tokens')
      .update({ revoked_at: at })
      .eq('token_hash', hash)
      .is('revoked_at', null)
      .select('id');
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []).length > 0;
  }

  async revokeTokensForApplication(
    db: SupabaseClient,
    applicationId: string,
    at: string,
  ): Promise<number> {
    const res = await db
      .from('partner_access_tokens')
      .update({ revoked_at: at })
      .eq('application_id', applicationId)
      .is('revoked_at', null)
      .select('id');
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []).length;
  }

  async touchAccessToken(
    db: SupabaseClient,
    id: string,
    at: string,
  ): Promise<void> {
    await db
      .from('partner_access_tokens')
      .update({ last_used_at: at })
      .eq('id', id)
      .then(undefined, () => undefined);
  }

  // ---- authorization codes --------------------------------------------

  async createAuthorizationCode(
    db: SupabaseClient,
    input: Omit<PartnerAuthorizationCodeRow, 'id' | 'consumed_at'>,
  ): Promise<PartnerAuthorizationCodeRow> {
    return unwrap<PartnerAuthorizationCodeRow>(
      await db
        .from('partner_authorization_codes')
        .insert(input)
        .select('*')
        .single(),
      'create authorization code',
    );
  }

  /**
   * Single-use enforcement lives in the WHERE clause, not in application code:
   * `is('consumed_at', null)` means two concurrent exchanges of the same code
   * cannot both succeed — the second updates zero rows and gets null.
   */
  async consumeAuthorizationCode(
    db: SupabaseClient,
    codeHash: string,
    at: string,
  ): Promise<PartnerAuthorizationCodeRow | null> {
    const res = await db
      .from('partner_authorization_codes')
      .update({ consumed_at: at })
      .eq('code_hash', codeHash)
      .is('consumed_at', null)
      .select('*')
      .maybeSingle();
    return maybe<PartnerAuthorizationCodeRow>(res);
  }

  // ---- consent --------------------------------------------------------

  async getConsent(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ): Promise<PartnerConsentRow | null> {
    return maybe<PartnerConsentRow>(
      await db
        .from('partner_user_consents')
        .select('*')
        .eq('application_id', applicationId)
        .eq('user_id', userId)
        .maybeSingle(),
    );
  }

  async upsertConsent(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    scopes: PartnerScope[],
  ): Promise<PartnerConsentRow> {
    return unwrap<PartnerConsentRow>(
      await db
        .from('partner_user_consents')
        .upsert(
          {
            application_id: applicationId,
            user_id: userId,
            scopes,
            granted_at: new Date().toISOString(),
            // Re-granting clears a previous revocation rather than leaving a
            // row that reads as both granted and revoked.
            revoked_at: null,
          },
          { onConflict: 'application_id,user_id' },
        )
        .select('*')
        .single(),
      'upsert consent',
    );
  }

  async revokeConsent(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    at: string,
  ): Promise<boolean> {
    const res = await db
      .from('partner_user_consents')
      .update({ revoked_at: at })
      .eq('application_id', applicationId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id');
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []).length > 0;
  }

  async listConsentsForApplication(
    db: SupabaseClient,
    applicationId: string,
    limit: number,
    cursor: { createdAt: string; id: string } | null,
  ): Promise<PartnerConsentRow[]> {
    let query = db
      .from('partner_user_consents')
      .select('*')
      .eq('application_id', applicationId)
      .is('revoked_at', null)
      .order('granted_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (cursor) query = query.lt('granted_at', cursor.createdAt);
    return unwrap<PartnerConsentRow[]>(await query, 'list consents');
  }

  async listConsentsForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<PartnerConsentRow[]> {
    return unwrap<PartnerConsentRow[]>(
      await db
        .from('partner_user_consents')
        .select('*')
        .eq('user_id', userId)
        .is('revoked_at', null),
      'list user consents',
    );
  }

  // ---- events ---------------------------------------------------------

  async createEvent(
    db: SupabaseClient,
    input: Omit<PartnerEventRow, 'id' | 'sequence' | 'created_at'>,
  ): Promise<PartnerEventRow> {
    return unwrap<PartnerEventRow>(
      await db.from('partner_events').insert(input).select('*').single(),
      'create partner event',
    );
  }

  async getEvent(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerEventRow | null> {
    return maybe<PartnerEventRow>(
      await db.from('partner_events').select('*').eq('id', id).maybeSingle(),
    );
  }

  // ---- webhook endpoints ----------------------------------------------

  async listEndpoints(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<PartnerWebhookEndpointRow[]> {
    return unwrap<PartnerWebhookEndpointRow[]>(
      await db
        .from('partner_webhook_endpoints')
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false }),
      'list endpoints',
    );
  }

  /**
   * Endpoints belonging to any active application of an organization in one
   * environment. This is the fan-out query: an event for org X reaches every
   * endpoint org X registered in that environment, and no others.
   */
  async listEndpointsForOrganization(
    db: SupabaseClient,
    organizationId: string,
    environment: PartnerEnvironment,
  ): Promise<PartnerWebhookEndpointRow[]> {
    const apps = await db
      .from('partner_applications')
      .select('id, partners!inner(organization_id)')
      .eq('partners.organization_id', organizationId)
      .eq('environment', environment)
      .eq('status', 'active');
    if (apps.error) throw new Error(apps.error.message);
    const ids = (apps.data ?? []).map((row) => (row as { id: string }).id);
    if (ids.length === 0) return [];

    return unwrap<PartnerWebhookEndpointRow[]>(
      await db
        .from('partner_webhook_endpoints')
        .select('*')
        .in('application_id', ids)
        .eq('status', 'active'),
      'list endpoints for organization',
    );
  }

  async getEndpoint(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerWebhookEndpointRow | null> {
    return maybe<PartnerWebhookEndpointRow>(
      await db
        .from('partner_webhook_endpoints')
        .select('*')
        .eq('id', id)
        .maybeSingle(),
    );
  }

  async createEndpoint(
    db: SupabaseClient,
    input: Omit<
      PartnerWebhookEndpointRow,
      | 'id'
      | 'created_at'
      | 'consecutive_failures'
      | 'verified_at'
      | 'disabled_reason'
    >,
  ): Promise<PartnerWebhookEndpointRow> {
    return unwrap<PartnerWebhookEndpointRow>(
      await db
        .from('partner_webhook_endpoints')
        .insert(input)
        .select('*')
        .single(),
      'create endpoint',
    );
  }

  async updateEndpoint(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerWebhookEndpointRow> & { disabled_at?: string | null },
  ): Promise<PartnerWebhookEndpointRow> {
    return unwrap<PartnerWebhookEndpointRow>(
      await db
        .from('partner_webhook_endpoints')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single(),
      'update endpoint',
    );
  }

  async deleteEndpoint(db: SupabaseClient, id: string): Promise<void> {
    const res = await db
      .from('partner_webhook_endpoints')
      .delete()
      .eq('id', id);
    if (res.error) throw new Error(res.error.message);
  }

  // ---- deliveries -----------------------------------------------------

  /**
   * The unique (endpoint_id, event_id) constraint is the idempotency
   * guarantee. A duplicate insert is not an error condition — it means the
   * fan-out already happened — so it returns null rather than throwing.
   */
  async enqueueDelivery(
    db: SupabaseClient,
    endpointId: string,
    event: PartnerEventRow,
    replayedFrom: string | null = null,
  ): Promise<PartnerWebhookDeliveryRow | null> {
    const res = await db
      .from('partner_webhook_deliveries')
      .insert({
        endpoint_id: endpointId,
        event_id: event.id,
        event_type: event.event_type,
        replayed_from: replayedFrom,
      })
      .select('*')
      .single();
    if (res.error) {
      if (isUniqueViolation(res.error)) return null;
      throw new Error(res.error.message);
    }
    return res.data as PartnerWebhookDeliveryRow;
  }

  /**
   * Claim due deliveries by flipping them to `delivering` in the same
   * statement that selects them. Two workers cannot claim the same row: the
   * second sees zero rows updated because the status no longer matches.
   */
  async claimDueDeliveries(
    db: SupabaseClient,
    limit: number,
    now: string,
  ): Promise<PartnerWebhookDeliveryRow[]> {
    const due = await db
      .from('partner_webhook_deliveries')
      .select('id')
      .in('status', ['pending', 'failed'])
      .lte('next_attempt_at', now)
      .order('next_attempt_at', { ascending: true })
      .limit(limit);
    if (due.error) throw new Error(due.error.message);
    const ids = ((due.data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return [];

    const claimed = await db
      .from('partner_webhook_deliveries')
      .update({ status: 'delivering' })
      .in('id', ids)
      .in('status', ['pending', 'failed'])
      .select('*');
    if (claimed.error) throw new Error(claimed.error.message);
    return (claimed.data ?? []) as PartnerWebhookDeliveryRow[];
  }

  async updateDelivery(
    db: SupabaseClient,
    id: string,
    patch: Partial<PartnerWebhookDeliveryRow>,
  ): Promise<void> {
    const res = await db
      .from('partner_webhook_deliveries')
      .update(patch)
      .eq('id', id);
    if (res.error) throw new Error(res.error.message);
  }

  async getDelivery(
    db: SupabaseClient,
    id: string,
  ): Promise<PartnerWebhookDeliveryRow | null> {
    return maybe<PartnerWebhookDeliveryRow>(
      await db
        .from('partner_webhook_deliveries')
        .select('*')
        .eq('id', id)
        .maybeSingle(),
    );
  }

  async listDeliveries(
    db: SupabaseClient,
    endpointId: string,
    limit: number,
    cursor: { createdAt: string; id: string } | null,
  ): Promise<PartnerWebhookDeliveryRow[]> {
    let query = db
      .from('partner_webhook_deliveries')
      .select('*')
      .eq('endpoint_id', endpointId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (cursor) query = query.lt('created_at', cursor.createdAt);
    return unwrap<PartnerWebhookDeliveryRow[]>(await query, 'list deliveries');
  }

  // ---- usage ----------------------------------------------------------

  async incrementUsage(
    db: SupabaseClient,
    applicationId: string,
    windowKind: 'minute' | 'day' | 'month',
    windowStart: string,
  ): Promise<number> {
    const res = await db.rpc('increment_partner_usage', {
      p_application_id: applicationId,
      p_window_kind: windowKind,
      p_window_start: windowStart,
      p_delta: 1,
    });
    if (res.error) throw new Error(res.error.message);
    return Number(res.data ?? 0);
  }

  async readUsage(
    db: SupabaseClient,
    applicationId: string,
    windows: { kind: 'minute' | 'day' | 'month'; start: string }[],
  ): Promise<Record<string, number>> {
    const res = await db
      .from('partner_usage_counters')
      .select('window_kind, window_start, count')
      .eq('application_id', applicationId)
      .in(
        'window_start',
        windows.map((w) => w.start),
      );
    if (res.error) throw new Error(res.error.message);
    const out: Record<string, number> = { minute: 0, day: 0, month: 0 };
    for (const row of (res.data ?? []) as {
      window_kind: string;
      window_start: string;
      count: number;
    }[]) {
      const match = windows.find(
        (w) =>
          w.kind === row.window_kind &&
          new Date(w.start).getTime() === new Date(row.window_start).getTime(),
      );
      if (match) out[match.kind] = Number(row.count);
    }
    return out;
  }

  /** Fire-and-forget: a logging failure must not fail the partner's request. */
  async logRequest(db: SupabaseClient, entry: RequestLogEntry): Promise<void> {
    await db
      .from('partner_api_requests')
      .insert({
        application_id: entry.applicationId,
        environment: entry.environment,
        method: entry.method,
        route_template: entry.routeTemplate,
        api_version: entry.apiVersion,
        status_code: entry.statusCode,
        latency_ms: entry.latencyMs,
        request_id: entry.requestId,
        credential_kind: entry.credentialKind,
        credential_id: entry.credentialId,
        error_code: entry.errorCode,
      })
      .then(undefined, () => undefined);
  }

  // ---- idempotency ----------------------------------------------------

  /**
   * Claim by INSERT. The unique constraint decides the race, so two concurrent
   * requests with the same key cannot both execute the operation — exactly the
   * failure idempotency exists to prevent.
   */
  async claimIdempotencyKey(
    db: SupabaseClient,
    applicationId: string,
    key: string,
    requestHash: string,
    routeTemplate: string,
    expiresAt: string,
  ): Promise<
    { claimed: true } | { claimed: false; existing: IdempotencyRecord }
  > {
    const res = await db.from('partner_idempotency_keys').insert({
      application_id: applicationId,
      idempotency_key: key,
      request_hash: requestHash,
      route_template: routeTemplate,
      expires_at: expiresAt,
    });
    if (!res.error) return { claimed: true };
    if (!isUniqueViolation(res.error)) throw new Error(res.error.message);

    const existing = await db
      .from('partner_idempotency_keys')
      .select(
        'idempotency_key, request_hash, state, status_code, response_body',
      )
      .eq('application_id', applicationId)
      .eq('idempotency_key', key)
      .single();
    if (existing.error) throw new Error(existing.error.message);
    return { claimed: false, existing: existing.data };
  }

  async completeIdempotencyKey(
    db: SupabaseClient,
    applicationId: string,
    key: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const res = await db
      .from('partner_idempotency_keys')
      .update({
        state: 'completed',
        status_code: statusCode,
        response_body: body,
      })
      .eq('application_id', applicationId)
      .eq('idempotency_key', key);
    if (res.error) throw new Error(res.error.message);
  }

  /**
   * Release a claim whose operation failed. Without this, a 500 would poison
   * the key for 24 hours and the partner could never retry it.
   */
  async releaseIdempotencyKey(
    db: SupabaseClient,
    applicationId: string,
    key: string,
  ): Promise<void> {
    await db
      .from('partner_idempotency_keys')
      .delete()
      .eq('application_id', applicationId)
      .eq('idempotency_key', key)
      .eq('state', 'in_progress')
      .then(undefined, () => undefined);
  }

  // ---- sandbox --------------------------------------------------------

  async listSandboxResources(
    db: SupabaseClient,
    applicationId: string,
    resourceType: string,
  ): Promise<SandboxResourceRow[]> {
    return unwrap<SandboxResourceRow[]>(
      await db
        .from('partner_sandbox_resources')
        .select('*')
        .eq('application_id', applicationId)
        .eq('resource_type', resourceType)
        .order('created_at', { ascending: false }),
      'list sandbox resources',
    );
  }

  async getSandboxResource(
    db: SupabaseClient,
    applicationId: string,
    resourceType: string,
    resourceKey: string,
  ): Promise<SandboxResourceRow | null> {
    return maybe<SandboxResourceRow>(
      await db
        .from('partner_sandbox_resources')
        .select('*')
        .eq('application_id', applicationId)
        .eq('resource_type', resourceType)
        .eq('resource_key', resourceKey)
        .maybeSingle(),
    );
  }

  async upsertSandboxResource(
    db: SupabaseClient,
    applicationId: string,
    resourceType: string,
    resourceKey: string,
    data: Record<string, unknown>,
  ): Promise<SandboxResourceRow> {
    return unwrap<SandboxResourceRow>(
      await db
        .from('partner_sandbox_resources')
        .upsert(
          {
            application_id: applicationId,
            resource_type: resourceType,
            resource_key: resourceKey,
            data,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'application_id,resource_type,resource_key' },
        )
        .select('*')
        .single(),
      'upsert sandbox resource',
    );
  }

  async resetSandbox(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<number> {
    const res = await db
      .from('partner_sandbox_resources')
      .delete()
      .eq('application_id', applicationId)
      .select('id');
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []).length;
  }
}
