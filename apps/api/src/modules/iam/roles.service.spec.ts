import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Role } from '@visaai/types';
import { RolesService } from './roles.service';
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

const ORG_ADMIN_ROLE: Role = {
  id: 'role-org-admin',
  key: 'org_admin',
  name: 'Organization Admin',
  description: null,
  scope: 'organization',
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
};

describe('RolesService', () => {
  describe('getAccess', () => {
    it('shapes repo access into UserAccess', async () => {
      const svc = new RolesService(
        makeRepo({
          getUserAccess: jest.fn().mockResolvedValue({
            roles: ['applicant'],
            permissions: ['profile.read'],
          }),
        }),
      );
      expect(await svc.getAccess('u1')).toEqual({
        user_id: 'u1',
        roles: ['applicant'],
        permissions: ['profile.read'],
      });
    });
  });

  describe('grant', () => {
    it('resolves the role, grants it, and audits', async () => {
      const grantRole = jest.fn().mockResolvedValue(undefined);
      const recordAuthEvent = jest.fn().mockResolvedValue(undefined);
      const svc = new RolesService(
        makeRepo({
          getRoleByKey: jest.fn().mockResolvedValue(ORG_ADMIN_ROLE),
          grantRole,
          recordAuthEvent,
        }),
      );
      const out = await svc.grant('admin-1', 'u1', 'org_admin', 'org-1');
      expect(out).toEqual({ granted: true, role: 'org_admin' });
      expect(grantRole).toHaveBeenCalledWith({
        userId: 'u1',
        roleId: 'role-org-admin',
        organizationId: 'org-1',
        grantedBy: 'admin-1',
      });
      expect(recordAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'role_granted' }),
      );
    });

    it('404s on unknown role', async () => {
      const svc = new RolesService(
        makeRepo({ getRoleByKey: jest.fn().mockResolvedValue(null) }),
      );
      await expect(
        svc.grant('admin-1', 'u1', 'org_admin'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revoke', () => {
    it('revokes and audits', async () => {
      const recordAuthEvent = jest.fn().mockResolvedValue(undefined);
      const svc = new RolesService(
        makeRepo({
          revokeRole: jest.fn().mockResolvedValue(true),
          recordAuthEvent,
        }),
      );
      expect(await svc.revoke('admin-1', 'u1', 'consultant')).toEqual({
        revoked: true,
        role: 'consultant',
      });
      expect(recordAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'role_revoked' }),
      );
    });

    it('404s when no grant matched', async () => {
      const svc = new RolesService(
        makeRepo({ revokeRole: jest.fn().mockResolvedValue(false) }),
      );
      await expect(
        svc.revoke('admin-1', 'u1', 'consultant'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revokes a platform_admin role when other admins remain', async () => {
      const revokeRole = jest.fn().mockResolvedValue(true);
      const svc = new RolesService(
        makeRepo({
          countPlatformAdmins: jest.fn().mockResolvedValue(2),
          revokeRole,
          recordAuthEvent: jest.fn().mockResolvedValue(undefined),
        }),
      );
      expect(await svc.revoke('admin-1', 'u2', 'platform_admin')).toEqual({
        revoked: true,
        role: 'platform_admin',
      });
      expect(revokeRole).toHaveBeenCalled();
    });

    it('blocks revoking the last platform admin (no orphan)', async () => {
      const revokeRole = jest.fn().mockResolvedValue(true);
      const svc = new RolesService(
        makeRepo({
          countPlatformAdmins: jest.fn().mockResolvedValue(1),
          revokeRole,
        }),
      );
      await expect(
        svc.revoke('admin-1', 'u2', 'platform_admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(revokeRole).not.toHaveBeenCalled();
    });

    it('blocks an admin demoting themselves', async () => {
      const revokeRole = jest.fn().mockResolvedValue(true);
      const svc = new RolesService(
        makeRepo({
          countPlatformAdmins: jest.fn().mockResolvedValue(3),
          revokeRole,
        }),
      );
      await expect(
        svc.revoke('admin-1', 'admin-1', 'super_admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(revokeRole).not.toHaveBeenCalled();
    });
  });
});
