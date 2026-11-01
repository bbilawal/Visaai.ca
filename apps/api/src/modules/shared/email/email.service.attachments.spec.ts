import { EmailService } from './email.service';

describe('EmailService attachments', () => {
  it('passes attachments through to sendMail', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const svc = new EmailService({ get: () => undefined } as any);
    (svc as any).transport = { sendMail };
    (svc as any).from = 'noreply@test';
    await svc.send('a@b.c', 'Subj', '<p>hi</p>', [
      { filename: 'r.pdf', content: Buffer.from('x') },
    ]);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ filename: 'r.pdf', content: expect.any(Buffer) }],
      }),
    );
  });

  it('omits attachments key when none provided', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const svc = new EmailService({ get: () => undefined } as any);
    (svc as any).transport = { sendMail };
    (svc as any).from = 'noreply@test';
    await svc.send('a@b.c', 'Subj', '<p>hi</p>');
    expect(sendMail.mock.calls[0][0].attachments).toBeUndefined();
  });
});
