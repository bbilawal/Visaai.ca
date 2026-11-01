import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentService } from '../src/modules/consultant/assignment.service';

const app = { id: 'app', user_id: 'owner', destination_country: 'CA' };
function deps(targetRole: string | null, primaryId: string | null = 'p1') {
  const repo = {
    getApplicationMeta: jest.fn().mockResolvedValue(app),
    getActiveAssignmentFor: jest
      .fn()
      .mockResolvedValue(
        targetRole ? { consultant_id: 'c2', role: targetRole } : null,
      ),
    getActivePrimary: jest
      .fn()
      .mockResolvedValue(
        primaryId ? { consultant_id: primaryId, role: 'primary' } : null,
      ),
    setRole: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const bus = { emit: jest.fn() };
  return { repo, audit, bus };
}

describe('AssignmentService.adminPromote', () => {
  it('demotes current primary then promotes the backup (in that order)', async () => {
    const d = deps('backup', 'p1');
    const calls: string[] = [];
    d.repo.setRole.mockImplementation((_a, c, r) => {
      calls.push(`${c}:${r}`);
      return Promise.resolve();
    });
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await svc.adminPromote('app', 'c2', 'admin');
    expect(calls).toEqual(['p1:backup', 'c2:primary']);
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CONSULTANT_PROMOTED' }),
    );
    expect(d.bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPLICATION_PROMOTED' }),
    );
  });

  it('rejects when target is not an active assignment', async () => {
    const d = deps(null);
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await expect(svc.adminPromote('app', 'c2', 'admin')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects when target is already the primary', async () => {
    const d = deps('primary');
    const svc = new AssignmentService(
      d.repo as never,
      d.audit as never,
      d.bus as never,
    );
    await expect(svc.adminPromote('app', 'c2', 'admin')).rejects.toThrow(
      BadRequestException,
    );
  });
});
