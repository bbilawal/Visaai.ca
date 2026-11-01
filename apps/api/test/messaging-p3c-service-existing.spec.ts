import { ConflictException } from '@nestjs/common';
import { AssignmentService } from '../src/modules/consultant/assignment.service';

const app = { id: 'app', user_id: 'owner', destination_country: 'CA' };
function deps(over: Record<string, unknown> = {}) {
  const repo = {
    getApplicationMeta: jest.fn().mockResolvedValue(app),
    getConsultantCountries: jest.fn().mockResolvedValue(['CA']),
    getActivePrimary: jest.fn().mockResolvedValue(null),
    insertAssignment: jest
      .fn()
      .mockResolvedValue({ id: 'a1', role: 'primary', consultant_id: 'c1' }),
    releaseAssignment: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const bus = { emit: jest.fn() };
  return { repo, audit, bus };
}

describe('AssignmentService existing mutations (role-aware)', () => {
  it('selfAssign with no active primary inserts as primary', async () => {
    const d = deps();
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await svc.selfAssign('app', 'c1');
    expect(d.repo.insertAssignment).toHaveBeenCalledWith(
      'app',
      'c1',
      'primary',
      expect.objectContaining({ assignedByRole: 'consultant' }),
    );
  });

  it('selfAssign when a primary exists inserts as backup', async () => {
    const d = deps({
      getActivePrimary: jest
        .fn()
        .mockResolvedValue({ consultant_id: 'other', role: 'primary' }),
    });
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await svc.selfAssign('app', 'c1');
    expect(d.repo.insertAssignment).toHaveBeenCalledWith(
      'app',
      'c1',
      'backup',
      expect.objectContaining({ assignedByRole: 'consultant' }),
    );
  });

  it('adminAssign 409 when an active primary exists', async () => {
    const d = deps({
      getActivePrimary: jest
        .fn()
        .mockResolvedValue({ consultant_id: 'p', role: 'primary' }),
    });
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await expect(svc.adminAssign('app', 'c1', 'admin')).rejects.toThrow(
      ConflictException,
    );
  });
});
