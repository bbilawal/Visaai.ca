import type {
  ConsultantDashboard,
  ConsultantQueueItem,
  ConsultantQueueResult,
} from '@visaai/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const isActive = (i: ConsultantQueueItem): boolean => !i.completed_at;

const dueMs = (i: ConsultantQueueItem): number | null =>
  i.due_at ? new Date(i.due_at).getTime() : null;

/** High priority = active assignment that is overdue or due within 24h. */
function isHighPriority(i: ConsultantQueueItem, now: number): boolean {
  if (!isActive(i)) return false;
  const due = dueMs(i);
  return due !== null && due - now <= DAY_MS;
}

function endOfDay(now: Date): number {
  const d = new Date(now);
  d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Pure consultant-dashboard aggregation over the queue result. No I/O — the
 * controller supplies the queue and the clock so this is fully unit-testable.
 */
export function computeDashboard(
  result: ConsultantQueueResult,
  now: Date,
): ConsultantDashboard {
  const nowMs = now.getTime();
  const { queue, mine } = result;

  const active = mine.filter(isActive);
  const todayEnd = endOfDay(now);
  const weekEnd = nowMs + 7 * DAY_MS;

  const inWindow = (i: ConsultantQueueItem, end: number): boolean => {
    const due = dueMs(i);
    return due !== null && due <= end;
  };

  const highPriorityCases = active
    .filter((i) => dueMs(i) !== null)
    .sort((a, b) => dueMs(a)! - dueMs(b)!)
    .slice(0, 5);

  const awaitingReview = [...active]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 5);

  return {
    counts: {
      assigned: mine.length,
      newRequests: queue.length,
      awaitingReview: active.length,
      highPriority: mine.filter((i) => isHighPriority(i, nowMs)).length,
    },
    workload: {
      today: active.filter((i) => inWindow(i, todayEnd)).length,
      week: active.filter((i) => inWindow(i, weekEnd)).length,
    },
    highPriorityCases,
    awaitingReview,
  };
}
