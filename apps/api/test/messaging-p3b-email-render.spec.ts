import { renderMessageNotificationEmail } from '../src/i18n/email/render';

describe('renderMessageNotificationEmail', () => {
  it('includes the count, a safe resume link, and an unsubscribe link', () => {
    const { subject, html } = renderMessageNotificationEmail('en', {
      count: 3,
      country: 'Canada',
      href: 'https://app/x',
      unsubUrl: 'https://api/unsub',
    });
    expect(subject).toContain('3');
    expect(html).toContain('https://app/x');
    expect(html).toContain('https://api/unsub');
    expect(html).toContain('Canada');
  });

  it('neutralizes a non-http resume link', () => {
    const { html } = renderMessageNotificationEmail('en', {
      count: 1,
      country: null,
      href: 'javascript:alert(1)',
      unsubUrl: 'https://api/unsub',
    });
    expect(html).not.toContain('javascript:');
  });
});
