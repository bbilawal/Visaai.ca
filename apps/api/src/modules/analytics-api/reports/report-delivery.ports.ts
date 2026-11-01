export const REPORT_MAILER = Symbol('REPORT_MAILER');
export const REPORT_NOTIFIER = Symbol('REPORT_NOTIFIER');

export interface MailFile {
  filename: string;
  content: Buffer;
  contentType: string;
}
export interface ReportMailer {
  mail(input: {
    recipients: string[];
    subject: string;
    html: string;
    file?: MailFile;
  }): Promise<void>;
}
export interface ReportNotifier {
  notify(input: {
    userIds: string[];
    title: string;
    body: string;
    link: string;
  }): Promise<void>;
}
