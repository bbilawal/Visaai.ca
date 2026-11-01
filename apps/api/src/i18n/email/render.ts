import type { StageSlug } from '@visaai/types';
import { messagesFor, resolveEmailLocale } from './messages';

const RTL = new Set(['ar', 'ur']);

export interface ReminderVars {
  country: string | null;
  stage: StageSlug;
  href: string;
  unsubUrl: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only allow http(s) links in email HTML; neutralize anything else (e.g. javascript:). */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '#';
}

/**
 * Localized stalled-application reminder. Chrome + next-step label are
 * translated; the country is the stored value (escaped, not translated). RTL
 * locales (ar/ur) wrap the body in dir="rtl".
 */
export function renderReminderEmail(
  locale: string | null | undefined,
  vars: ReminderVars,
): { subject: string; html: string } {
  const code = resolveEmailLocale(locale);
  const m = messagesFor(code);
  const dir = RTL.has(code) ? 'rtl' : 'ltr';

  const sentence = vars.country
    ? m.reminder.bodyWithCountry.replace('{country}', escapeHtml(vars.country))
    : m.reminder.body;
  const label = m.nextStep[vars.stage] ?? '';

  const html = `
    <div dir="${dir}" lang="${code}">
      <p>${sentence}</p>
      <p><strong>${m.reminder.nextStepPrefix}</strong> ${label}.</p>
      <p><a href="${safeHref(vars.href)}">${m.reminder.resume}</a></p>
      <p style="font-size:12px;color:#737373"><a href="${safeHref(vars.unsubUrl)}">${m.reminder.unsubscribe}</a></p>
    </div>
  `;

  return { subject: m.reminder.subject, html };
}

export interface MessageNotificationVars {
  count: number;
  country: string | null;
  href: string;
  unsubUrl: string;
}

/**
 * Off-platform "you have unread messages" email. English-only for P3b (email
 * i18n for messaging is deferred, consistent with P3a's deferred labels). Never
 * includes message content — only the unread count, application country, a
 * resume link, and an unsubscribe link.
 */
export function renderMessageNotificationEmail(
  _locale: string | null | undefined,
  vars: MessageNotificationVars,
): { subject: string; html: string } {
  const plural = vars.count === 1 ? 'message' : 'messages';
  const subject = `You have ${vars.count} new ${plural}`;
  const where = vars.country
    ? ` in your ${escapeHtml(vars.country)} application`
    : ' in your application';
  const html = `
    <div dir="ltr" lang="en">
      <p>You have ${vars.count} new ${plural}${where}.</p>
      <p><a href="${safeHref(vars.href)}">Open the conversation</a></p>
      <p style="font-size:12px;color:#737373"><a href="${safeHref(vars.unsubUrl)}">Unsubscribe from message emails</a></p>
    </div>
  `;
  return { subject, html };
}
