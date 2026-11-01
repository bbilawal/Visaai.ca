import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type {
  PartnerApiProduct,
  PartnerPage,
  PartnerPrincipal,
  PartnerUsageSnapshot,
  PartnerWebhookDelivery,
  PartnerWebhookEndpoint,
} from '@visaai/types';
import { z } from 'zod';
import { Partner, PartnerAuthGuard, RequireScopes } from './partner-auth.guard';
import { PartnerErrors } from './partner-errors';
import { PartnerExceptionFilter } from './partner-exception.filter';
import {
  buildPage,
  clampLimit,
  CURRENT_API_VERSION,
  decodeCursor,
} from './partner-governance';
import { PartnerIdempotencyService } from './partner-idempotency.service';
import { PartnerResourcesService } from './partner-resources.service';
import { PartnerResponseInterceptor } from './partner-response.interceptor';
import { PartnerSandboxService } from './partner-sandbox.service';
import { availableProducts, API_PRODUCTS } from './partner-scopes';
import { PartnerUsageService } from './partner-usage.service';
import {
  PartnerWebhookService,
  SUBSCRIBABLE_EVENTS,
  toDeliveryDto,
} from './partner-webhook.service';

/** Parse an untrusted payload or fail with the partner error envelope. */
function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw PartnerErrors.invalidRequest(
      first?.message ?? 'Request validation failed.',
      first?.path.join('.'),
    );
  }
  return result.data;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Path params reach `.eq()` directly; a non-uuid would surface as a 500. */
function uuidParam(value: string, name: string): string {
  if (!UUID_RE.test(value)) {
    throw PartnerErrors.invalidRequest(`${name} must be a UUID.`, name);
  }
  return value;
}

const CreateEndpointDto = z.object({
  url: z.string().min(1).max(2048),
  events: z.array(z.string()).min(1).max(50),
  description: z.string().max(500).optional(),
});

const UpdateEndpointDto = z.object({
  events: z.array(z.string()).min(1).max(50),
});

const CreateApplicationDto = z.object({
  user_id: z.string().regex(UUID_RE).optional(),
  country: z.string().length(2).optional(),
  visa_type: z.string().max(64).optional(),
  framework_id: z.string().regex(UUID_RE).optional(),
});

const ListQueryDto = z.object({
  user_id: z.string().regex(UUID_RE).optional(),
  limit: z.union([z.string(), z.number()]).optional(),
  cursor: z.string().max(512).optional(),
});

/**
 * The partner API, v1.
 *
 * Versioned in the path (`/v1/...`) rather than by header. A URL that names
 * its version is one a partner can curl, bookmark, log and diff; a version
 * negotiated in a header is invisible in every one of those places.
 *
 * Every route declares its scope. The guard refuses any route that does not —
 * see PartnerAuthGuard.
 */
@Controller('v1')
@UseGuards(PartnerAuthGuard)
@UseFilters(PartnerExceptionFilter)
@UseInterceptors(PartnerResponseInterceptor)
export class PartnerV1Controller {
  constructor(
    private readonly usage: PartnerUsageService,
    private readonly webhooks: PartnerWebhookService,
    private readonly resources: PartnerResourcesService,
    private readonly sandbox: PartnerSandboxService,
    private readonly idempotency: PartnerIdempotencyService,
  ) {}

  // ---- identity & catalog ------------------------------------------------

  @Get('me')
  @RequireScopes('partner:read')
  me(@Partner() principal: PartnerPrincipal): Record<string, unknown> {
    return {
      client_id: principal.clientId,
      application_id: principal.applicationId,
      environment: principal.environment,
      scopes: principal.scopes,
      credential_kind: principal.credentialKind,
      subject_user_id: principal.subjectUserId,
      api_version: CURRENT_API_VERSION,
    };
  }

  @Get('catalog')
  @RequireScopes('partner:read')
  catalog(@Partner() principal: PartnerPrincipal): {
    available: PartnerApiProduct[];
    all: readonly PartnerApiProduct[];
  } {
    // Both lists: what this credential can call today, and the full governed
    // catalog including what is planned, so a partner can see what to request.
    return {
      available: availableProducts(principal.scopes),
      all: API_PRODUCTS,
    };
  }

  @Get('usage')
  @RequireScopes('usage:read')
  usageSnapshot(
    @Partner() principal: PartnerPrincipal,
  ): Promise<PartnerUsageSnapshot> {
    return this.usage.snapshot(principal);
  }

  // ---- webhooks -----------------------------------------------------------

  @Get('webhooks/events')
  @RequireScopes('webhooks:read')
  events(): { data: readonly string[] } {
    return { data: SUBSCRIBABLE_EVENTS };
  }

  @Get('webhooks')
  @RequireScopes('webhooks:read')
  listEndpoints(
    @Partner() principal: PartnerPrincipal,
  ): Promise<PartnerWebhookEndpoint[]> {
    return this.webhooks.listEndpoints(principal);
  }

  @Post('webhooks')
  @RequireScopes('webhooks:write')
  createEndpoint(
    @Partner() principal: PartnerPrincipal,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ endpoint: PartnerWebhookEndpoint; secret: string }> {
    const input = parse(CreateEndpointDto, body);
    return this.idempotency.run(
      principal,
      idempotencyKey,
      'POST',
      '/v1/webhooks',
      input,
      () => this.webhooks.createEndpoint(principal, input),
    );
  }

  @Post('webhooks/:id/verify')
  @RequireScopes('webhooks:write')
  verifyEndpoint(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
  ): Promise<PartnerWebhookEndpoint> {
    return this.webhooks.verifyEndpoint(principal, uuidParam(id, 'id'));
  }

  @Post('webhooks/:id')
  @RequireScopes('webhooks:write')
  updateEndpoint(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PartnerWebhookEndpoint> {
    const input = parse(UpdateEndpointDto, body);
    return this.webhooks.updateEndpointEvents(
      principal,
      uuidParam(id, 'id'),
      input.events,
    );
  }

  @Post('webhooks/:id/rotate-secret')
  @RequireScopes('webhooks:write')
  rotateSecret(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
  ): Promise<{ secret: string; previousValidUntil: string }> {
    return this.webhooks.rotateSecret(principal, uuidParam(id, 'id'));
  }

  @Delete('webhooks/:id')
  @RequireScopes('webhooks:write')
  async deleteEndpoint(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.webhooks.deleteEndpoint(principal, uuidParam(id, 'id'));
    return { deleted: true };
  }

  @Get('webhooks/:id/deliveries')
  @RequireScopes('webhooks:read')
  async listDeliveries(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<PartnerPage<PartnerWebhookDelivery>> {
    const q = parse(ListQueryDto, query ?? {});
    const limit = clampLimit(q.limit);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) {
      throw PartnerErrors.invalidRequest('Cursor is not valid.', 'cursor');
    }
    const rows = await this.webhooks.listDeliveries(
      principal,
      uuidParam(id, 'id'),
      limit,
      cursor,
    );
    const page = buildPage(rows, limit);
    return {
      data: page.data.map(toDeliveryDto),
      has_more: page.has_more,
      next_cursor: page.next_cursor,
    };
  }

  @Post('webhooks/:id/deliveries/:deliveryId/replay')
  @RequireScopes('webhooks:write')
  async replay(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ): Promise<PartnerWebhookDelivery> {
    const row = await this.webhooks.replayDelivery(
      principal,
      uuidParam(id, 'id'),
      uuidParam(deliveryId, 'deliveryId'),
    );
    return toDeliveryDto(row);
  }

  // ---- immigration resources ----------------------------------------------

  @Get('applications')
  @RequireScopes('applications:read')
  listApplications(
    @Partner() principal: PartnerPrincipal,
    @Query() query: unknown,
  ): Promise<Record<string, unknown>[]> {
    const q = parse(ListQueryDto, query ?? {});
    return this.resources.listApplications(principal, q.user_id ?? null);
  }

  @Get('applications/:id')
  @RequireScopes('applications:read')
  getApplication(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.resources.getApplication(principal, uuidParam(id, 'id'));
  }

  @Post('applications')
  @RequireScopes('applications:write')
  createApplication(
    @Partner() principal: PartnerPrincipal,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const input = parse(CreateApplicationDto, body ?? {});
    return this.idempotency.run(
      principal,
      idempotencyKey,
      'POST',
      '/v1/applications',
      input,
      () => this.resources.createApplication(principal, input),
    );
  }

  @Get('applications/:id/documents')
  @RequireScopes('documents:read')
  listDocuments(
    @Partner() principal: PartnerPrincipal,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>[]> {
    return this.resources.listDocuments(principal, uuidParam(id, 'id'));
  }

  @Get('consents')
  @RequireScopes('consents:read')
  async listConsents(
    @Partner() principal: PartnerPrincipal,
    @Query() query: unknown,
  ): Promise<PartnerPage<Record<string, unknown>>> {
    const q = parse(ListQueryDto, query ?? {});
    const limit = clampLimit(q.limit);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await this.resources.listConsents(principal, limit, cursor);
    const page = buildPage(rows, limit);
    return {
      data: page.data.map((r) => ({
        user_id: r.user_id,
        scopes: r.scopes,
        granted_at: r.granted_at,
      })),
      has_more: page.has_more,
      next_cursor: page.next_cursor,
    };
  }

  // ---- sandbox ------------------------------------------------------------

  @Get('sandbox/personas')
  @RequireScopes('partner:read')
  personas(@Partner() principal: PartnerPrincipal): {
    data: readonly Record<string, unknown>[];
  } {
    if (principal.environment !== 'sandbox') {
      throw PartnerErrors.environmentMismatch();
    }
    return { data: this.sandbox.personas() };
  }

  @Post('sandbox/reset')
  @RequireScopes('partner:read')
  resetSandbox(
    @Partner() principal: PartnerPrincipal,
  ): Promise<{ deleted: number }> {
    return this.sandbox.reset(principal);
  }
}
