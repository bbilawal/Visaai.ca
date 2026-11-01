import { ReportDeliveryService } from './report-delivery.service';

const exportSvc = {
  render: jest.fn().mockResolvedValue({
    filename: 'r.pdf',
    contentType: 'application/pdf',
    buffer: Buffer.from('x'),
  }),
} as any;
const mailer = { mail: jest.fn().mockResolvedValue(undefined) } as any;
const notifier = { notify: jest.fn().mockResolvedValue(undefined) } as any;

const saved = {
  id: 'r1',
  name: 'MRR',
  metricKey: 'financial',
  metric: 'mrr',
  query: { grain: 'day' },
} as any;
const schedule = {
  format: 'pdf',
  recipients: ['a@b.c'],
  notifyUserIds: ['u1'],
} as any;
const result = {
  metric: 'mrr',
  unit: 'cents',
  total: 1,
  series: [],
  meta: { computedAt: 'x', tier: 'live' },
} as any;

describe('ReportDeliveryService', () => {
  it('mails the attachment AND notifies in-app', async () => {
    const svc = new ReportDeliveryService(exportSvc, mailer, notifier);
    const out = await svc.deliver({ saved, schedule, result, runId: 'run1' });
    expect(exportSvc.render).toHaveBeenCalledWith('pdf', expect.any(Object));
    expect(mailer.mail).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: ['a@b.c'] }),
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['u1'],
        link: expect.stringContaining('run1'),
      }),
    );
    expect(out.delivered).toBe(true);
  });

  it('never throws — records error on failure', async () => {
    const badMailer = {
      mail: jest.fn().mockRejectedValue(new Error('smtp')),
    } as any;
    const svc = new ReportDeliveryService(exportSvc, badMailer, notifier);
    const out = await svc.deliver({ saved, schedule, result, runId: 'run1' });
    expect(out.delivered).toBe(false);
    expect(out.error).toContain('smtp');
  });
});
