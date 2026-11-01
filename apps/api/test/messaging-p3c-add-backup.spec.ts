import { ForbiddenException } from '@nestjs/common';
import { AssignmentService } from '../src/modules/consultant/assignment.service';

const app = { id: 'app', user_id: 'owner', destination_country: 'CA' };
function deps(countries = ['CA']) {
  const repo = {
    getApplicationMeta: jest.fn().mockResolvedValue(app),
    getConsultantCountries: jest.fn().mockResolvedValue(countries),
    insertAssignment: jest
      .fn()
      .mockResolvedValue({ id: 'b1', role: 'backup', consultant_id: 'c2' }),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const bus = { emit: jest.fn() };
  return { repo, audit, bus };
}

describe('AssignmentService.adminAddBackup', () => {
  it('inserts an active backup and emits events', async () => {
    const d = deps();
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    const out = await svc.adminAddBackup('app', 'c2', 'admin');
    expect(out.role).toBe('backup');
    expect(d.repo.insertAssignment).toHaveBeenCalledWith(
      'app',
      'c2',
      'backup',
      expect.objectContaining({ assignedByRole: 'admin' }),
    );
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CONSULTANT_BACKUP_ADDED' }),
    );
    expect(d.bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPLICATION_BACKUP_ADDED' }),
    );
  });

  it('rejects a consultant not eligible for the country', async () => {
    const d = deps(['GB']); // app is CA
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await expect(svc.adminAddBackup('app', 'c2', 'admin')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
