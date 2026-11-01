import type { AuthUser } from '../src/modules/auth/jwt.guard';
import { ConsultantController } from '../src/modules/consultant/consultant.controller';
import type { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import type { AssignmentService } from '../src/modules/consultant/assignment.service';
import type { ConsultantReviewService } from '../src/modules/consultant/consultant-review.service';
import type { AiReviewAssistantService } from '../src/modules/consultant/ai-review-assistant.service';

const APP = 'app-1';
const USER: AuthUser = {
  id: 'cons-1',
  email: 'c@x.com',
  role: 'authenticated',
};

function make() {
  const svc = {
    assign: jest.fn().mockResolvedValue({ id: 'asg-1' }),
    reassign: jest.fn().mockResolvedValue({ id: 'asg-2' }),
    getAssignment: jest.fn().mockResolvedValue({ id: 'asg-2' }),
    getAssignmentHistory: jest
      .fn()
      .mockResolvedValue([{ id: 'asg-1' }, { id: 'asg-2' }]),
    reviewField: jest
      .fn()
      .mockResolvedValue({ id: 'dec-1', decision: 'reviewed' }),
    approveField: jest
      .fn()
      .mockResolvedValue({ id: 'dec-2', decision: 'approved' }),
    rejectField: jest
      .fn()
      .mockResolvedValue({ id: 'dec-3', decision: 'rejected' }),
    revoke: jest.fn().mockResolvedValue({ id: 'dec-4', decision: 'revoked' }),
    markFieldNotApplicable: jest
      .fn()
      .mockResolvedValue({ id: 'dec-5', decision: 'not_applicable' }),
    getApplicationApproval: jest.fn().mockResolvedValue({
      applicationId: APP,
      fields: [],
      sections: [],
      applicationApproved: false,
    }),
  };
  const assign = {
    selfAssign: jest.fn().mockResolvedValue({ id: 'asg-self' }),
  };
  const review = {
    getReview: jest.fn().mockResolvedValue({
      applicationId: APP,
      summary: {},
      fields: [],
      documents: [],
    }),
  };
  const aiReview = {
    getReview: jest
      .fn()
      .mockResolvedValue({ applicationId: APP, advisory: true }),
  };
  const ctrl = new ConsultantController(
    svc as unknown as ConsultantApprovalService,
    assign as unknown as AssignmentService,
    review as unknown as ConsultantReviewService,
    aiReview as unknown as AiReviewAssistantService,
  );
  return { ctrl, svc, assign, review, aiReview };
}

describe('ConsultantController — thin delegation (Phase 3C)', () => {
  it('assign / reassign / history map to the service', async () => {
    const { ctrl, svc } = make();
    await ctrl.assign(APP, { consultantId: 'cons-9' });
    expect(svc.assign).toHaveBeenCalledWith(APP, 'cons-9');

    await ctrl.reassign(APP, { consultantId: 'cons-8' });
    expect(svc.reassign).toHaveBeenCalledWith(APP, 'cons-8');

    await ctrl.getAssignment(APP);
    expect(svc.getAssignment).toHaveBeenCalledWith(APP);

    await ctrl.getAssignmentHistory(APP);
    expect(svc.getAssignmentHistory).toHaveBeenCalledWith(APP);
  });

  it('decision endpoints act as the authenticated consultant', async () => {
    const { ctrl, svc } = make();
    await ctrl.reviewField(APP, 'passport_number', { valueHash: 'vh' }, USER);
    expect(svc.reviewField).toHaveBeenCalledWith(
      APP,
      USER.id,
      'passport_number',
      'vh',
    );

    await ctrl.approveField(APP, 'passport_number', { valueHash: 'vh' }, USER);
    expect(svc.approveField).toHaveBeenCalledWith(
      APP,
      USER.id,
      'passport_number',
      'vh',
    );

    await ctrl.rejectField(
      APP,
      'passport_number',
      { reason: 'bad scan' },
      USER,
    );
    expect(svc.rejectField).toHaveBeenCalledWith(
      APP,
      USER.id,
      'passport_number',
      'bad scan',
    );

    await ctrl.markFieldNotApplicable(
      APP,
      'sponsor_occupation',
      { reason: 'OCR junk' },
      USER,
    );
    expect(svc.markFieldNotApplicable).toHaveBeenCalledWith(
      APP,
      USER.id,
      'sponsor_occupation',
      'OCR junk',
    );
    await ctrl.markFieldNotApplicable(APP, 'currency', {}, USER);
    expect(svc.markFieldNotApplicable).toHaveBeenLastCalledWith(
      APP,
      USER.id,
      'currency',
      undefined,
    );

    await ctrl.revoke(
      APP,
      { scope: 'field', fieldKey: 'passport_number', reason: 'withdrawn' },
      USER,
    );
    expect(svc.revoke).toHaveBeenCalledWith(
      APP,
      USER.id,
      { scope: 'field', fieldKey: 'passport_number', section: undefined },
      'withdrawn',
    );
  });

  it('approval rollup is a pure passthrough', async () => {
    const { ctrl, svc } = make();
    const out = await ctrl.getApplicationApproval(APP);
    expect(svc.getApplicationApproval).toHaveBeenCalledWith(APP);
    expect(out).toEqual({
      applicationId: APP,
      fields: [],
      sections: [],
      applicationApproved: false,
    });
  });

  it('returns service results verbatim (no controller transformation)', async () => {
    const { ctrl, svc } = make();
    const r = await ctrl.approveField(APP, 'f', { valueHash: 'vh' }, USER);
    expect(r).toBe(await svc.approveField.mock.results[0].value);
  });

  it('only depends on consultant services (no verification / preflight / eligibility)', () => {
    const { ctrl, svc, assign, review, aiReview } = make();
    // Deps: ConsultantApprovalService + AssignmentService + ConsultantReviewService
    // + AiReviewAssistantService (all consultant-module services).
    const deps = Object.values(ctrl as unknown as Record<string, unknown>);
    expect(deps).toHaveLength(4);
    expect(deps).toContain(svc);
    expect(deps).toContain(assign);
    expect(deps).toContain(review);
    expect(deps).toContain(aiReview);
  });
});
