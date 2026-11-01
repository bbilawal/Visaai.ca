import type {
  DeliveryStatus,
  NotificationOpsMetrics,
  NotificationOpsRange,
  NotificationQueueCounts,
} from '@visaai/types';

export interface OpsMetricsRaw {
  range: NotificationOpsRange;
  statusCounts: Partial<Record<DeliveryStatus, number>>;
  channelCounts: Record<string, number>;
  eventCounts: Record<string, number>;
  queue: NotificationQueueCounts;
}

const STATUSES: DeliveryStatus[] = [
  'queued',
  'sent',
  'failed',
  'skipped',
  'dead',
];

/**
 * Assemble the notification operations read-model from raw counts. Pure +
 * deterministic. Every status key is present (missing → 0); `total` is the sum
 * of the status counts. No fabricated numbers — an empty range yields all-zeros.
 */
export function shapeOpsMetrics(raw: OpsMetricsRaw): NotificationOpsMetrics {
  const byStatus = Object.fromEntries(
    STATUSES.map((s) => [s, raw.statusCounts[s] ?? 0]),
  ) as Record<DeliveryStatus, number>;
  const total = STATUSES.reduce((a, s) => a + byStatus[s], 0);
  return {
    range: raw.range,
    total,
    byStatus,
    byChannel: { ...raw.channelCounts },
    byEvent: { ...raw.eventCounts },
    queue: { ...raw.queue },
  };
}
