import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Organization, OrganizationMember, Role } from '@visaai/types';
import { OrganizationsService, type OrgCaller } from './organizations.service';
import type { EmailService } from '../shared/email/email.service';
import type { IIamRepository } from './iam.repository';

function makeRepo(over: Partial<IIamRepository> = {}): IIamRepository {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected repo call: ${n}`);
  };
  return new Proxy(over as IIamRepository, {
    get(target, prop: string) {
      return prop in target
        ? (target as unknown as Record<string, unknown>)[prop]
        : notImpl(prop);
    },
  });
}

const config = new ConfigService({ WEB_URL: 'https://app.visaai.test' });
const sendMock = jest.fn().mockResolvedValue(true);
const email = { send: sendMock } as unknown as EmailService;

const ORG_ADMIN_ROLE: Role = {
  id: 'role-oa',
  key: 'org_admin',
  name: 'Org Admin',
  description: null,
  scope: 'organization',
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
};

const ORG: Organization = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  owner_user_id: 'u1',
  plan: 'free',
  settings: {},
  created_at: '2026-06-28T00:00:00Z',
  updated_at: '2026-06-28T00:00:00Z',
};

const applicant: OrgCaller = { id: 'u1', email: 'u1@test.co', appRole: 'user' };
const outsider: OrgCaller = { id: 'u9', email: 'u9@test.co', appRole: 'user' };
const platformAdmin: OrgCaller = {
  id: 'a1',
  email: 'a@test.co',
  appRole: 'admin',
};

const adminMember: OrganizationMember = {
  id: 'm1',
  organization_id: 'org-1',
  user_id: 'u1',
  role: 'org_admin',
  status: 'active',
  joined_at: '2026-06-28T00:00:00Z',
};

describe('OrganizationsService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates org, adds owner as org_admin member + role, audits', async () => {
      const addMember = jest.fn().mockResolvedValue(adminMember);
      const grantRole = jest.fn().mockResolvedValue(undefined);
      const svc = new OrganizationsService(
        makeRepo({
          slugExists: jest.fn().mockResolvedValue(false),
          createOrganization: jest.fn().mockResolvedValue(ORG),
          addMember,
          getRoleByKey: jest.fn().mockResolvedValue(ORG_ADMIN_ROLE),
          grantRole,
          recordAuthEvent: jest.fn().mockResolvedValue(undefined),
        }),
        config,
        email,
      );
      const org = await svc.create(applicant, 'Acme');
      expect(org).toEqual(ORG);
      expect(addMember).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', role: 'org_admin' }),
      );
      expect(grantRole).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1' }),
      );
    });

    it('rejects empty name', async () => {
      const svc = new OrganizationsService(makeRepo(), config, email);
      await expect(svc.create(applicant, '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('get (authz)', () => {
    it('returns org for an active member', async () => {
      const svc = new OrganizationsService(
        makeRepo({
          getOrganization: jest.fn().mockResolvedValue(ORG),
          getMember: jest.fn().mockResolvedValue(adminMember),
        }),
        config,
        email,
      );
      expect(await svc.get(applicant, 'org-1')).toEqual(ORG);
    });

    it('forbids a non-member', async () => {
      const svc = new OrganizationsService(
        makeRepo({
          getOrganization: jest.fn().mockResolvedValue(ORG),
          getMember: jest.fn().mockResolvedValue(null),
        }),
        config,
        email,
      );
      await expect(svc.get(outsider, 'org-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('platform admin bypasses membership', async () => {
      const svc = new OrganizationsService(
        makeRepo({ getOrganization: jest.fn().mockResolvedValue(ORG) }),
        config,
        email,
      );
      expect(await svc.get(platformAdmin, 'org-1')).toEqual(ORG);
    });
  });

  describe('invite', () => {
    it('org_admin invites: creates invitation + sends email', async () => {
      const createInvitation = jest.fn().mockResolvedValue({
        id: 'inv-1',
        organization_id: 'org-1',
        email: 'new@test.co',
        role: 'member',
        token: 'tok',
        invited_by: 'u1',
        status: 'pending',
        expires_at: '2026-07-05T00:00:00Z',
        created_at: '2026-06-28T00:00:00Z',
        accepted_at: null,
      });
      const svc = new OrganizationsService(
        makeRepo({
          getMember: jest.fn().mockResolvedValue(adminMember),
          createInvitation,
          recordAuthEvent: jest.fn().mockResolvedValue(undefined),
        }),
        config,
        email,
      );
      const inv = await svc.invite(applicant, 'org-1', 'new@test.co', 'member');
      expect(inv.id).toBe('inv-1');
      expect(createInvitation).toHaveBeenCalled();
      expect(sendMock).toHaveBeenCalledWith(
        'new@test.co',
        expect.any(String),
        expect.stringContaining('tok'),
      );
    });

    it('forbids a non-admin member', async () => {
      const svc = new OrganizationsService(
        makeRepo({
          getMember: jest
            .fn()
            .mockResolvedValue({ ...adminMember, role: 'member' }),
        }),
        config,
        email,
      );
      await expect(
        svc.invite(applicant, 'org-1', 'x@test.co', 'member'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('acceptInvitation', () => {
    const pendingInvite = {
      id: 'inv-1',
      organization_id: 'org-1',
      email: 'new@test.co',
      role: 'member' as const,
      token: 'tok',
      invited_by: 'u1',
      status: 'pending' as const,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_at: '2026-06-28T00:00:00Z',
      accepted_at: null,
    };

    it('accepts a valid invite for the matching email', async () => {
      const addMember = jest.fn().mockResolvedValue(adminMember);
      const setInvitationStatus = jest.fn().mockResolvedValue(true);
      const svc = new OrganizationsService(
        makeRepo({
          getInvitationByToken: jest.fn().mockResolvedValue(pendingInvite),
          addMember,
          setInvitationStatus,
          recordAuthEvent: jest.fn().mockResolvedValue(undefined),
        }),
        config,
        email,
      );
      const out = await svc.acceptInvitation(
        { id: 'u2', email: 'new@test.co' },
        'tok',
      );
      expect(out).toEqual({ accepted: true, organization_id: 'org-1' });
      expect(addMember).toHaveBeenCalled();
      expect(setInvitationStatus).toHaveBeenCalledWith(
        'inv-1',
        'org-1',
        'accepted',
        expect.any(String),
      );
    });

    it('forbids accepting with a different email', async () => {
      const svc = new OrganizationsService(
        makeRepo({
          getInvitationByToken: jest.fn().mockResolvedValue(pendingInvite),
        }),
        config,
        email,
      );
      await expect(
        svc.acceptInvitation({ id: 'u2', email: 'other@test.co' }, 'tok'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an invalid/expired token', async () => {
      const svc = new OrganizationsService(
        makeRepo({
          getInvitationByToken: jest.fn().mockResolvedValue(null),
        }),
        config,
        email,
      );
      await expect(
        svc.acceptInvitation({ id: 'u2', email: 'new@test.co' }, 'bad'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

/**
 * Cross-organization invitation revocation.
 *
 * `revokeInvitation` correctly asserts the caller administers `orgId`, but the
 * repository then updated `organization_invitations` filtered by invitation id
 * ALONE — so the admin check proved nothing about the row actually written. An
 * admin of an organization they legitimately own could revoke a pending
 * invitation belonging to a different organization by naming its UUID.
 *
 * Its siblings removeMember/updateMember were already double-scoped; this one
 * was not.
 */
describe('revokeInvitation scoping', () => {
  it('passes the organization id to the repository, not just the invitation id', async () => {
    const setInvitationStatus = jest.fn().mockResolvedValue(true);
    const svc = new OrganizationsService(
      makeRepo({
        getMember: jest.fn().mockResolvedValue(adminMember),
        setInvitationStatus,
      }),
      config,
      email,
    );

    await svc.revokeInvitation(
      { id: 'u1', email: 'admin@test.co' },
      'org-1',
      'inv-1',
    );

    expect(setInvitationStatus).toHaveBeenCalledWith(
      'inv-1',
      'org-1',
      'revoked',
    );
  });
});
