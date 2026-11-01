import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import type { IAssignmentRepository } from './assignment.repository';
import { AuditService } from '../audit/audit.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';

/**
 * Hand-rolled IAssignmentRepository fake (jest mock-db style, mirroring
 * intake.service.spec). Only the methods exercised here are implemented; the
 * rest throw if called so an unexpected path is loud, not silently passing.
 */
function makeRepo(
  overrides: Partial<IAssignmentRepository> = {},
): IAssignmentRepository {
  const notImpl = (name: string) => () => {
    throw new Error(`unexpected repo call: ${name}`);
  };
  return {
    insertAssignment: notImpl('insertAssignment'),
    releaseAssignment: notImpl('releaseAssignment'),
    setDeadline: jest.fn().mockResolvedValue(undefined),
    markCompleted: notImpl('markCompleted'),
    releaseExpired: jest.fn().mockResolvedValue([]),
    getActivePrimary: jest.fn().mockResolvedValue(null),
    listActiveAssignments: notImpl('listActiveAssignments'),
    getActiveAssignmentFor: notImpl('getActiveAssignmentFor'),
    setRole: notImpl('setRole'),
    getConsultantCountries: jest.fn().mockResolvedValue([]),
    listConsultantCountryRows: notImpl('listConsultantCountryRows'),
    setConsultantCountries: jest.fn().mockResolvedValue(undefined),
    getApplicationMeta: jest.fn().mockResolvedValue({
      id: 'app-1',
      user_id: 'u-1',
      destination_country: 'CA',
    }),
    listUnassignedByCountries: notImpl('listUnassignedByCountries'),
    listMyAssignedApplications: notImpl('listMyAssignedApplications'),
    getAssignedConsultant: notImpl('getAssignedConsultant'),
    listAllApplicationsAdmin: notImpl('listAllApplicationsAdmin'),
    listApplicantApplications: notImpl('listApplicantApplications'),
    getUserEmails: notImpl('getUserEmails'),
    ...overrides,
  };
}

function makeService(repo: IAssignmentRepository) {
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const bus = { emit: jest.fn() };
  const service = new AssignmentService(
    repo,
    audit as unknown as AuditService,
    bus as unknown as AssignmentEventBus,
  );
  return { service, audit, bus };
}

describe('AssignmentService.setDeadlineAt — absolute datetime deadline', () => {
  const activePrimary = {
    consultant_id: 'c-1',
    role: 'primary',
  } as never;

  it('accepts a valid future ISO and stores the canonical due_at', async () => {
    const setDeadline = jest.fn().mockResolvedValue(undefined);
    const repo = makeRepo({
      setDeadline,
      getActivePrimary: jest.fn().mockResolvedValue(activePrimary),
    });
    const { service, audit } = makeService(repo);

    const dueAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    const result = await service.setDeadlineAt('app-1', dueAt, 'admin-1');

    expect(result).toEqual({ due_at: dueAt });
    expect(setDeadline).toHaveBeenCalledWith('app-1', 'c-1', dueAt);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CONSULTANT_DEADLINE_CHANGED' }),
    );
  });

  it('rejects a past datetime (must be > now+5min)', async () => {
    const repo = makeRepo({
      getActivePrimary: jest.fn().mockResolvedValue(activePrimary),
    });
    const { service } = makeService(repo);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    await expect(
      service.setDeadlineAt('app-1', past, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a datetime under the 5-minute lead window', async () => {
    const repo = makeRepo({
      getActivePrimary: jest.fn().mockResolvedValue(activePrimary),
    });
    const { service } = makeService(repo);
    const soon = new Date(Date.now() + 60_000).toISOString(); // +1min
    await expect(
      service.setDeadlineAt('app-1', soon, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a datetime more than 1 year out', async () => {
    const repo = makeRepo({
      getActivePrimary: jest.fn().mockResolvedValue(activePrimary),
    });
    const { service } = makeService(repo);
    const tooFar = new Date(Date.now() + 366 * 24 * 3_600_000).toISOString();
    await expect(
      service.setDeadlineAt('app-1', tooFar, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unparseable datetime', async () => {
    const repo = makeRepo({
      getActivePrimary: jest.fn().mockResolvedValue(activePrimary),
    });
    const { service } = makeService(repo);
    await expect(
      service.setDeadlineAt('app-1', 'not-a-date', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the application has no active primary', async () => {
    const repo = makeRepo({
      getActivePrimary: jest.fn().mockResolvedValue(null),
    });
    const { service } = makeService(repo);
    const dueAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    await expect(
      service.setDeadlineAt('app-1', dueAt, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the application does not exist', async () => {
    const repo = makeRepo({
      getApplicationMeta: jest.fn().mockResolvedValue(null),
    });
    const { service } = makeService(repo);
    const dueAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    await expect(
      service.setDeadlineAt('missing', dueAt, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AssignmentService.setConsultantCountries — registry validation', () => {
  it('upserts active + deactivates the rest, returning the new active set', async () => {
    const setConsultantCountries = jest.fn().mockResolvedValue(undefined);
    const getConsultantCountries = jest.fn().mockResolvedValue(['CA', 'DE']);
    const repo = makeRepo({
      setConsultantCountries,
      getConsultantCountries,
    });
    const { service } = makeService(repo);

    const result = await service.setConsultantCountries('c-1', ['CA', 'DE']);

    expect(setConsultantCountries).toHaveBeenCalledWith('c-1', ['CA', 'DE']);
    expect(result).toEqual(['CA', 'DE']);
  });

  it('rejects an unknown ISO-2 code (not in the strategy registry)', async () => {
    const setConsultantCountries = jest.fn();
    const repo = makeRepo({ setConsultantCountries });
    const { service } = makeService(repo);

    await expect(
      service.setConsultantCountries('c-1', ['CA', 'ZZ']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(setConsultantCountries).not.toHaveBeenCalled();
  });

  it('accepts the SCHENGEN bloc code (resolvable coverage code)', async () => {
    const setConsultantCountries = jest.fn().mockResolvedValue(undefined);
    const getConsultantCountries = jest.fn().mockResolvedValue(['SCHENGEN']);
    const repo = makeRepo({ setConsultantCountries, getConsultantCountries });
    const { service } = makeService(repo);

    await expect(
      service.setConsultantCountries('c-1', ['SCHENGEN']),
    ).resolves.toEqual(['SCHENGEN']);
  });

  it('accepts an empty set (clears all coverage)', async () => {
    const setConsultantCountries = jest.fn().mockResolvedValue(undefined);
    const getConsultantCountries = jest.fn().mockResolvedValue([]);
    const repo = makeRepo({ setConsultantCountries, getConsultantCountries });
    const { service } = makeService(repo);

    await expect(service.setConsultantCountries('c-1', [])).resolves.toEqual(
      [],
    );
    expect(setConsultantCountries).toHaveBeenCalledWith('c-1', []);
  });
});
