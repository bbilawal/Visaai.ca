import { NotificationTemplateService } from './notification-template.service';
import { renderEvent, type NotificationEvent } from './events/catalog';

const event: NotificationEvent = {
  type: 'consultant.assigned',
  userId: 'u1',
  applicationId: 'app1',
  data: { consultantName: 'Sam' },
};

function make(repoOver: Record<string, jest.Mock> = {}) {
  const repo = {
    getActive: jest.fn().mockResolvedValue(null),
    list: jest.fn(),
    getById: jest.fn(),
    insert: jest.fn(async (_db, row) => ({ id: 't1', ...row })),
    deactivateActive: jest.fn().mockResolvedValue(undefined),
    deactivateById: jest.fn().mockResolvedValue(undefined),
    maxVersion: jest.fn().mockResolvedValue(0),
    ...repoOver,
  };
  const supabase = { admin: {} } as never;
  return {
    svc: new NotificationTemplateService(repo, supabase),
    repo,
  };
}

describe('NotificationTemplateService.render', () => {
  it('interpolates an active template', async () => {
    const { svc } = make({
      getActive: jest.fn().mockResolvedValue({
        title: 'Consultant {{consultantName}}',
        body: 'Now on {{applicationId}}',
      }),
    });
    const r = await svc.render(event, 'en');
    expect(r.title).toBe('Consultant Sam');
    expect(r.body).toBe('Now on app1');
    expect(r.category).toBe('assignment'); // from catalog
    expect(r.link).toBe('/applications/app1'); // from catalog
  });

  it('falls back to the catalog when no template exists', async () => {
    const { svc } = make();
    const r = await svc.render(event, 'en');
    expect(r).toEqual(renderEvent(event));
  });

  it('falls back to the en template when the requested locale is missing', async () => {
    const getActive = jest
      .fn()
      .mockResolvedValueOnce(null) // fr
      .mockResolvedValueOnce({ title: 'EN {{consultantName}}', body: 'b' }); // en
    const { svc } = make({ getActive });
    const r = await svc.render(event, 'fr');
    expect(r.title).toBe('EN Sam');
    expect(getActive).toHaveBeenCalledTimes(2);
  });

  it('never throws into emit — returns catalog on a repo error', async () => {
    const { svc } = make({
      getActive: jest.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(svc.render(event, 'en')).resolves.toEqual(renderEvent(event));
  });
});

describe('NotificationTemplateService CRUD', () => {
  it('create deactivates the prior active and bumps the version', async () => {
    const { svc, repo } = make({ maxVersion: jest.fn().mockResolvedValue(2) });
    const t = await svc.create(
      { event_type: 'payment.received', title: 'Paid {{tier}}', body: 'b' },
      'admin-1',
    );
    expect(repo.deactivateActive).toHaveBeenCalledWith(
      {},
      'payment.received',
      'en',
    );
    expect(repo.insert).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        version: 3,
        is_active: true,
        created_by: 'admin-1',
      }),
    );
    expect((t as { version: number }).version).toBe(3);
  });

  it('preview renders title + body from sample vars', () => {
    const { svc } = make();
    expect(
      svc.preview({ title: 'Hi {{n}}', body: 'x{{n}}' }, { n: 'Z' }),
    ).toEqual({
      title: 'Hi Z',
      body: 'xZ',
    });
  });
});
