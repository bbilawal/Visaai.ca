import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentService } from '../src/modules/consultant/assignment.service';

const app = { id: 'app', user_id: 'owner', destination_country: 'CA' };
function deps(role: string | null) {
  const repo = {
    getApplicationMeta: jest.fn().mockResolvedValue(app),
    getActiveAssignmentFor: jest
      .fn()
      .mockResolvedValue(role ? { consultant_id: 'c2', role } : null),
    releaseAssignment: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const bus = { emit: jest.fn() };
  return { repo, audit, bus };
}

describe('AssignmentService.adminRemoveBackup', () => {
  it('releases an active backup and emits events', async () => {
    const d = deps('backup');
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await svc.adminRemoveBackup('app', 'c2', 'admin');
    expect(d.repo.releaseAssignment).toHaveBeenCalledWith('app', 'c2');
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CONSULTANT_BACKUP_REMOVED' }),
    );
    expect(d.bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPLICATION_BACKUP_REMOVED' }),
    );
  });

  it('rejects when target is not active', async () => {
    const d = deps(null);
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await expect(svc.adminRemoveBackup('app', 'c2', 'admin')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects removing the primary via this path', async () => {
    const d = deps('primary');
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await expect(svc.adminRemoveBackup('app', 'c2', 'admin')).rejects.toThrow(
      BadRequestException,
    );
  });
});
