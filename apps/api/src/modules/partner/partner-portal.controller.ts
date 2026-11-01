import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  PartnerApiKeyIssued,
  PartnerApiKeySummary,
  PartnerApiProduct,
  PartnerApplication,
} from '@visaai/types';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermission } from '../iam/permissions.guard';
import { PartnerConsentService } from './partner-consent.service';
import {
  PartnerRegistryService,
  toApplicationDto,
} from './partner-registry.service';
import { API_PRODUCTS, SCOPE_CATALOG } from './partner-scopes';
import type { PartnerRow } from './partner.repository';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OrgQueryDto = z.object({ organizationId: z.string().regex(UUID_RE) });

const RegisterDto = z.object({
  organizationId: z.string().regex(UUID_RE),
  legalName: z.string().min(2).max(200),
  contactEmail: z.string().email().max(320),
  website: z.string().url().max(2048).optional(),
});

const CreateApplicationDto = z.object({
  organizationId: z.string().regex(UUID_RE),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  environment: z.enum(['sandbox', 'live']),
  scopes: z.array(z.string()).max(32).default([]),
  grantTypes: z
    .array(z.enum(['client_credentials', 'authorization_code']))
    .optional(),
  redirectUris: z.array(z.string().max(2048)).max(10).optional(),
  ipAllowlist: z.array(z.string().max(64)).max(50).optional(),
});

const CreateKeyDto = z.object({
  organizationId: z.string().regex(UUID_RE),
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).max(32).optional(),
  expiresAt: z.string().datetime().optional(),
});

const RevokeKeyDto = z.object({
  organizationId: z.string().regex(UUID_RE),
  reason: z.string().min(1).max(500),
});

const ApproveDto = z.object({ scopes: z.array(z.string()).max(32) });
const StatusDto = z.object({
  status: z.enum(['pending', 'approved', 'suspended', 'rejected']),
  reason: z.string().max(500).optional(),
});

/**
 * Partner Portal API — the internal surface the web portal calls with a normal
 * user session. Distinct from `/v1`, which partners call with partner
 * credentials. Mixing them would mean a partner credential could manage its
 * own scopes.
 *
 * Authorization is two-layered: PermissionsGuard checks the caller HOLDS the
 * permission, and the service re-checks they hold it FOR THIS ORGANIZATION.
 * The first stops a random user; the second stops one org admin reaching
 * another org's credentials.
 */
@Controller('partner-portal')
@UseGuards(JwtGuard, PermissionsGuard)
export class PartnerPortalController {
  constructor(
    private readonly registry: PartnerRegistryService,
    private readonly consent: PartnerConsentService,
  ) {}

  // ---- reference data (no org context needed) ---------------------------

  @Get('scopes')
  @RequirePermission('partner.read')
  scopes(): { data: typeof SCOPE_CATALOG } {
    return { data: SCOPE_CATALOG };
  }

  @Get('catalog')
  @RequirePermission('partner.read')
  catalog(): { data: readonly PartnerApiProduct[] } {
    return { data: API_PRODUCTS };
  }

  // ---- registration ------------------------------------------------------

  @Get()
  @RequirePermission('partner.read')
  get(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<PartnerRow | null> {
    const q = parse(OrgQueryDto, query);
    return this.registry.getForOrganization(user.id, q.organizationId);
  }

  @Post()
  @RequirePermission('partner.manage')
  register(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<PartnerRow> {
    const input = parse(RegisterDto, body);
    return this.registry.register(user.id, input.organizationId, input);
  }

  // ---- applications -------------------------------------------------------

  @Get('applications')
  @RequirePermission('partner.read')
  async listApplications(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<PartnerApplication[]> {
    const q = parse(OrgQueryDto, query);
    const rows = await this.registry.listApplications(
      user.id,
      q.organizationId,
    );
    return rows.map(toApplicationDto);
  }

  @Post('applications')
  @RequirePermission('partner.manage')
  async createApplication(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<{ application: PartnerApplication; client_secret: string }> {
    const input = parse(CreateApplicationDto, body);
    const result = await this.registry.createApplication(
      user.id,
      input.organizationId,
      input,
    );
    // The secret is returned exactly once. It is stored hashed; there is no
    // endpoint that can show it again, only rotation.
    return {
      application: toApplicationDto(result.application),
      client_secret: result.clientSecret,
    };
  }

  @Post('applications/:id/suspend')
  @RequirePermission('partner.manage')
  async suspend(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PartnerApplication> {
    // Full RevokeKeyDto: organizationId is REQUIRED so the service can verify
    // the application actually belongs to the org the caller administers.
    const input = parse(RevokeKeyDto, body);
    return toApplicationDto(
      await this.registry.suspendApplication(
        user.id,
        input.organizationId,
        id,
        input.reason,
      ),
    );
  }

  // ---- keys ---------------------------------------------------------------

  @Get('applications/:id/keys')
  @RequirePermission('partner.read')
  listKeys(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<PartnerApiKeySummary[]> {
    const q = parse(OrgQueryDto, query);
    return this.registry.listKeys(user.id, q.organizationId, id);
  }

  @Post('applications/:id/keys')
  @RequirePermission('partner.manage')
  createKey(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PartnerApiKeyIssued> {
    const input = parse(CreateKeyDto, body);
    return this.registry.createKey(user.id, input.organizationId, id, input);
  }

  @Post('applications/:id/keys/:keyId/rotate')
  @RequirePermission('partner.manage')
  rotateKey(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body() body: unknown,
  ): Promise<PartnerApiKeyIssued> {
    const input = parse(OrgQueryDto, body);
    return this.registry.rotateKey(user.id, input.organizationId, id, keyId);
  }

  @Delete('applications/:id/keys/:keyId')
  @RequirePermission('partner.manage')
  async revokeKey(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body() body: unknown,
  ): Promise<{ revoked: true }> {
    const input = parse(RevokeKeyDto, body);
    await this.registry.revokeKey(
      user.id,
      input.organizationId,
      id,
      keyId,
      input.reason,
    );
    return { revoked: true };
  }

  // ---- platform approval (VisaAI staff) -----------------------------------

  @Post(':partnerId/status')
  @RequirePermission('partner.approve')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('partnerId') partnerId: string,
    @Body() body: unknown,
  ): Promise<PartnerRow> {
    const input = parse(StatusDto, body);
    return this.registry.setStatus(
      user.id,
      partnerId,
      input.status,
      input.reason ?? null,
    );
  }

  @Post('applications/:id/approve')
  @RequirePermission('partner.approve')
  async approveApplication(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PartnerApplication> {
    const input = parse(ApproveDto, body);
    return toApplicationDto(
      await this.registry.approveApplication(user.id, id, input.scopes),
    );
  }

  // ---- the user's own consents --------------------------------------------
  // Under the portal controller for module cohesion, but permission-free:
  // these are about the caller's own data, so membership of anything is
  // irrelevant and requiring a partner permission would lock users out of
  // their own privacy controls.

  @Get('my-consents')
  myConsents(
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>[]> {
    return this.consent.listForUser(user.id);
  }

  @Delete('my-consents/:applicationId')
  revokeConsent(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ): Promise<{ revoked: boolean }> {
    return this.consent.revoke(user.id, applicationId);
  }
}
