import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentRequestService } from '../src/modules/messaging/document-request.service';

const conv = {
  id: 'c1',
  application_id: 'app-1',
  status: 'open',
  last_message_at: null,
  created_at: 't',
};
function baseReq(over = {}) {
  return {
    id: 'r1',
    conversation_id: 'c1',
    application_id: 'app-1',
    requested_by: 'consultant',
    document_type: 'bank_statement',
    label: 'Bank statement',
    notes: null,
    due_date: null,
    priority: 'normal',
    status: 'pending',
    checklist_item_id: null,
    fulfilled_attachment_id: null,
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

function deps(req = baseReq()) {
  const repo = {
    insert: jest.fn().mockResolvedValue(req),
    listByApplication: jest.fn().mockResolvedValue([req]),
    getById: jest.fn().mockResolvedValue(req),
    update: jest.fn().mockImplementation((_db, _id, patch) =>
      Promise.resolve({
        ...req,
        ...patch,
        status: patch.status ?? req.status,
      }),
    ),
  };
  const messaging = {
    ensureConversation: jest.fn().mockResolvedValue(conv),
    recipientIds: jest.fn().mockResolvedValue(['owner']),
  };
  const msgRepo = {
    insertNotifications: jest.fn().mockResolvedValue(undefined),
  };
  const bus = { emit: jest.fn() };
  const supabase = { forUser: () => ({}), admin: { __admin: true } };
  return { repo, messaging, msgRepo, bus, supabase };
}

describe('DocumentRequestService', () => {
  it('create requires consultant/admin', async () => {
    const d = deps();
    const svc = new DocumentRequestService(
      d.repo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.create('tok', { id: 'owner', appRole: 'user' }, 'app-1', {
        documentType: 'x',
        label: 'X',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create as consultant emits + notifies the user', async () => {
    const d = deps();
    const svc = new DocumentRequestService(
      d.repo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    const out = await svc.create(
      'tok',
      { id: 'consultant', appRole: 'consultant' },
      'app-1',
      {
        documentType: 'bank_statement',
        label: 'Bank statement',
        priority: 'high',
      },
    );
    expect(out.id).toBe('r1');
    expect(d.bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'document_request.created' }),
    );
    expect(d.msgRepo.insertNotifications).toHaveBeenCalled();
  });

  it('fulfill moves pending->submitted (user)', async () => {
    const d = deps(baseReq({ status: 'pending' }));
    const svc = new DocumentRequestService(
      d.repo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    const out = await svc.fulfill(
      'tok',
      { id: 'owner', appRole: 'user' },
      'r1',
      { attachmentId: 'at1' },
    );
    expect(out.status).toBe('submitted');
    // update MUST run via the service-role (admin) client — direct authenticated
    // UPDATE on document_requests is revoked at the grant level.
    expect(d.repo.update).toHaveBeenCalledWith({ __admin: true }, 'r1', {
      status: 'submitted',
      fulfilledAttachmentId: 'at1',
    });
  });

  it('setStatus approve requires consultant/admin', async () => {
    const d = deps(baseReq({ status: 'submitted' }));
    const svc = new DocumentRequestService(
      d.repo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.setStatus('tok', { id: 'owner', appRole: 'user' }, 'r1', 'approved'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('setStatus rejects an invalid transition', async () => {
    const d = deps(baseReq({ status: 'pending' }));
    const svc = new DocumentRequestService(
      d.repo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    await expect(
      svc.setStatus(
        'tok',
        { id: 'consultant', appRole: 'consultant' },
        'r1',
        'approved',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('setStatus approve from under_review (consultant) succeeds', async () => {
    const d = deps(baseReq({ status: 'under_review' }));
    const svc = new DocumentRequestService(
      d.repo,
      d.msgRepo as never,
      d.messaging as never,
      d.bus as never,
      d.supabase as never,
    );
    const out = await svc.setStatus(
      'tok',
      { id: 'consultant', appRole: 'consultant' },
      'r1',
      'approved',
    );
    expect(out.status).toBe('approved');
    // status writes MUST run via service-role (direct authenticated UPDATE revoked)
    expect(d.repo.update).toHaveBeenCalledWith({ __admin: true }, 'r1', {
      status: 'approved',
    });
    expect(d.bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'document_request.updated' }),
    );
  });
});
