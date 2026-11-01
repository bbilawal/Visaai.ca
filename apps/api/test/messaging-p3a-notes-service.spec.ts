import { ForbiddenException } from '@nestjs/common';
import { ConsultantNotesService } from '../src/modules/messaging/consultant-notes.service';

const conv = {
  id: 'c1',
  application_id: 'app-1',
  status: 'open',
  consultant_state: null,
  last_message_at: null,
  created_at: 't',
};

function deps() {
  const repo = {
    insert: jest.fn().mockResolvedValue({ id: 'n1', author_id: 'consultant' }),
    listByConversation: jest.fn().mockResolvedValue([{ id: 'n1' }]),
    updateBody: jest.fn().mockResolvedValue({ id: 'n1', body: 'edited' }),
  };
  const messaging = { ensureConversation: jest.fn().mockResolvedValue(conv) };
  const supabase = { forUser: () => ({}) };
  return { repo, messaging, supabase };
}

describe('ConsultantNotesService', () => {
  it('create rejects non-staff (user)', async () => {
    const d = deps();
    const svc = new ConsultantNotesService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    await expect(
      svc.create(
        'tok',
        { id: 'owner', appRole: 'user' },
        'app-1',
        'secret note',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create as consultant sets author_id = caller.id', async () => {
    const d = deps();
    const svc = new ConsultantNotesService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    await svc.create(
      'tok',
      { id: 'consultant', appRole: 'consultant' },
      'app-1',
      'note',
    );
    expect(d.repo.insert).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        authorId: 'consultant',
        body: 'note',
        conversationId: 'c1',
      }),
    );
  });

  it('list rejects non-staff', async () => {
    const d = deps();
    const svc = new ConsultantNotesService(
      d.repo,
      d.messaging as never,
      d.supabase as never,
    );
    await expect(
      svc.list('tok', { id: 'owner', appRole: 'user' }, 'app-1'),
    ).rejects.toThrow(ForbiddenException);
  });
});
