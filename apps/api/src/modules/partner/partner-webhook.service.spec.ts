/* eslint-disable @typescript-eslint/require-await --
 * Test doubles implement async interfaces over synchronous fixtures.
 */
import type { PartnerPrincipal } from '@visaai/types';
import { InMemoryPartnerRepository } from './in-memory-partner.repository';
import { PartnerApiException } from './partner-errors';
import {
  AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES,
  MAX_DELIVERY_ATTEMPTS,
  verifySignature,
} from './partner-webhook-signature';
import {
  PartnerWebhookService,
  type WebhookSender,
  type WebhookSendResult,
} from './partner-webhook.service';

/** Reversible "encryption" so tests can read what was stored. */
const crypto = {
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
} as never;

class RecordingSender implements WebhookSender {
  calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  response: WebhookSendResult = {
    statusCode: 200,
    networkError: false,
    durationMs: 12,
    responseSnippet: 'ok',
  };

  async send(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<WebhookSendResult> {
    this.calls.push({ url, body, headers });
    return this.response;
  }
}

describe('PartnerWebhookService', () => {
  let repo: InMemoryPartnerRepository;
  let sender: RecordingSender;
  let service: PartnerWebhookService;
  let principal: PartnerPrincipal;

  const supabase = { admin: {} } as never;
  const config = { get: () => undefined } as never;

  beforeEach(async () => {
    repo = new InMemoryPartnerRepository();
    sender = new RecordingSender();
    service = new PartnerWebhookService(supabase, config, crypto, repo, sender);

    const partner = await repo.createPartner(null, {
      organization_id: 'org-1',
      legal_name: 'Acme',
      contact_email: 'dev@acme.test',
      website: null,
      status: 'approved',
      tier: 'standard',
    });
    const application = await repo.createApplication(null, {
      partner_id: partner.id,
      name: 'Acme',
      environment: 'live',
      client_id: 'client-1',
      status: 'active',
      scopes: ['webhooks:read', 'webhooks:write'],
    });
    principal = {
      partnerId: partner.id,
      organizationId: 'org-1',
      applicationId: application.id,
      clientId: 'client-1',
      environment: 'live',
      scopes: ['webhooks:read', 'webhooks:write'],
      credentialKind: 'api_key',
      credentialId: 'k1',
      subjectUserId: null,
    };
  });

  async function activeEndpoint(events = ['application.created']) {
    const { endpoint, secret } = await service.createEndpoint(principal, {
      url: 'https://hooks.acme.test/x',
      events,
    });
    await repo.updateEndpoint(null, endpoint.id, {
      status: 'active',
      verification_token: null,
    });
    return { endpoint, secret };
  }

  describe('registration', () => {
    it('returns the signing secret exactly once and never again', async () => {
      const { endpoint, secret } = await service.createEndpoint(principal, {
        url: 'https://hooks.acme.test/x',
        events: ['application.created'],
      });
      expect(secret.startsWith('whsec_')).toBe(true);
      // The DTO has no secret field at all, so no listing can leak it.
      expect(JSON.stringify(endpoint)).not.toContain(secret);
      const listed = await service.listEndpoints(principal);
      expect(JSON.stringify(listed)).not.toContain(secret);
    });

    it('stores the secret encrypted, not in plaintext', async () => {
      const { secret } = await service.createEndpoint(principal, {
        url: 'https://hooks.acme.test/x',
        events: ['application.created'],
      });
      expect(repo.endpoints[0].secret_encrypted).toBe(`enc:${secret}`);
    });

    it('starts pending verification, not active', async () => {
      const { endpoint } = await service.createEndpoint(principal, {
        url: 'https://hooks.acme.test/x',
        events: ['application.created'],
      });
      expect(endpoint.status).toBe('pending_verification');
    });

    it('rejects an SSRF destination', async () => {
      await expect(
        service.createEndpoint(principal, {
          url: 'https://169.254.169.254/meta',
          events: ['application.created'],
        }),
      ).rejects.toThrow(PartnerApiException);
    });

    it('drops unknown event names and rejects a subscription with none left', async () => {
      await expect(
        service.createEndpoint(principal, {
          url: 'https://hooks.acme.test/x',
          events: ['not.an.event'],
        }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('keeps only recognised events', async () => {
      const { endpoint } = await service.createEndpoint(principal, {
        url: 'https://hooks.acme.test/x',
        events: ['application.created', 'nope'],
      });
      expect(endpoint.events).toEqual(['application.created']);
    });
  });

  describe('ownership', () => {
    // Cross-tenant IDOR: same 404 whether it is missing or someone else's.
    it("returns 404, not 403, for another application's endpoint", async () => {
      const { endpoint } = await activeEndpoint();
      const intruder: PartnerPrincipal = {
        ...principal,
        applicationId: 'other-app',
      };
      await expect(
        service.listDeliveries(intruder, endpoint.id, 10, null),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(
        service.rotateSecret(intruder, endpoint.id),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
      await expect(
        service.deleteEndpoint(intruder, endpoint.id),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  describe('verification', () => {
    it('activates when the endpoint echoes the challenge', async () => {
      const { endpoint } = await service.createEndpoint(principal, {
        url: 'https://hooks.acme.test/x',
        events: ['application.created'],
      });
      const token = repo.endpoints[0].verification_token as string;
      sender.response = {
        statusCode: 200,
        networkError: false,
        durationMs: 5,
        responseSnippet: JSON.stringify({ challenge: token }),
      };
      const verified = await service.verifyEndpoint(principal, endpoint.id);
      expect(verified.status).toBe('active');
    });

    it('refuses when the challenge is not echoed', async () => {
      const { endpoint } = await service.createEndpoint(principal, {
        url: 'https://hooks.acme.test/x',
        events: ['application.created'],
      });
      sender.response = {
        statusCode: 200,
        networkError: false,
        durationMs: 5,
        responseSnippet: 'thanks',
      };
      await expect(
        service.verifyEndpoint(principal, endpoint.id),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    });

    it('refuses when the endpoint returns a non-2xx', async () => {
      const { endpoint } = await service.createEndpoint(principal, {
        url: 'https://hooks.acme.test/x',
        events: ['application.created'],
      });
      const token = repo.endpoints[0].verification_token as string;
      sender.response = {
        statusCode: 500,
        networkError: false,
        durationMs: 5,
        responseSnippet: token,
      };
      await expect(
        service.verifyEndpoint(principal, endpoint.id),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    });
  });

  describe('publishing and fan-out', () => {
    it('queues a delivery for a subscribed endpoint', async () => {
      await activeEndpoint(['application.created']);
      const result = await service.publish({
        organizationId: 'org-1',
        subjectUserId: 'user-1',
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: { status: 'draft' },
      });
      expect(result.queued).toBe(1);
    });

    it('does not queue for an endpoint that did not subscribe', async () => {
      await activeEndpoint(['document.uploaded']);
      const result = await service.publish({
        organizationId: 'org-1',
        subjectUserId: 'user-1',
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      expect(result.queued).toBe(0);
    });

    // Tenant isolation for events: org-2 must never hear about org-1.
    it("does not queue for another organization's endpoint", async () => {
      await activeEndpoint(['application.created']);
      const result = await service.publish({
        organizationId: 'org-2',
        subjectUserId: 'user-9',
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      expect(result.queued).toBe(0);
    });

    // Environment isolation: a sandbox endpoint must not receive live events.
    it('does not deliver a live event to a sandbox endpoint', async () => {
      await activeEndpoint(['application.created']);
      const result = await service.publish({
        organizationId: 'org-1',
        subjectUserId: 'user-1',
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'sandbox',
        data: {},
      });
      expect(result.queued).toBe(0);
    });

    it('persists the event even when nothing is subscribed', async () => {
      const result = await service.publish({
        organizationId: 'org-1',
        subjectUserId: 'user-1',
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      expect(result.queued).toBe(0);
      expect(await repo.getEvent(null, result.event.id)).not.toBeNull();
    });

    it('assigns a monotonic sequence', async () => {
      const a = await service.publish({
        organizationId: 'org-1',
        subjectUserId: null,
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      const b = await service.publish({
        organizationId: 'org-1',
        subjectUserId: null,
        eventType: 'application.updated',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      expect(b.event.sequence).toBeGreaterThan(a.event.sequence);
    });
  });

  describe('delivery', () => {
    async function queueOne() {
      const { endpoint, secret } = await activeEndpoint();
      const { event } = await service.publish({
        organizationId: 'org-1',
        subjectUserId: 'user-1',
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: { status: 'draft' },
      });
      const delivery = repo.deliveries.find((d) => d.event_id === event.id);
      if (!delivery) throw new Error('expected a queued delivery');
      return { endpoint, secret, delivery, event };
    }

    it('signs the payload so the receiver can verify it', async () => {
      const { delivery, secret } = await queueOne();
      await service.attemptDelivery(delivery);
      const call = sender.calls.at(-1);
      if (!call) throw new Error('expected a send');
      const result = verifySignature(
        call.body,
        call.headers['V-Signature'],
        [secret],
        Math.floor(Date.now() / 1000),
      );
      expect(result.valid).toBe(true);
    });

    it('sends the event id, type and attempt as headers', async () => {
      const { delivery, event } = await queueOne();
      await service.attemptDelivery(delivery);
      const headers = sender.calls.at(-1)?.headers ?? {};
      expect(headers['V-Event-Id']).toBe(event.id);
      expect(headers['V-Event-Type']).toBe('application.created');
      expect(headers['V-Delivery-Attempt']).toBe('1');
    });

    it('marks a 2xx as delivered', async () => {
      const { delivery } = await queueOne();
      expect(await service.attemptDelivery(delivery)).toBe('delivered');
      expect((await repo.getDelivery(null, delivery.id))?.status).toBe(
        'delivered',
      );
    });

    it('schedules a retry after a 500', async () => {
      const { delivery } = await queueOne();
      sender.response = {
        statusCode: 500,
        networkError: false,
        durationMs: 5,
        responseSnippet: 'boom',
      };
      expect(await service.attemptDelivery(delivery)).toBe('retry');
      const stored = await repo.getDelivery(null, delivery.id);
      expect(stored?.status).toBe('failed');
      expect(new Date(stored?.next_attempt_at ?? 0).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('gives up after the attempt budget', async () => {
      const { delivery } = await queueOne();
      await repo.updateDelivery(null, delivery.id, {
        attempt_count: MAX_DELIVERY_ATTEMPTS - 1,
      });
      const refreshed = await repo.getDelivery(null, delivery.id);
      sender.response = {
        statusCode: 500,
        networkError: false,
        durationMs: 5,
        responseSnippet: 'boom',
      };
      expect(await service.attemptDelivery(refreshed as never)).toBe('dead');
    });

    it('stops immediately on 410 Gone', async () => {
      const { delivery } = await queueOne();
      sender.response = {
        statusCode: 410,
        networkError: false,
        durationMs: 5,
        responseSnippet: 'gone',
      };
      expect(await service.attemptDelivery(delivery)).toBe('dead');
    });

    it('does not deliver to a disabled endpoint', async () => {
      const { delivery, endpoint } = await queueOne();
      await repo.updateEndpoint(null, endpoint.id, { status: 'disabled' });
      expect(await service.attemptDelivery(delivery)).toBe('dead');
      expect(sender.calls).toHaveLength(0);
    });

    it('clears the failure streak on success', async () => {
      const { delivery, endpoint } = await queueOne();
      await repo.updateEndpoint(null, endpoint.id, { consecutive_failures: 5 });
      await service.attemptDelivery(delivery);
      expect(
        (await repo.getEndpoint(null, endpoint.id))?.consecutive_failures,
      ).toBe(0);
    });

    it('auto-disables an endpoint after the consecutive-failure threshold', async () => {
      const { delivery, endpoint } = await queueOne();
      await repo.updateEndpoint(null, endpoint.id, {
        consecutive_failures: AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES - 1,
      });
      sender.response = {
        statusCode: 503,
        networkError: false,
        durationMs: 5,
        responseSnippet: 'down',
      };
      await service.attemptDelivery(delivery);
      const stored = await repo.getEndpoint(null, endpoint.id);
      expect(stored?.status).toBe('disabled');
      expect(stored?.disabled_reason).toContain('consecutive');
    });

    it('truncates a very large error body before storing it', async () => {
      const { delivery } = await queueOne();
      sender.response = {
        statusCode: 500,
        networkError: false,
        durationMs: 5,
        responseSnippet: 'x'.repeat(5000),
      };
      await service.attemptDelivery(delivery);
      const stored = await repo.getDelivery(null, delivery.id);
      expect((stored?.last_error ?? '').length).toBeLessThan(600);
    });

    it('drains a batch', async () => {
      await queueOne();
      const result = await service.drainOnce(10);
      expect(result).toEqual({ attempted: 1, delivered: 1, dead: 0 });
    });

    // A throw inside an attempt must not leave the row stuck in `delivering`.
    it('recovers a delivery whose attempt threw', async () => {
      const { delivery } = await queueOne();
      jest
        .spyOn(service, 'attemptDelivery')
        .mockRejectedValueOnce(new Error('kaboom'));
      await service.drainOnce(10);
      const stored = await repo.getDelivery(null, delivery.id);
      expect(stored?.status).toBe('failed');
    });
  });

  describe('secret rotation', () => {
    it('signs with both secrets during the overlap window', async () => {
      const { endpoint, secret: original } = await activeEndpoint();
      const { secret: replacement } = await service.rotateSecret(
        principal,
        endpoint.id,
      );

      const { event } = await service.publish({
        organizationId: 'org-1',
        subjectUserId: null,
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      const delivery = repo.deliveries.find((d) => d.event_id === event.id);
      await service.attemptDelivery(delivery as never);

      const call = sender.calls.at(-1);
      const now = Math.floor(Date.now() / 1000);
      expect(
        verifySignature(
          call!.body,
          call!.headers['V-Signature'],
          [replacement],
          now,
        ).valid,
      ).toBe(true);
      // The whole point of an overlap: the old verifier keeps working.
      expect(
        verifySignature(
          call!.body,
          call!.headers['V-Signature'],
          [original],
          now,
        ).valid,
      ).toBe(true);
    });
  });

  describe('replay', () => {
    it('re-queues a dead delivery', async () => {
      const { endpoint } = await activeEndpoint();
      const { event } = await service.publish({
        organizationId: 'org-1',
        subjectUserId: null,
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      const delivery = repo.deliveries.find((d) => d.event_id === event.id);
      await repo.updateDelivery(null, delivery!.id, {
        status: 'dead',
        attempt_count: 8,
      });

      const replayed = await service.replayDelivery(
        principal,
        endpoint.id,
        delivery!.id,
      );
      expect(replayed.status).toBe('pending');
      expect(replayed.attempt_count).toBe(0);
    });

    it("refuses to replay another application's delivery", async () => {
      const { endpoint } = await activeEndpoint();
      const { event } = await service.publish({
        organizationId: 'org-1',
        subjectUserId: null,
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      const delivery = repo.deliveries.find((d) => d.event_id === event.id);
      await expect(
        service.replayDelivery(
          { ...principal, applicationId: 'other-app' },
          endpoint.id,
          delivery!.id,
        ),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  describe('idempotent fan-out', () => {
    // The unique (endpoint, event) key means a repeated publish of the same
    // event cannot double-deliver.
    it('never queues the same event twice for one endpoint', async () => {
      const { endpoint } = await activeEndpoint();
      const { event } = await service.publish({
        organizationId: 'org-1',
        subjectUserId: null,
        eventType: 'application.created',
        resourceType: 'application',
        resourceId: null,
        environment: 'live',
        data: {},
      });
      const second = await repo.enqueueDelivery(null, endpoint.id, event);
      expect(second).toBeNull();
      expect(
        repo.deliveries.filter((d) => d.event_id === event.id),
      ).toHaveLength(1);
    });
  });
});
