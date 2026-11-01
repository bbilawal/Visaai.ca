import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EscalationService } from '../src/modules/messaging/escalation.service';

const conv = {
  id: 'c1',
  application_id: 'app-1',
  status: 'open',
  consultant_state: null,
  last_message_at: null,
  created_at: 't',
};
function rec(over = {}) {
  return {
    id: 'e1',
    conversation_id: 'c1',
    application_id: 'app-1',
    escalated_by: 'consultant',
    escalation_type: 'legal_review',
    reason: 'r',
    status: 'open',
    resolved_by: null,
    resolved_at: null,
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

function deps(existing = rec()) {
  const repo = {
    insert: jest.fn().mockResolvedValue(existing),
    listByApplication: jest.fn().mockResolvedValue([existing]),
    getById: jest.fn().mockResolvedValue(existing),
    markResolved: jest.fn().mockResolvedValue({
      ...existing,
      status: 'resolved',
      resolved_by: 'consultant',
    }),
  };
  const messaging = { ensureConversation: jest.fn().mockResolvedValue(conv) };
  const supabase = { forUser: () => ({}) };
  return { repo, messaging, supabase };
}

describe('EscalationService', () => {
  it('escalate rejects non-staff', async () => {
    const d = deps();
    const svc = new EscalationService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    await expect(
      svc.escalate('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
        type: 'legal_review',
        reason: 'r',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('escalate as consultant inserts open record', async () => {
    const d = deps();
    const svc = new EscalationService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    const out = await svc.escalate(
      'tok',
      { id: 'consultant', appRole: 'consultant' },
      'app-1',
      { type: 'legal_review', reason: 'complex' },
    );
    expect(out.id).toBe('e1');
    expect(d.repo.insert).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        escalatedBy: 'consultant',
        escalationType: 'legal_review',
        reason: 'complex',
      }),
    );
  });

  it('resolve rejects non-staff', async () => {
    const d = deps();
    const svc = new EscalationService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    await expect(
      svc.resolve('tok', { id: 'owner', appRole: 'user' }, 'e1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('resolve rejects an already-resolved record', async () => {
    const d = deps(rec({ status: 'resolved' }));
    const svc = new EscalationService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    await expect(
      svc.resolve('tok', { id: 'consultant', appRole: 'consultant' }, 'e1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolve open record (consultant) succeeds', async () => {
    const d = deps(rec({ status: 'open' }));
    const svc = new EscalationService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    const out = await svc.resolve(
      'tok',
      { id: 'consultant', appRole: 'consultant' },
      'e1',
    );
    expect(out.status).toBe('resolved');
    expect(d.repo.markResolved).toHaveBeenCalledWith({}, 'e1', 'consultant');
  });
});
