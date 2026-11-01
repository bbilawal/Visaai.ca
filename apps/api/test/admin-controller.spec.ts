import { BadRequestException } from '@nestjs/common';
import { AdminController } from '../src/modules/admin/admin.controller';
import type { AdminService } from '../src/modules/admin/admin.service';
import type { AssignmentService } from '../src/modules/consultant/assignment.service';
import type { AuthUser } from '../src/modules/auth/jwt.guard';

const ADMIN: AuthUser = {
  id: 'admin-1',
  email: 'a@x',
  role: 'authenticated',
  appRole: 'admin',
};

function make() {
  const svc = {
    listUsers: jest
      .fn()
      .mockResolvedValue([{ id: 'u', email: 'e', appRole: 'user' }]),
    setRole: jest
      .fn()
      .mockResolvedValue({ id: 'u2', email: 'e2', appRole: 'consultant' }),
    recentAuditLogs: jest.fn().mockResolvedValue([]),
  };
  const assign = {
    listAllForAdmin: jest.fn().mockResolvedValue([]),
    adminAssign: jest.fn().mockResolvedValue({ id: 'asg-1' }),
    adminReassign: jest.fn().mockResolvedValue({ id: 'asg-2' }),
    unassign: jest.fn().mockResolvedValue(undefined),
    setDeadline: jest.fn().mockResolvedValue({ due_at: 'iso-hours' }),
    setDeadlineAt: jest.fn().mockResolvedValue({ due_at: 'iso-abs' }),
    getConsultantCountries: jest.fn().mockResolvedValue(['CA']),
    setConsultantCountries: jest.fn().mockResolvedValue(['CA', 'DE']),
  };
  const dashboard = { getDashboard: jest.fn().mockResolvedValue({}) };
  const adminUsers = {
    listUsers: jest
      .fn()
      // GoTrue pages: page 1 holds everyone, page 2 is empty.
      .mockImplementation(async ({ page }: { page: number }) =>
        page === 1
          ? { rows: [], total: 0 }
          : { data: { users: [] }, error: null },
      ),
    getUserDetail: jest.fn().mockResolvedValue({ id: 'u' }),
    suspend: jest.fn().mockResolvedValue({ id: 'u', status: 'suspended' }),
    reactivate: jest.fn().mockResolvedValue({ id: 'u', status: 'active' }),
    softDelete: jest.fn().mockResolvedValue({ id: 'u', status: 'deleted' }),
    restore: jest.fn().mockResolvedValue({ id: 'u', status: 'active' }),
    resetPassword: jest.fn().mockResolvedValue({ issued: true }),
  };
  return {
    ctrl: new AdminController(
      svc as unknown as AdminService,
      assign as unknown as AssignmentService,
      dashboard as never,
      adminUsers as never,
      {
        get: jest
          .fn()
          .mockResolvedValue({ reviews: { awaiting: 0, items: [] } }),
      } as never,
    ),
    svc,
    assign,
    adminUsers,
  };
}

describe('AdminController (delegation + DTO validation)', () => {
  it('GET users delegates to the paginated service with parsed defaults', async () => {
    const { ctrl, adminUsers } = make();
    await ctrl.users({});
    expect(adminUsers.listUsers).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      sort: 'createdAt',
      // REG-001: guests are anonymous funnel sessions, not accounts. "Users &
      // roles" shows registered users unless explicitly asked for them.
      includeGuests: false,
    });
  });

  it('GET users forwards the optional ?q + status filters', async () => {
    const { ctrl, adminUsers } = make();
    await ctrl.users({ q: 'alice', status: 'suspended' });
    expect(adminUsers.listUsers).toHaveBeenCalledWith({
      q: 'alice',
      status: 'suspended',
      page: 1,
      pageSize: 25,
      sort: 'createdAt',
      includeGuests: false,
    });
  });

  it('setRole forwards (id, role, actorId) for a valid role', async () => {
    const { ctrl, svc } = make();
    await ctrl.setRole('u2', { role: 'consultant' }, ADMIN);
    expect(svc.setRole).toHaveBeenCalledWith('u2', 'consultant', 'admin-1');
  });

  it('setRole rejects an invalid role (400, service untouched)', () => {
    const { ctrl, svc } = make();
    expect(() => ctrl.setRole('u2', { role: 'king' }, ADMIN)).toThrow(
      BadRequestException,
    );
    expect(svc.setRole).not.toHaveBeenCalled();
  });

  it('auditLogs passes applicationId + default limit', async () => {
    const { ctrl, svc } = make();
    await ctrl.auditLogs({});
    expect(svc.recentAuditLogs).toHaveBeenCalledWith(undefined, 100);
  });

  it('auditLogs rejects a non-uuid applicationId (400)', () => {
    const { ctrl } = make();
    expect(() => ctrl.auditLogs({ applicationId: 'not-a-uuid' })).toThrow(
      BadRequestException,
    );
  });

  // ---- deadline: hours (back-compat) vs absolute dueAt -----------------

  it('deadline with { hours } routes to setDeadline', () => {
    const { ctrl, assign } = make();
    ctrl.setDeadline('app-1', { hours: 12 }, ADMIN);
    expect(assign.setDeadline).toHaveBeenCalledWith('app-1', 12, 'admin-1');
    expect(assign.setDeadlineAt).not.toHaveBeenCalled();
  });

  it('deadline with { dueAt } routes to setDeadlineAt', () => {
    const { ctrl, assign } = make();
    const dueAt = '2026-12-01T00:00:00.000Z';
    ctrl.setDeadline('app-1', { dueAt }, ADMIN);
    expect(assign.setDeadlineAt).toHaveBeenCalledWith(
      'app-1',
      dueAt,
      'admin-1',
    );
    expect(assign.setDeadline).not.toHaveBeenCalled();
  });

  it('deadline rejects supplying BOTH hours and dueAt (400)', () => {
    const { ctrl } = make();
    expect(() =>
      ctrl.setDeadline(
        'app-1',
        { hours: 12, dueAt: '2026-12-01T00:00:00.000Z' },
        ADMIN,
      ),
    ).toThrow(BadRequestException);
  });

  it('deadline rejects supplying NEITHER hours nor dueAt (400)', () => {
    const { ctrl } = make();
    expect(() => ctrl.setDeadline('app-1', {}, ADMIN)).toThrow(
      BadRequestException,
    );
  });

  // ---- consultant country mapping --------------------------------------

  it('GET countries returns the active codes', async () => {
    const { ctrl, assign } = make();
    const res = await ctrl.getCountries('c-1');
    expect(assign.getConsultantCountries).toHaveBeenCalledWith('c-1');
    expect(res).toEqual({ codes: ['CA'] });
  });

  it('PUT countries dedupes + uppercases codes and returns the result', async () => {
    const { ctrl, assign } = make();
    const res = await ctrl.setCountries('c-1', { codes: ['ca', 'de', 'CA'] });
    expect(assign.setConsultantCountries).toHaveBeenCalledWith('c-1', [
      'CA',
      'DE',
    ]);
    expect(res).toEqual({ codes: ['CA', 'DE'] });
  });

  it('PUT countries rejects a non-array body (400)', async () => {
    const { ctrl, assign } = make();
    await expect(
      ctrl.setCountries('c-1', { codes: 'CA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assign.setConsultantCountries).not.toHaveBeenCalled();
  });
});
