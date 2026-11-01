import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  OrgMemberRole,
} from '@visaai/types';
import type { Env } from '../../config/configuration';
import { EmailService } from '../shared/email/email.service';
import {
  generateInviteToken,
  invitationExpiry,
  isInvitationAcceptable,
  slugify,
} from './iam.engine';
import { IAM_REPOSITORY, type IIamRepository } from './iam.repository';

export interface OrgCaller {
  id: string;
  email: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

/**
 * OrganizationsService — orgs, team membership, and invitations. Org-scoped
 * authorization is enforced here (platform admin OR an active org_admin/member of
 * the specific org) since global PermissionsGuard can't know which org a request
 * targets. All writes go service-role through the repo.
 */
@Injectable()
export class OrganizationsService {
  private readonly log = new Logger(OrganizationsService.name);

  constructor(
    @Inject(IAM_REPOSITORY) private readonly repo: IIamRepository,
    private readonly config: ConfigService<Env>,
    private readonly email: EmailService,
  ) {}

  // ---- orgs ----
  async create(caller: OrgCaller, name: string): Promise<Organization> {
    const clean = name?.trim();
    if (!clean) throw new BadRequestException('Organization name required');

    const slug = await this.uniqueSlug(slugify(clean));
    const org = await this.repo.createOrganization({
      name: clean,
      slug,
      ownerUserId: caller.id,
    });
    // Owner becomes an active org_admin member + holds the org-scoped org_admin role.
    await this.repo.addMember({
      organizationId: org.id,
      userId: caller.id,
      role: 'org_admin',
      status: 'active',
    });
    const orgAdminRole = await this.repo.getRoleByKey('org_admin');
    if (orgAdminRole) {
      await this.repo.grantRole({
        userId: caller.id,
        roleId: orgAdminRole.id,
        organizationId: org.id,
        grantedBy: caller.id,
      });
    }
    await this.repo.recordAuthEvent({
      userId: caller.id,
      actorId: caller.id,
      eventType: 'org_created',
      metadata: { organization_id: org.id, slug },
    });
    this.log.log(`org created: ${org.id} (${slug}) by ${caller.id}`);
    return org;
  }

  listMine(caller: OrgCaller): Promise<Organization[]> {
    return this.repo.listOrganizationsForUser(caller.id);
  }

  async get(caller: OrgCaller, orgId: string): Promise<Organization> {
    const org = await this.repo.getOrganization(orgId);
    if (!org) throw new NotFoundException('Organization not found');
    await this.assertMember(caller, orgId);
    return org;
  }

  async update(
    caller: OrgCaller,
    orgId: string,
    // SEC-3004: `plan` is excluded from the self-service update path.
    patch: Partial<Pick<Organization, 'name' | 'settings'>>,
  ): Promise<Organization> {
    await this.assertAdmin(caller, orgId);
    const org = await this.repo.updateOrganization(orgId, patch);
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  // ---- members ----
  async listMembers(
    caller: OrgCaller,
    orgId: string,
  ): Promise<OrganizationMember[]> {
    await this.assertMember(caller, orgId);
    return this.repo.listMembers(orgId);
  }

  async updateMemberRole(
    caller: OrgCaller,
    orgId: string,
    targetUserId: string,
    patch: { role?: OrgMemberRole; status?: 'active' | 'suspended' },
  ): Promise<{ updated: true }> {
    await this.assertAdmin(caller, orgId);
    const ok = await this.repo.updateMember(orgId, targetUserId, patch);
    if (!ok) throw new NotFoundException('Member not found');
    return { updated: true };
  }

  async removeMember(
    caller: OrgCaller,
    orgId: string,
    targetUserId: string,
  ): Promise<{ removed: true }> {
    await this.assertAdmin(caller, orgId);
    const org = await this.repo.getOrganization(orgId);
    if (org && org.owner_user_id === targetUserId) {
      throw new BadRequestException('Cannot remove the organization owner');
    }
    const ok = await this.repo.removeMember(orgId, targetUserId);
    if (!ok) throw new NotFoundException('Member not found');
    await this.repo.recordAuthEvent({
      userId: targetUserId,
      actorId: caller.id,
      eventType: 'org_member_removed',
      metadata: { organization_id: orgId },
    });
    return { removed: true };
  }

  // ---- invitations ----
  async invite(
    caller: OrgCaller,
    orgId: string,
    email: string,
    role: OrgMemberRole,
    now = new Date(),
  ): Promise<OrganizationInvitation> {
    await this.assertAdmin(caller, orgId);
    const clean = email?.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      throw new BadRequestException('Valid email required');
    }
    const inv = await this.repo.createInvitation({
      organizationId: orgId,
      email: clean,
      role,
      token: generateInviteToken(),
      invitedBy: caller.id,
      expiresAt: invitationExpiry(now),
    });
    await this.repo.recordAuthEvent({
      userId: null,
      actorId: caller.id,
      eventType: 'org_invitation_sent',
      metadata: { organization_id: orgId, email: clean, role },
    });
    await this.sendInviteEmail(inv);
    return inv;
  }

  listInvitations(
    caller: OrgCaller,
    orgId: string,
  ): Promise<OrganizationInvitation[]> {
    return this.assertAdmin(caller, orgId).then(() =>
      this.repo.listInvitations(orgId),
    );
  }

  async revokeInvitation(
    caller: OrgCaller,
    orgId: string,
    invitationId: string,
  ): Promise<{ revoked: true }> {
    await this.assertAdmin(caller, orgId);
    const ok = await this.repo.setInvitationStatus(
      invitationId,
      orgId,
      'revoked',
    );
    if (!ok) throw new NotFoundException('Invitation not found');
    return { revoked: true };
  }

  async acceptInvitation(
    caller: OrgCaller,
    token: string,
    now = new Date(),
  ): Promise<{ accepted: true; organization_id: string }> {
    const inv = await this.repo.getInvitationByToken(token);
    if (!isInvitationAcceptable(inv, now) || !inv) {
      throw new BadRequestException('Invitation invalid or expired');
    }
    if (inv.email.toLowerCase() !== caller.email.toLowerCase()) {
      throw new ForbiddenException(
        'Invitation was issued to a different email',
      );
    }
    await this.repo.addMember({
      organizationId: inv.organization_id,
      userId: caller.id,
      role: inv.role,
      status: 'active',
    });
    if (inv.role === 'org_admin') {
      const r = await this.repo.getRoleByKey('org_admin');
      if (r) {
        await this.repo.grantRole({
          userId: caller.id,
          roleId: r.id,
          organizationId: inv.organization_id,
          grantedBy: inv.invited_by,
        });
      }
    }
    await this.repo.setInvitationStatus(
      inv.id,
      inv.organization_id,
      'accepted',
      now.toISOString(),
    );
    await this.repo.recordAuthEvent({
      userId: caller.id,
      actorId: caller.id,
      eventType: 'org_invitation_accepted',
      metadata: { organization_id: inv.organization_id },
    });
    return { accepted: true, organization_id: inv.organization_id };
  }

  // ---- authorization helpers ----

  /** Platform admin OR an active member of the org. */
  private async assertMember(caller: OrgCaller, orgId: string): Promise<void> {
    if (caller.appRole === 'admin') return;
    const m = await this.repo.getMember(orgId, caller.id);
    if (!m || m.status !== 'active') {
      throw new ForbiddenException('Not a member of this organization');
    }
  }

  /** Platform admin OR an active org_admin of the org. */
  private async assertAdmin(caller: OrgCaller, orgId: string): Promise<void> {
    if (caller.appRole === 'admin') return;
    const m = await this.repo.getMember(orgId, caller.id);
    if (!m || m.status !== 'active' || m.role !== 'org_admin') {
      throw new ForbiddenException('Requires organization admin');
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    if (!(await this.repo.slugExists(base))) return base;
    for (let i = 2; i < 50; i++) {
      const candidate = `${base}-${i}`;
      if (!(await this.repo.slugExists(candidate))) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private async sendInviteEmail(inv: OrganizationInvitation): Promise<void> {
    const webUrl = this.config.get('WEB_URL', { infer: true }) ?? '';
    const link = `${webUrl}/invite/accept?token=${inv.token}`;
    await this.email
      .send(
        inv.email,
        'You have been invited to a VisaAI organization',
        `<p>You've been invited to join an organization on VisaAI as <strong>${inv.role}</strong>.</p>
         <p><a href="${link}">Accept the invitation</a> (expires in 7 days).</p>`,
      )
      .catch((e) =>
        this.log.error(`invite email failed: ${(e as Error).message}`),
      );
  }
}
