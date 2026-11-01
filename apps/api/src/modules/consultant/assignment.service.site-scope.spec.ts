import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AssignmentService } from './assignment.service';
import type { IAssignmentRepository } from './assignment.repository';
import type { AuditService } from '../audit/audit.service';
import type { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import type { Env } from '../../config/configuration';

/** SITE_MODE=canada scoping of the consultant / admin / applicant views. */
function makeService(
  repo: Partial<IAssignmentRepository>,
  mode?: 'canada' | 'global',
) {
  const config = mode
    ? ({ get: () => mode } as unknown as ConfigService<Env>)
    : undefined;
  return new AssignmentService(
    {
      releaseExpired: jest.fn().mockResolvedValue([]),
      ...repo,
    } as unknown as IAssignmentRepository,
    { append: jest.fn() } as unknown as AuditService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    undefined,
    undefined,
    config,
  );
}

const row = (id: string, destination_country: string | null) =>
  ({ id, destination_country }) as never;

describe('AssignmentService — Canada site scope', () => {
  it('canada: refuses to map a consultant to a non-Canadian country', async () => {
    const setConsultantCountries = jest.fn();
    const svc = makeService({ setConsultantCountries }, 'canada');
    await expect(
      svc.setConsultantCountries('c1', ['CA', 'US']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(setConsultantCountries).not.toHaveBeenCalled();
  });

  it('global: still accepts any registry country', async () => {
    const setConsultantCountries = jest.fn().mockResolvedValue(undefined);
    const svc = makeService({
      setConsultantCountries,
      getConsultantCountries: jest.fn().mockResolvedValue(['CA', 'US']),
    });
    await expect(
      svc.setConsultantCountries('c1', ['CA', 'US']),
    ).resolves.toEqual(['CA', 'US']);
  });

  it('canada: queue only asks for Canada and drops non-CA assigned rows', async () => {
    const listUnassignedByCountries = jest.fn().mockResolvedValue([]);
    const svc = makeService(
      {
        getConsultantCountries: jest.fn().mockResolvedValue(['CA', 'GB']),
        listUnassignedByCountries,
        listMyAssignedApplications: jest
          .fn()
          .mockResolvedValue([row('a', 'CA'), row('b', 'GB')]),
      },
      'canada',
    );
    const res = await svc.getConsultantQueue('c1');
    expect(listUnassignedByCountries).toHaveBeenCalledWith(['CA']);
    expect(res.mine.map((r) => r.id)).toEqual(['a']);
  });

  it('global: queue is unchanged', async () => {
    const listUnassignedByCountries = jest.fn().mockResolvedValue([]);
    const svc = makeService({
      getConsultantCountries: jest.fn().mockResolvedValue(['CA', 'GB']),
      listUnassignedByCountries,
      listMyAssignedApplications: jest
        .fn()
        .mockResolvedValue([row('a', 'CA'), row('b', 'GB')]),
    });
    const res = await svc.getConsultantQueue('c1');
    expect(listUnassignedByCountries).toHaveBeenCalledWith(['CA', 'GB']);
    expect(res.mine).toHaveLength(2);
  });

  it('canada: admin list is pinned to CA; global passes the filter through', async () => {
    const listAllApplicationsAdmin = jest.fn().mockResolvedValue([]);
    await makeService({ listAllApplicationsAdmin }, 'canada').listAllForAdmin({
      country: 'US',
      status: 'draft',
    });
    expect(listAllApplicationsAdmin).toHaveBeenLastCalledWith({
      country: 'CA',
      status: 'draft',
    });
    await makeService({ listAllApplicationsAdmin }).listAllForAdmin({
      country: 'US',
    });
    expect(listAllApplicationsAdmin).toHaveBeenLastCalledWith({
      country: 'US',
    });
  });

  it('canada: applicant view hides other destinations but keeps undecided rows', async () => {
    const listApplicantApplications = jest
      .fn()
      .mockResolvedValue([row('a', 'CA'), row('b', 'FR'), row('c', null)]);
    const canada = await makeService(
      { listApplicantApplications },
      'canada',
    ).getApplicantView('u');
    expect(canada.map((r) => r.id)).toEqual(['a', 'c']);
    const global = await makeService({
      listApplicantApplications,
    }).getApplicantView('u');
    expect(global).toHaveLength(3);
  });
});
