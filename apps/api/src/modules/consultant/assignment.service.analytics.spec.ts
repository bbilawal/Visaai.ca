import { AssignmentService } from './assignment.service';
import type { IAssignmentRepository } from './assignment.repository';
import { AuditService } from '../audit/audit.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

/** Hand-rolled IAssignmentRepository fake — unexercised paths throw loud. */
function makeRepo(
  overrides: Partial<IAssignmentRepository> = {},
): IAssignmentRepository {
  const notImpl = (name: string) => () => {
    throw new Error(`unexpected repo call: ${name}`);
  };
  return {
    insertAssignment: notImpl('insertAssignment'),
    releaseAssignment: notImpl('releaseAssignment'),
    setDeadline: notImpl('setDeadline'),
    markCompleted: notImpl('markCompleted'),
    releaseExpired: jest.fn().mockResolvedValue([]),
    getActivePrimary: jest.fn().mockResolvedValue(null),
    listActiveAssignments: notImpl('listActiveAssignments'),
    getActiveAssignmentFor: notImpl('getActiveAssignmentFor'),
    setRole: notImpl('setRole'),
    getConsultantCountries: jest.fn().mockResolvedValue(['CA']),
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

function makeService(
  repo: IAssignmentRepository,
  analytics?: AnalyticsEventBus,
) {
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const bus = { emit: jest.fn() };
  const service = new AssignmentService(
    repo,
    audit as unknown as AuditService,
    bus as unknown as AssignmentEventBus,
    undefined,
    analytics,
  );
  return { service, audit, bus };
}

describe('AssignmentService — analytics emits', () => {
  it('emits consultant.assigned on selfAssign with role/consultant_id, no PII', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const repo = makeRepo({
      insertAssignment: jest.fn().mockResolvedValue({
        id: 'a-1',
        application_id: 'app-1',
        consultant_id: 'c-1',
        role: 'primary',
        status: 'active',
      }),
    });
    const { service } = makeService(repo, analytics);

    await service.selfAssign('app-1', 'c-1');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'consultant.assigned',
      user_id: 'u-1',
      application_id: 'app-1',
      props: {
        role: 'primary',
        consultant_id: 'c-1',
        assigned_by_role: 'consultant',
      },
    });
  });

  it('emits consultant.assigned on adminAssign with assigned_by_role admin', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const repo = makeRepo({
      insertAssignment: jest.fn().mockResolvedValue({
        id: 'a-1',
        application_id: 'app-1',
        consultant_id: 'c-2',
        role: 'primary',
        status: 'active',
      }),
    });
    const { service } = makeService(repo, analytics);

    await service.adminAssign('app-1', 'c-2', 'admin-1');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'consultant.assigned',
      user_id: 'u-1',
      application_id: 'app-1',
      props: {
        role: 'primary',
        consultant_id: 'c-2',
        assigned_by_role: 'admin',
      },
    });
  });

  it('emits review.completed on markComplete with consultant_id + role, user_id null', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const repo = makeRepo({
      getActiveAssignmentFor: jest.fn().mockResolvedValue({
        id: 'a-1',
        application_id: 'app-1',
        consultant_id: 'c-1',
        role: 'primary',
        status: 'active',
      }),
      markCompleted: jest.fn().mockResolvedValue(undefined),
    });
    const { service } = makeService(repo, analytics);

    await service.markComplete('app-1', 'c-1');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'review.completed',
      user_id: null,
      application_id: 'app-1',
      props: { consultant_id: 'c-1', role: 'primary' },
    });
  });

  it('emits ai.escalated on flagForConsultantEscalation with application_id, reason kept out of props', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const { service } = makeService(makeRepo(), analytics);

    await service.flagForConsultantEscalation('app-9', 'vri score below floor');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'ai.escalated',
      application_id: 'app-9',
      props: { reason_present: true },
    });
    // The free-text reason string must never appear in props.
    expect(Object.keys(events[0].props)).toEqual(['reason_present']);
    expect(JSON.stringify(events[0].props)).not.toContain(
      'vri score below floor',
    );
  });

  it('ai.escalated reason_present is false when no reason is supplied', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const { service } = makeService(makeRepo(), analytics);
    await service.flagForConsultantEscalation('app-9');

    expect(events[0]).toMatchObject({
      name: 'ai.escalated',
      props: { reason_present: false },
    });
  });

  it('does not throw when the analytics bus is omitted (Optional-safety)', async () => {
    const repo = makeRepo({
      getActiveAssignmentFor: jest.fn().mockResolvedValue({
        id: 'a-1',
        application_id: 'app-1',
        consultant_id: 'c-1',
        role: 'primary',
        status: 'active',
      }),
      markCompleted: jest.fn().mockResolvedValue(undefined),
    });
    const { service } = makeService(repo, undefined);

    await expect(service.markComplete('app-1', 'c-1')).resolves.toEqual(
      expect.objectContaining({ completed_at: expect.any(String) }),
    );
    // The escalation emit must also be safe with no bus.
    await expect(
      service.flagForConsultantEscalation('app-1', 'x'),
    ).resolves.toBeUndefined();
  });
});
