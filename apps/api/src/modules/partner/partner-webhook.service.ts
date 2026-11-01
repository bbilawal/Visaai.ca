import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PartnerEnvironment,
  PartnerEventType,
  PartnerPrincipal,
  PartnerWebhookDelivery,
  PartnerWebhookEndpoint,
  PartnerWebhookPayload,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { FieldCryptoService } from '../shared/crypto/field-crypto.service';
import {
  generateVerificationToken,
  generateWebhookSecret,
} from './partner-credentials';
import { PartnerErrors } from './partner-errors';
import {
  buildSignatureHeader,
  decideNextDelivery,
  shouldAutoDisable,
} from './partner-webhook-signature';
import { validateWebhookUrl } from './partner-webhook-url';
import {
  PARTNER_CONFIG,
  PARTNER_DEFAULTS,
  PARTNER_REPOSITORY,
  PARTNER_WEBHOOK_SENDER,
} from './partner.tokens';
import type {
  IPartnerRepository,
  PartnerEventRow,
  PartnerWebhookDeliveryRow,
  PartnerWebhookEndpointRow,
} from './partner.repository';

/** All event types a partner may subscribe to. */
export const SUBSCRIBABLE_EVENTS: readonly PartnerEventType[] = [
  'application.created',
  'application.updated',
  'application.status_changed',
  'document.uploaded',
  'document.processing_completed',
  'eligibility.assessment_completed',
  'appointment.booked',
  'appointment.changed',
  'payment.status_changed',
  'consultant.assignment_changed',
] as const;

export interface WebhookSendResult {
  statusCode: number | null;
  networkError: boolean;
  durationMs: number;
  /** Truncated + redacted response body, for the delivery log. */
  responseSnippet: string | null;
}

/** Transport port. Swapped for a fake in tests — no network in unit tests. */
export interface WebhookSender {
  send(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<WebhookSendResult>;
}

const MAX_ERROR_SNIPPET = 500;

@Injectable()
export class PartnerWebhookService {
  private readonly log = new Logger(PartnerWebhookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly crypto: FieldCryptoService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
    @Inject(PARTNER_WEBHOOK_SENDER) private readonly sender: WebhookSender,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  private get timeoutMs(): number {
    return (
      this.config.get<number>(PARTNER_CONFIG.webhookTimeoutMs) ??
      PARTNER_DEFAULTS.webhookTimeoutMs
    );
  }

  // ---- endpoint management (partner-facing) ----------------------------

  async createEndpoint(
    principal: PartnerPrincipal,
    input: { url: string; events: string[]; description?: string },
  ): Promise<{ endpoint: PartnerWebhookEndpoint; secret: string }> {
    const check = validateWebhookUrl(input.url, principal.environment);
    if (!check.valid) {
      throw PartnerErrors.invalidRequest(
        describeUrlRejection(check.reason),
        'url',
      );
    }

    const events = normalizeEvents(input.events);
    if (events.length === 0) {
      throw PartnerErrors.invalidRequest(
        `Subscribe to at least one known event. Known events: ${SUBSCRIBABLE_EVENTS.join(', ')}`,
        'events',
      );
    }

    // The signing secret must be recoverable to sign outbound payloads, so it
    // is encrypted rather than hashed. It is returned to the partner exactly
    // once, here.
    const secret = generateWebhookSecret();
    const row = await this.repo.createEndpoint(this.db, {
      application_id: principal.applicationId,
      url: input.url,
      description: input.description ?? null,
      events,
      status: 'pending_verification',
      secret_encrypted: this.crypto.encrypt(secret),
      previous_secret_encrypted: null,
      previous_secret_expires_at: null,
      verification_token: generateVerificationToken(),
    });

    return { endpoint: toEndpointDto(row), secret };
  }

  async listEndpoints(
    principal: PartnerPrincipal,
  ): Promise<PartnerWebhookEndpoint[]> {
    const rows = await this.repo.listEndpoints(
      this.db,
      principal.applicationId,
    );
    return rows.map(toEndpointDto);
  }

  /**
   * Proof-of-ownership: we POST a challenge and the endpoint must echo the
   * token back. Without this a partner could register someone else's URL and
   * point our traffic at it.
   */
  async verifyEndpoint(
    principal: PartnerPrincipal,
    endpointId: string,
  ): Promise<PartnerWebhookEndpoint> {
    const endpoint = await this.requireEndpoint(principal, endpointId);
    if (!endpoint.verification_token) {
      throw PartnerErrors.conflict(
        'already_verified',
        'This endpoint has already been verified.',
      );
    }

    const body = JSON.stringify({
      type: 'endpoint.verification',
      challenge: endpoint.verification_token,
    });
    const result = await this.sender.send(
      endpoint.url,
      body,
      this.headersFor(endpoint, body, Math.floor(Date.now() / 1000)),
      this.timeoutMs,
    );

    const echoed =
      result.statusCode !== null &&
      result.statusCode >= 200 &&
      result.statusCode < 300 &&
      (result.responseSnippet ?? '').includes(endpoint.verification_token);

    if (!echoed) {
      throw PartnerErrors.conflict(
        'verification_failed',
        'The endpoint did not return the challenge value with a 2xx response.',
      );
    }

    const updated = await this.repo.updateEndpoint(this.db, endpointId, {
      status: 'active',
      verified_at: new Date().toISOString(),
      verification_token: null,
    });
    return toEndpointDto(updated);
  }

  async updateEndpointEvents(
    principal: PartnerPrincipal,
    endpointId: string,
    events: string[],
  ): Promise<PartnerWebhookEndpoint> {
    await this.requireEndpoint(principal, endpointId);
    const normalized = normalizeEvents(events);
    if (normalized.length === 0) {
      throw PartnerErrors.invalidRequest(
        'Subscribe to at least one known event.',
        'events',
      );
    }
    return toEndpointDto(
      await this.repo.updateEndpoint(this.db, endpointId, {
        events: normalized,
      }),
    );
  }

  /**
   * Rotate the signing secret with an overlap: the old secret keeps signing
   * alongside the new one until it expires, so a partner can update their
   * verifier without dropping events.
   */
  async rotateSecret(
    principal: PartnerPrincipal,
    endpointId: string,
  ): Promise<{ secret: string; previousValidUntil: string }> {
    const endpoint = await this.requireEndpoint(principal, endpointId);
    const overlapHours =
      this.config.get<number>(PARTNER_CONFIG.webhookSecretOverlapHours) ??
      PARTNER_DEFAULTS.webhookSecretOverlapHours;
    const validUntil = new Date(
      Date.now() + overlapHours * 3_600_000,
    ).toISOString();

    const secret = generateWebhookSecret();
    await this.repo.updateEndpoint(this.db, endpointId, {
      secret_encrypted: this.crypto.encrypt(secret),
      previous_secret_encrypted: endpoint.secret_encrypted,
      previous_secret_expires_at: validUntil,
    });
    return { secret, previousValidUntil: validUntil };
  }

  async disableEndpoint(
    principal: PartnerPrincipal,
    endpointId: string,
    reason: string,
  ): Promise<PartnerWebhookEndpoint> {
    await this.requireEndpoint(principal, endpointId);
    return toEndpointDto(
      await this.repo.updateEndpoint(this.db, endpointId, {
        status: 'disabled',
        disabled_reason: reason,
        disabled_at: new Date().toISOString(),
      }),
    );
  }

  async deleteEndpoint(
    principal: PartnerPrincipal,
    endpointId: string,
  ): Promise<void> {
    await this.requireEndpoint(principal, endpointId);
    await this.repo.deleteEndpoint(this.db, endpointId);
  }

  async listDeliveries(
    principal: PartnerPrincipal,
    endpointId: string,
    limit: number,
    cursor: { createdAt: string; id: string } | null,
  ): Promise<PartnerWebhookDeliveryRow[]> {
    await this.requireEndpoint(principal, endpointId);
    return this.repo.listDeliveries(this.db, endpointId, limit, cursor);
  }

  /**
   * Re-queue a delivery. Creates a NEW delivery row rather than resetting the
   * old one, so the history of what was attempted and when survives the
   * replay.
   */
  async replayDelivery(
    principal: PartnerPrincipal,
    endpointId: string,
    deliveryId: string,
  ): Promise<PartnerWebhookDeliveryRow> {
    await this.requireEndpoint(principal, endpointId);
    const original = await this.repo.getDelivery(this.db, deliveryId);
    if (!original || original.endpoint_id !== endpointId) {
      throw PartnerErrors.notFound('delivery');
    }
    const event = await this.repo.getEvent(this.db, original.event_id);
    if (!event) throw PartnerErrors.notFound('event');

    // The unique (endpoint, event) constraint means a replay of a delivery
    // that already exists collides. Reset that row instead of failing.
    const created = await this.repo.enqueueDelivery(
      this.db,
      endpointId,
      event,
      original.id,
    );
    if (created) return created;

    await this.repo.updateDelivery(this.db, original.id, {
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      last_status_code: null,
    });
    const refreshed = await this.repo.getDelivery(this.db, original.id);
    if (!refreshed) throw PartnerErrors.notFound('delivery');
    return refreshed;
  }

  // ---- publishing -------------------------------------------------------

  /**
   * Record a business fact and fan it out to every active endpoint of every
   * active application in the owning organization that subscribed to it.
   *
   * The event is persisted FIRST. If fan-out then fails, the event still
   * exists and can be replayed; the reverse order would lose it silently.
   */
  async publish(input: {
    organizationId: string | null;
    subjectUserId: string | null;
    eventType: PartnerEventType;
    resourceType: string;
    resourceId: string | null;
    environment: PartnerEnvironment;
    data: Record<string, unknown>;
  }): Promise<{ event: PartnerEventRow; queued: number }> {
    const event = await this.repo.createEvent(this.db, {
      organization_id: input.organizationId,
      subject_user_id: input.subjectUserId,
      event_type: input.eventType,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      environment: input.environment,
      payload: input.data,
    });

    if (!input.organizationId) return { event, queued: 0 };

    const endpoints = await this.repo.listEndpointsForOrganization(
      this.db,
      input.organizationId,
      input.environment,
    );
    let queued = 0;
    for (const endpoint of endpoints) {
      if (!endpoint.events.includes(input.eventType)) continue;
      const delivery = await this.repo.enqueueDelivery(
        this.db,
        endpoint.id,
        event,
      );
      if (delivery) queued += 1;
    }
    return { event, queued };
  }

  // ---- delivery ----------------------------------------------------------

  /**
   * Attempt one delivery and record the outcome. Called by the queue
   * processor; exposed directly so the retry logic is unit-testable without a
   * queue.
   */
  async attemptDelivery(
    delivery: PartnerWebhookDeliveryRow,
    now: Date = new Date(),
  ): Promise<'delivered' | 'retry' | 'dead'> {
    const endpoint = await this.repo.getEndpoint(this.db, delivery.endpoint_id);
    if (!endpoint) {
      await this.repo.updateDelivery(this.db, delivery.id, {
        status: 'dead',
        last_error: 'endpoint no longer exists',
      });
      return 'dead';
    }
    if (endpoint.status !== 'active') {
      await this.repo.updateDelivery(this.db, delivery.id, {
        status: 'dead',
        last_error: `endpoint is ${endpoint.status}`,
      });
      return 'dead';
    }

    const event = await this.repo.getEvent(this.db, delivery.event_id);
    if (!event) {
      await this.repo.updateDelivery(this.db, delivery.id, {
        status: 'dead',
        last_error: 'event no longer exists',
      });
      return 'dead';
    }

    const body = JSON.stringify(toWebhookPayload(event));
    const timestamp = Math.floor(now.getTime() / 1000);
    const attempts = delivery.attempt_count + 1;

    const result = await this.sender.send(
      endpoint.url,
      body,
      {
        ...this.headersFor(endpoint, body, timestamp),
        'V-Event-Id': event.id,
        'V-Event-Type': event.event_type,
        'V-Delivery-Id': delivery.id,
        'V-Delivery-Attempt': String(attempts),
      },
      this.timeoutMs,
    );

    const decision = decideNextDelivery(
      { statusCode: result.statusCode, networkError: result.networkError },
      attempts,
    );

    if (decision.next === 'delivered') {
      await this.repo.updateDelivery(this.db, delivery.id, {
        status: 'delivered',
        attempt_count: attempts,
        last_status_code: result.statusCode,
        duration_ms: result.durationMs,
        delivered_at: now.toISOString(),
        last_error: null,
      });
      // A success clears the failure streak; consecutive means consecutive.
      if (endpoint.consecutive_failures > 0) {
        await this.repo.updateEndpoint(this.db, endpoint.id, {
          consecutive_failures: 0,
        });
      }
      return 'delivered';
    }

    const failures = endpoint.consecutive_failures + 1;
    const errorText = truncate(
      result.responseSnippet ??
        (result.networkError ? 'network error' : 'no response body'),
    );

    if (decision.next === 'dead') {
      await this.repo.updateDelivery(this.db, delivery.id, {
        status: 'dead',
        attempt_count: attempts,
        last_status_code: result.statusCode,
        duration_ms: result.durationMs,
        last_error: `${decision.reason}: ${errorText}`,
      });
    } else {
      await this.repo.updateDelivery(this.db, delivery.id, {
        status: 'failed',
        attempt_count: attempts,
        last_status_code: result.statusCode,
        duration_ms: result.durationMs,
        last_error: errorText,
        next_attempt_at: new Date(
          now.getTime() + decision.delaySeconds * 1000,
        ).toISOString(),
      });
    }

    const disable = shouldAutoDisable(failures);
    await this.repo.updateEndpoint(this.db, endpoint.id, {
      consecutive_failures: failures,
      ...(disable
        ? {
            status: 'disabled' as const,
            disabled_reason: `auto-disabled after ${failures} consecutive delivery failures`,
            disabled_at: now.toISOString(),
          }
        : {}),
    });
    if (disable) {
      this.log.warn(
        `webhook endpoint ${endpoint.id} auto-disabled after ${failures} consecutive failures`,
      );
    }

    return decision.next;
  }

  /** Drain one batch of due deliveries. */
  async drainOnce(
    limit = 50,
    now: Date = new Date(),
  ): Promise<{
    attempted: number;
    delivered: number;
    dead: number;
  }> {
    const due = await this.repo.claimDueDeliveries(
      this.db,
      limit,
      now.toISOString(),
    );
    let delivered = 0;
    let dead = 0;
    for (const delivery of due) {
      try {
        const outcome = await this.attemptDelivery(delivery, now);
        if (outcome === 'delivered') delivered += 1;
        if (outcome === 'dead') dead += 1;
      } catch (err) {
        // A thrown attempt must not leave the row stuck in `delivering`
        // forever — put it back so the next tick retries it.
        this.log.error(
          `webhook delivery ${delivery.id} threw: ${(err as Error).message}`,
        );
        await this.repo
          .updateDelivery(this.db, delivery.id, {
            status: 'failed',
            next_attempt_at: new Date(now.getTime() + 60_000).toISOString(),
            last_error: truncate((err as Error).message),
          })
          .catch(() => undefined);
      }
    }
    return { attempted: due.length, delivered, dead };
  }

  // ---- helpers -----------------------------------------------------------

  /**
   * Signing headers. During a rotation overlap the payload carries a signature
   * from BOTH secrets so either verifier accepts it.
   */
  private headersFor(
    endpoint: PartnerWebhookEndpointRow,
    body: string,
    timestamp: number,
  ): Record<string, string> {
    const secrets = [this.crypto.decrypt(endpoint.secret_encrypted)];
    if (
      endpoint.previous_secret_encrypted &&
      endpoint.previous_secret_expires_at &&
      new Date(endpoint.previous_secret_expires_at).getTime() > Date.now()
    ) {
      secrets.push(this.crypto.decrypt(endpoint.previous_secret_encrypted));
    }
    return {
      'Content-Type': 'application/json',
      'User-Agent': 'VisaAI-Webhooks/1.0',
      'V-Signature': buildSignatureHeader(body, secrets, timestamp),
    };
  }

  /** Endpoint lookup that also proves it belongs to the calling application. */
  private async requireEndpoint(
    principal: PartnerPrincipal,
    endpointId: string,
  ): Promise<PartnerWebhookEndpointRow> {
    const endpoint = await this.repo.getEndpoint(this.db, endpointId);
    // Same 404 whether it does not exist or belongs to someone else: a
    // distinguishable response is an enumeration oracle.
    if (!endpoint || endpoint.application_id !== principal.applicationId) {
      throw PartnerErrors.notFound('webhook endpoint');
    }
    return endpoint;
  }
}

function normalizeEvents(input: readonly string[]): PartnerEventType[] {
  const wanted = new Set(input);
  return SUBSCRIBABLE_EVENTS.filter((e) => wanted.has(e));
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_SNIPPET
    ? `${value.slice(0, MAX_ERROR_SNIPPET)}…`
    : value;
}

export function toEndpointDto(
  row: PartnerWebhookEndpointRow,
): PartnerWebhookEndpoint {
  // Note the omissions: no secret, encrypted or otherwise, ever leaves here.
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    status: row.status,
    consecutive_failures: row.consecutive_failures,
    disabled_reason: row.disabled_reason,
    created_at: row.created_at,
  };
}

export function toDeliveryDto(
  row: PartnerWebhookDeliveryRow,
): PartnerWebhookDelivery {
  return {
    id: row.id,
    event_id: row.event_id,
    event_type: row.event_type,
    status: row.status,
    attempt_count: row.attempt_count,
    next_attempt_at: row.next_attempt_at,
    last_status_code: row.last_status_code,
    last_error: row.last_error,
    delivered_at: row.delivered_at,
    created_at: row.created_at,
  };
}

export function toWebhookPayload(
  event: PartnerEventRow,
): PartnerWebhookPayload {
  return {
    id: event.id,
    type: event.event_type,
    created_at: event.created_at,
    environment: event.environment,
    sequence: Number(event.sequence),
    data: event.payload,
  };
}

function describeUrlRejection(reason: string | null): string {
  switch (reason) {
    case 'scheme_not_allowed':
      return 'Webhook URLs must use https (http://localhost is permitted in sandbox only).';
    case 'credentials_in_url':
      return 'Webhook URLs must not embed credentials.';
    case 'private_address':
      return 'Webhook URLs must not point at a private, loopback or link-local address.';
    case 'metadata_host':
      return 'That hostname is not a permitted webhook destination.';
    case 'port_not_allowed':
      return 'Webhook URLs may only use ports 80, 443 or 8443.';
    default:
      return 'Webhook URL is not a valid absolute URL.';
  }
}
