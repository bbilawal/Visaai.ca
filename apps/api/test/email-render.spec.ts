import { renderReminderEmail } from '../src/i18n/email/render';
import { MESSAGES } from '../src/i18n/email/messages';

const base = {
  country: 'Canada',
  stage: 'documents' as const,
  href: 'https://app.visaai.co/documents/app-1',
  unsubUrl: 'https://api.visaai.co/reminders/unsubscribe/u1/tok',
};

describe('renderReminderEmail', () => {
  it('renders English by default', () => {
    const { subject, html } = renderReminderEmail('en', base);
    expect(subject).toBe(MESSAGES.en.reminder.subject);
    expect(html).toContain('Canada');
    expect(html).toContain(MESSAGES.en.nextStep.documents);
    expect(html).toContain(base.href);
    expect(html).toContain(base.unsubUrl);
    expect(html).toContain('dir="ltr"');
  });

  it('renders Arabic RTL with localized subject + next-step label', () => {
    const { subject, html } = renderReminderEmail('ar', base);
    expect(subject).toBe(MESSAGES.ar.reminder.subject);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain(MESSAGES.ar.nextStep.documents);
    expect(html).toContain('Canada'); // country stays as stored
  });

  it('renders CJK (ja) ltr', () => {
    const { subject, html } = renderReminderEmail('ja', base);
    expect(subject).toBe(MESSAGES.ja.reminder.subject);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain(MESSAGES.ja.nextStep.documents);
  });

  it('falls back to English for unknown locale', () => {
    const { subject, html } = renderReminderEmail('xx', base);
    expect(subject).toBe(MESSAGES.en.reminder.subject);
    expect(html).toContain('lang="en"');
    expect(html).toContain('dir="ltr"');
  });

  it('uses the country-less body when country is null', () => {
    const { html } = renderReminderEmail('en', { ...base, country: null });
    expect(html).toContain(MESSAGES.en.reminder.body);
    expect(html).not.toContain('{country}');
  });

  it('escapes HTML in the country value', () => {
    const { html } = renderReminderEmail('en', {
      ...base,
      country: '<script>x</script>',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralizes non-http(s) links (no javascript: in output)', () => {
    const { html } = renderReminderEmail('en', {
      ...base,
      href: 'javascript:alert(1)',
      unsubUrl: 'javascript:alert(2)',
    });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });
});
