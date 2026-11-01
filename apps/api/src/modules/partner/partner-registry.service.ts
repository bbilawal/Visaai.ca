import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PartnerApiKeyIssued,
  PartnerApiKeySummary,
  PartnerApplication,
  PartnerEnvironment,
  PartnerScope,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  generateApiKey,
  generateClientId,
  generateClientSecret,
  rotationGraceExpiry,
} from './partner-credentials';
import {
  isSubset,
  normalizeScopes,
  scopesGrantableWithoutApproval,
} from './partner-scopes';
import {
  PARTNER_CONFIG,
  PARTNER_DEFAULTS,
  PARTNER_REPOSITORY,
} from './partner.tokens';
import type {
  IPartnerRepository,
  PartnerApiKeyRow,
  PartnerApplicationRow,
  PartnerRow,
} from './partner.repository';

/**
 * Partner registration and credential lifecycle — the operations the Partner
 * Portal performs on behalf of a signed-in org member.
 *
 * Every method takes the acting user and re-derives their organization from
 * the database. Nothing here trusts an organization id from the request: that
 * is the single parameter an attacker would tamper with to reach another
 * tenant's credentials.
 */
@Injectable()
export class PartnerRegistryService {
  private readonly log = new Logger(PartnerRegistryService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  // ---- registration ----------------------------------------------------

  /**
   * Register the caller's organization as a partner. Starts `pending`:
   * sandbox is available immediately, live is not.
   */
  async register(
    actingUserId: string,
    organizationId: string,
    input: { legalName: string; contactEmail: string; website?: string },
  ): Promise<PartnerRow> {
    await this.assertOrgAdmin(actingUserId, organizationId);

    const existing = await this.repo.getPartnerByOrganization(
      this.db,
      organizationId,
    );
    if (existing) {
      throw new BadRequestException(
        'This organization is already registered as a partner.',
      );
    }

    const partner = await this.repo.createPartner(this.db, {
      organization_id: organizationId,
      legal_name: input.legalName,
      contact_email: input.contactEmail,
      website: input.website ?? null,
      status: 'pending',
      tier: 'standard',
    });

    await this.recordAudit(actingUserId, 'partner.registered', {
      partner_id: partner.id,
      organization_id: organizationId,
    });
    return partner;
  }

  async getForOrganization(
    actingUserId: string,
    organizationId: string,
  ): Promise<PartnerRow | null> {
    await this.assertOrgMember(actingUserId, organizationId);
    return this.repo.getPartnerByOrganization(this.db, organizationId);
  }

  /** Platform-side approval. Guarded by `partner.approve` at the controller. */
  async setStatus(
    actingUserId: string,
    partnerId: string,
    status: PartnerRow['status'],
    reason: string | null,
  ): Promise<PartnerRow> {
    const partner = await this.repo.getPartner(this.db, partnerId);
    if (!partner) throw new NotFoundException('Partner not found');

    const updated = await this.repo.updatePartnerStatus(
      this.db,
      partnerId,
      status,
      reason,
      actingUserId,
    );

    // Suspension must take effect NOW, not when tokens happen to expire.
    if (status === 'suspended' || status === 'rejected') {
      const applications = await this.repo.listApplications(this.db, partnerId);
      for (const app of applications) {
        await this.repo.revokeTokensForApplication(
          this.db,
          app.id,
          new Date().toISOString(),
        );
      }
    }

    await this.recordAudit(actingUserId, 'partner.status_changed', {
      partner_id: partnerId,
      status,
    });
    return updated;
  }

  // ---- applications -----------------------------------------------------

  async listApplications(
    actingUserId: string,
    organizationId: string,
  ): Promise<PartnerApplicationRow[]> {
    const partner = await this.requirePartner(actingUserId, organizationId);
    return this.repo.listApplications(this.db, partner.id);
  }

  /**
   * Create an OAuth client. Returns the client secret exactly once — it is
   * stored hashed and cannot be shown again.
   */
  async createApplication(
    actingUserId: string,
    organizationId: string,
    input: {
      name: string;
      description?: string;
      environment: PartnerEnvironment;
      scopes: string[];
      grantTypes?: string[];
      redirectUris?: string[];
      ipAllowlist?: string[];
    },
  ): Promise<{ application: PartnerApplicationRow; clientSecret: string }> {
    const partner = await this.requirePartnerAsAdmin(
      actingUserId,
      organizationId,
    );

    if (input.environment === 'live' && partner.status !== 'approved') {
      throw new ForbiddenException(
        'Your partner account must be approved before you can create a live application.',
      );
    }

    const requested = normalizeScopes(input.scopes);
    const grantTypes = input.grantTypes?.length
      ? input.grantTypes
      : ['client_credentials'];
    const redirectUris = input.redirectUris ?? [];

    if (
      grantTypes.includes('authorization_code') &&
      redirectUris.length === 0
    ) {
      throw new BadRequestException(
        'The authorization_code grant requires at least one redirect URI.',
      );
    }
    for (const uri of redirectUris) assertRedirectUri(uri, input.environment);

    // Scopes needing review are REQUESTED, not granted. The application is
    // created either way so the partner can start integrating in sandbox.
    const selfService = scopesGrantableWithoutApproval(
      requested,
      input.environment,
    );
    const granted = selfService ? requested : [];

    const secret = generateClientSecret();
    const application = await this.repo.createApplication(this.db, {
      partner_id: partner.id,
      name: input.name,
      description: input.description ?? null,
      environment: input.environment,
      client_id: generateClientId(input.environment),
      client_secret_hash: secret.hash,
      client_type: 'confidential',
      status: selfService ? 'active' : 'pending_review',
      scopes: granted,
      requested_scopes: requested,
      grant_types: grantTypes,
      redirect_uris: redirectUris,
      ip_allowlist: input.ipAllowlist ?? [],
      created_by: actingUserId,
    });

    await this.recordAudit(actingUserId, 'partner.application_created', {
      application_id: application.id,
      environment: input.environment,
      requested_scopes: requested,
      granted_scopes: granted,
    });

    return { application, clientSecret: secret.token };
  }

  /** Platform-side scope approval. */
  async approveApplication(
    actingUserId: string,
    applicationId: string,
    scopes: string[],
  ): Promise<PartnerApplicationRow> {
    const application = await this.repo.getApplication(this.db, applicationId);
    if (!application) throw new NotFoundException('Application not found');

    const granted = normalizeScopes(scopes);
    // An approver can narrow what was asked for, never widen it — approving
    // something the partner never requested is how scope creep becomes a
    // breach.
    if (!isSubset(granted, application.requested_scopes)) {
      throw new BadRequestException(
        'Granted scopes must be a subset of the scopes the partner requested.',
      );
    }

    const updated = await this.repo.updateApplication(this.db, applicationId, {
      scopes: granted,
      status: 'active',
      approved_at: new Date().toISOString(),
      approved_by: actingUserId,
    } as Partial<PartnerApplicationRow>);

    await this.recordAudit(actingUserId, 'partner.application_approved', {
      application_id: applicationId,
      granted_scopes: granted,
    });
    return updated;
  }

  async suspendApplication(
    actingUserId: string,
    organizationId: string,
    applicationId: string,
    reason: string,
  ): Promise<PartnerApplicationRow> {
    // Tenancy check, exactly as createKey/rotateKey/revokeKey do. Without it
    // this was the one write in the module keyed on the application id alone:
    // `partner.manage` is granted to org_admin platform-wide and organizations
    // are self-serve, so any user could create an org, inherit the permission,
    // and suspend an UNRELATED organization's partner application by UUID —
    // revoking that org's live production API tokens on the spot.
    await this.requireApplicationAsAdmin(
      actingUserId,
      organizationId,
      applicationId,
    );

    const updated = await this.repo.updateApplication(this.db, applicationId, {
      status: 'suspended',
      status_reason: reason,
    });
    // Suspension revokes live tokens immediately; a suspended application that
    // keeps serving requests for an hour is not suspended.
    await this.repo.revokeTokensForApplication(
      this.db,
      applicationId,
      new Date().toISOString(),
    );
    await this.recordAudit(actingUserId, 'partner.application_suspended', {
      application_id: applicationId,
    });
    return updated;
  }

  // ---- API keys ---------------------------------------------------------

  async listKeys(
    actingUserId: string,
    organizationId: string,
    applicationId: string,
  ): Promise<PartnerApiKeySummary[]> {
    await this.requireApplication(actingUserId, organizationId, applicationId);
    const rows = await this.repo.listApiKeys(this.db, applicationId);
    return rows.map(toKeySummary);
  }

  async createKey(
    actingUserId: string,
    organizationId: string,
    applicationId: string,
    input: { name: string; scopes?: string[]; expiresAt?: string },
  ): Promise<PartnerApiKeyIssued> {
    const { application } = await this.requireApplicationAsAdmin(
      actingUserId,
      organizationId,
      applicationId,
    );

    // A key can only ever hold a subset of its application's scopes.
    const scopes = input.scopes?.length
      ? normalizeScopes(input.scopes).filter((s) =>
          application.scopes.includes(s),
        )
      : application.scopes;
    if (scopes.length === 0) {
      throw new BadRequestException(
        'This application holds no granted scopes, so a key would be useless. Request scopes first.',
      );
    }

    const generated = generateApiKey(application.environment);
    const row = await this.repo.createApiKey(this.db, {
      application_id: applicationId,
      name: input.name,
      prefix: generated.prefix,
      key_hash: generated.hash,
      last_four: generated.lastFour,
      scopes,
      status: 'active',
      expires_at: input.expiresAt ?? null,
      created_by: actingUserId,
    });

    await this.recordAudit(actingUserId, 'partner.key_created', {
      application_id: applicationId,
      key_id: row.id,
      prefix: generated.prefix,
      scopes,
    });

    return {
      id: row.id,
      name: row.name,
      key: generated.key,
      prefix: generated.prefix,
      last_four: generated.lastFour,
      scopes,
      expires_at: row.expires_at,
    };
  }

  /**
   * Rotate: issue a replacement and put the old key into a grace window rather
   * than killing it. A rotation that causes an outage is a rotation nobody
   * performs, and unrotated keys are the actual risk.
   */
  async rotateKey(
    actingUserId: string,
    organizationId: string,
    applicationId: string,
    keyId: string,
  ): Promise<PartnerApiKeyIssued> {
    const { application } = await this.requireApplicationAsAdmin(
      actingUserId,
      organizationId,
      applicationId,
    );
    const existing = await this.repo.getApiKey(this.db, keyId);
    if (!existing || existing.application_id !== applicationId) {
      throw new NotFoundException('API key not found');
    }
    if (existing.status === 'revoked') {
      throw new BadRequestException(
        'This key has been revoked and cannot be rotated.',
      );
    }

    const graceHours =
      this.config.get<number>(PARTNER_CONFIG.keyRotationGraceHours) ??
      PARTNER_DEFAULTS.keyRotationGraceHours;

    const generated = generateApiKey(application.environment);
    const replacement = await this.repo.createApiKey(this.db, {
      application_id: applicationId,
      name: existing.name,
      prefix: generated.prefix,
      key_hash: generated.hash,
      last_four: generated.lastFour,
      scopes: existing.scopes,
      status: 'active',
      expires_at: existing.expires_at,
      rotated_from: existing.id,
      created_by: actingUserId,
    });

    await this.repo.updateApiKey(this.db, existing.id, {
      status: 'rotating',
      expires_at: rotationGraceExpiry(new Date(), graceHours),
    });

    await this.recordAudit(actingUserId, 'partner.key_rotated', {
      application_id: applicationId,
      old_key_id: existing.id,
      new_key_id: replacement.id,
      grace_hours: graceHours,
    });

    return {
      id: replacement.id,
      name: replacement.name,
      key: generated.key,
      prefix: generated.prefix,
      last_four: generated.lastFour,
      scopes: replacement.scopes,
      expires_at: replacement.expires_at,
    };
  }

  async revokeKey(
    actingUserId: string,
    organizationId: string,
    applicationId: string,
    keyId: string,
    reason: string,
  ): Promise<void> {
    await this.requireApplicationAsAdmin(
      actingUserId,
      organizationId,
      applicationId,
    );
    const existing = await this.repo.getApiKey(this.db, keyId);
    if (!existing || existing.application_id !== applicationId) {
      throw new NotFoundException('API key not found');
    }
    await this.repo.updateApiKey(this.db, keyId, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
    });
    await this.recordAudit(actingUserId, 'partner.key_revoked', {
      application_id: applicationId,
      key_id: keyId,
    });
  }

  // ---- tenancy checks ----------------------------------------------------

  /**
   * The tenant boundary for every portal operation. Membership is read from
   * the database for the ACTING user; the request cannot assert it.
   */
  private async assertOrgMember(
    userId: string,
    organizationId: string,
  ): Promise<{ role: string }> {
    const res = await this.db
      .from('organization_members')
      .select('role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    const row = res.data as { role: string } | null;
    if (!row) {
      throw new ForbiddenException(
        'You are not a member of this organization.',
      );
    }
    return row;
  }

  private async assertOrgAdmin(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const { role } = await this.assertOrgMember(userId, organizationId);
    if (role !== 'org_admin') {
      throw new ForbiddenException(
        'Only an organization administrator can manage partner credentials.',
      );
    }
  }

  private async requirePartner(
    userId: string,
    organizationId: string,
  ): Promise<PartnerRow> {
    await this.assertOrgMember(userId, organizationId);
    const partner = await this.repo.getPartnerByOrganization(
      this.db,
      organizationId,
    );
    if (!partner)
      throw new NotFoundException('This organization is not a partner.');
    return partner;
  }

  private async requirePartnerAsAdmin(
    userId: string,
    organizationId: string,
  ): Promise<PartnerRow> {
    await this.assertOrgAdmin(userId, organizationId);
    const partner = await this.repo.getPartnerByOrganization(
      this.db,
      organizationId,
    );
    if (!partner)
      throw new NotFoundException('This organization is not a partner.');
    return partner;
  }

  /**
   * Resolve an application AND prove it belongs to the caller's organization.
   * A bare `getApplication(id)` would be an IDOR: any org member could read
   * any partner's credentials by guessing a uuid.
   */
  async requireApplication(
    userId: string,
    organizationId: string,
    applicationId: string,
  ): Promise<{ partner: PartnerRow; application: PartnerApplicationRow }> {
    const partner = await this.requirePartner(userId, organizationId);
    const application = await this.repo.getApplication(this.db, applicationId);
    if (!application || application.partner_id !== partner.id) {
      throw new NotFoundException('Application not found');
    }
    return { partner, application };
  }

  private async requireApplicationAsAdmin(
    userId: string,
    organizationId: string,
    applicationId: string,
  ): Promise<{ partner: PartnerRow; application: PartnerApplicationRow }> {
    const partner = await this.requirePartnerAsAdmin(userId, organizationId);
    const application = await this.repo.getApplication(this.db, applicationId);
    if (!application || application.partner_id !== partner.id) {
      throw new NotFoundException('Application not found');
    }
    return { partner, application };
  }

  /**
   * Partner administrative actions are audited to `auth_audit_log` — the same
   * free-form actor/event log the IAM and admin modules already use.
   *
   * NOT the hash-chained AuditService: that chain is keyed per APPLICATION
   * (an immigration case) with a closed event vocabulary, and partner
   * credential management belongs to neither. Forcing it in would corrupt the
   * meaning of a per-case evidence chain.
   *
   * Failure to audit is logged but does not fail the action: a partner must
   * still be able to revoke a leaked key when the audit table is unavailable.
   */
  private async recordAudit(
    actorId: string,
    event: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      const res = await this.db.from('auth_audit_log').insert({
        user_id: actorId,
        actor_id: actorId,
        event_type: event,
        metadata,
      });
      if (res.error) throw new Error(res.error.message);
    } catch (err) {
      this.log.warn(
        `partner audit append failed for ${event}: ${(err as Error).message}`,
      );
    }
  }
}

function toKeySummary(row: PartnerApiKeyRow): PartnerApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    last_four: row.last_four,
    scopes: row.scopes,
    status: row.status,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  };
}

export function toApplicationDto(
  row: PartnerApplicationRow,
): PartnerApplication {
  return {
    id: row.id,
    partner_id: row.partner_id,
    name: row.name,
    description: row.description,
    environment: row.environment,
    client_id: row.client_id,
    client_type: row.client_type,
    status: row.status,
    scopes: row.scopes,
    requested_scopes: row.requested_scopes,
    grant_types: row.grant_types as PartnerApplication['grant_types'],
    redirect_uris: row.redirect_uris,
    ip_allowlist: row.ip_allowlist,
    created_at: row.created_at,
  };
}

/**
 * Redirect URIs must be absolute HTTPS. `http://localhost` is allowed in
 * sandbox only — developers need it, production integrations do not, and an
 * http redirect in live is a token handed over in cleartext.
 */
function assertRedirectUri(uri: string, environment: PartnerEnvironment): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new BadRequestException(`Redirect URI is not a valid URL: ${uri}`);
  }
  if (parsed.hash) {
    throw new BadRequestException('Redirect URIs must not contain a fragment.');
  }
  if (parsed.protocol === 'https:') return;
  const isLocalhost =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (environment === 'sandbox' && parsed.protocol === 'http:' && isLocalhost) {
    return;
  }
  throw new BadRequestException(
    'Redirect URIs must use https (http://localhost is permitted in sandbox only).',
  );
}

export type { PartnerScope };
