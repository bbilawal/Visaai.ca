import { Injectable } from '@nestjs/common';
import { EmailService } from '../../shared/email/email.service';
import type { ReportMailer, MailFile } from './report-delivery.ports';

@Injectable()
export class EmailReportMailer implements ReportMailer {
  constructor(private readonly email: EmailService) {}
  async mail(input: {
    recipients: string[];
    subject: string;
    html: string;
    file?: MailFile;
  }): Promise<void> {
    const attachments = input.file
      ? [{ filename: input.file.filename, content: input.file.content }]
      : undefined;
    for (const to of input.recipients)
      await this.email.send(to, input.subject, input.html, attachments);
  }
}
