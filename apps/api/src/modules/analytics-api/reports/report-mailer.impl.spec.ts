import { EmailReportMailer } from './report-mailer.impl';

describe('EmailReportMailer', () => {
  it('sends one email per recipient with the attachment', async () => {
    const email = { send: jest.fn().mockResolvedValue(true) } as any;
    const mailer = new EmailReportMailer(email);
    await mailer.mail({
      recipients: ['a@b.c', 'd@e.f'],
      subject: 'S',
      html: '<p>x</p>',
      file: {
        filename: 'r.pdf',
        content: Buffer.from('x'),
        contentType: 'application/pdf',
      },
    });
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send).toHaveBeenCalledWith('a@b.c', 'S', '<p>x</p>', [
      { filename: 'r.pdf', content: expect.any(Buffer) },
    ]);
  });
});
