import type { NotificationCategory } from '@visaai/types';

// ---------------------------------------------------------------------------
// Discriminated union of all notification events
// ---------------------------------------------------------------------------

export type NotificationEvent =
  | {
      type: 'consultant.assigned';
      userId: string;
      applicationId: string;
      data?: { consultantName?: string };
    }
  | {
      type: 'payment.received';
      userId: string;
      paymentId: string;
      data?: { amountLabel?: string; tier?: string };
    }
  | {
      type: 'ai.assessment_complete';
      userId: string;
      applicationId: string;
      data?: { score?: number };
    }
  | {
      type: 'application.status_changed';
      userId: string;
      applicationId: string;
      data: { status: string };
    }
  | {
      type: 'system.broadcast';
      userId: string;
      broadcastId: string;
      data: {
        title: string;
        body: string;
        link: string;
        category: NotificationCategory;
      };
    };

export type NotificationEventType = NotificationEvent['type'];

export interface RenderedNotification {
  category: NotificationCategory;
  title: string;
  body: string;
  link: string;
}

// ---------------------------------------------------------------------------
// renderEvent — pure, deterministic, no PII beyond what the recipient sees
// ---------------------------------------------------------------------------

export function renderEvent(event: NotificationEvent): RenderedNotification {
  switch (event.type) {
    case 'consultant.assigned': {
      const name = event.data?.consultantName ?? 'a consultant';
      return {
        category: 'assignment',
        title: 'Consultant assigned',
        body: `${name} has been assigned to your application.`,
        link: `/applications/${event.applicationId}`,
      };
    }

    case 'payment.received': {
      const amount = event.data?.amountLabel ?? 'your payment';
      const tier = event.data?.tier ? ` (${event.data.tier} plan)` : '';
      return {
        category: 'billing',
        title: 'Payment received',
        body: `We received ${amount}${tier}. Thank you!`,
        link: '/billing',
      };
    }

    case 'ai.assessment_complete': {
      const scoreText =
        event.data?.score !== undefined
          ? ` Your readiness score is ${event.data.score}.`
          : '';
      return {
        category: 'ai',
        title: 'AI assessment complete',
        body: `Your application assessment has finished.${scoreText}`,
        link: `/applications/${event.applicationId}`,
      };
    }

    case 'application.status_changed': {
      const { status } = event.data;
      return {
        category: 'application',
        title: 'Application status updated',
        body: `Your application status changed to "${status}".`,
        link: `/applications/${event.applicationId}`,
      };
    }

    case 'system.broadcast': {
      // Admin-authored copy — the catalog does not synthesize it.
      return {
        category: event.data.category,
        title: event.data.title,
        body: event.data.body,
        link: event.data.link,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// entityIdOf — stable entity id used for deduplication
// ---------------------------------------------------------------------------

export function entityIdOf(event: NotificationEvent): string {
  switch (event.type) {
    case 'consultant.assigned':
    case 'ai.assessment_complete':
      return event.applicationId;
    // Include the status so each transition of the same application is a
    // distinct dedupe key — otherwise the second status change collides with
    // the first and is silently swallowed by the in-app dedupe gate.
    case 'application.status_changed':
      return `${event.applicationId}:${event.data.status}`;
    case 'payment.received':
      return event.paymentId;
    case 'system.broadcast':
      return event.broadcastId;
  }
}
