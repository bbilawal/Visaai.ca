const sendMail = jest.fn();
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport },
  createTransport,
}));

import { EmailService } from '../src/modules/shared/email/email.service';

const CONF: Record<string, unknown> = {
  SMTP_HOST: 'smtp.resend.com',
  SMTP_PORT: 587,
  SMTP_USER: 'resend',
  SMTP_PASS: 'key',
  SMTP_FROM: 'team@visaai.co',
};

function svc(configured: boolean) {
  const config = {
    get: (k: string) => (configured ? CONF[k] : undefined),
  } as never;
  return new EmailService(config);
}

describe('EmailService (SMTP via nodemailer)', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it('not configured → returns false, never sends', async () => {
    expect(await svc(false).send('a@b.c', 's', '<p>h</p>')).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('configured → sends from SMTP_FROM and returns true', async () => {
    sendMail.mockResolvedValue({});
    const r = await svc(true).send('a@b.c', 'Subject', '<p>hi</p>');
    expect(r).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'team@visaai.co',
        to: 'a@b.c',
        subject: 'Subject',
        html: '<p>hi</p>',
      }),
    );
  });

  it('send failure → returns false (never throws)', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    await expect(svc(true).send('a@b.c', 's', '<p>h</p>')).resolves.toBe(false);
  });
});
