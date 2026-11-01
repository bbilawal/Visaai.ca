import { CronExpressionParser } from 'cron-parser';

/** Next occurrence of a cron expression strictly after `after`, as an ISO string (UTC). */
export function nextRunAt(cron: string, after: Date): string {
  const it = CronExpressionParser.parse(cron, {
    currentDate: after,
    tz: 'UTC',
  });
  return it.next().toDate().toISOString();
}
