import { SYNC_MINUTE_OFFSET, VisaSyncScheduler } from './visa-sync.scheduler';
import {
  DOC_MINUTE_OFFSET,
  withMinuteOffset,
} from '../doc-templates/doc-refresh.scheduler';
import { scheduleFor } from '../forms/refresh-schedule';

function fakeQueue() {
  const added: Array<{ name: string; opts: Record<string, unknown> }> = [];
  return {
    added,
    queue: {
      add: async (
        name: string,
        _data: unknown,
        opts: Record<string, unknown>,
      ) => {
        added.push({ name, opts });
      },
    } as never,
  };
}

describe('VisaSyncScheduler', () => {
  it('registers one repeatable job with a stable id', async () => {
    const { queue, added } = fakeQueue();
    await new VisaSyncScheduler(queue).onModuleInit();

    expect(added).toHaveLength(1);
    expect(added[0].name).toBe('visa-source-sync');
    // A stable jobId is what stops every deploy adding another schedule.
    expect(added[0].opts.jobId).toBe('visa-source-sync:ALL');
  });

  it('runs an hour after the form and document refreshes on the same hosts', () => {
    // THE FAILURE THIS PREVENTS ALREADY HAPPENED. canada.ca serves the blank
    // forms, the document checklists AND the requirement pages. Three jobs
    // landing on one government host in the same minute is the shape that got
    // VisaAI rate-limited by the European Commission on 2026-08-13.
    const base = scheduleFor('CA', 'form-refresh').pattern;
    const forms = base;
    const docs = withMinuteOffset(base, DOC_MINUTE_OFFSET);
    const sync = withMinuteOffset(
      scheduleFor('ALL', 'visa-source-sync').pattern,
      SYNC_MINUTE_OFFSET,
    );

    const minuteOf = (p: string) => p.split(' ')[0];
    const hourOf = (p: string) => p.split(' ')[1];
    const slot = (p: string) => `${hourOf(p)}:${minuteOf(p)}`;

    expect(new Set([slot(forms), slot(docs), slot(sync)]).size).toBe(3);
  });

  it('offsets are distinct, so no two jobs can share a slot by construction', () => {
    expect(SYNC_MINUTE_OFFSET).not.toBe(DOC_MINUTE_OFFSET);
    expect(SYNC_MINUTE_OFFSET).not.toBe(0);
  });

  it('rolls the hour rather than emitting a minute cron rejects', () => {
    // A country hashed to minute 45 plus a 60-minute offset is minute 105.
    // Emitting that would be silently invalid and the schedule would never
    // fire — the same trap doc-refresh.scheduler.ts documents.
    const rolled = withMinuteOffset('45 9 * * *', SYNC_MINUTE_OFFSET);
    const [minute, hour] = rolled.split(' ');
    expect(Number(minute)).toBeGreaterThanOrEqual(0);
    expect(Number(minute)).toBeLessThan(60);
    expect(Number(hour)).toBeGreaterThanOrEqual(0);
    expect(Number(hour)).toBeLessThan(24);
    expect(rolled).toBe('45 10 * * *');
  });

  it('carries a timezone, so the check runs in the authority’s morning', () => {
    const { queue, added } = fakeQueue();
    return new VisaSyncScheduler(queue).onModuleInit().then(() => {
      const repeat = added[0].opts.repeat as { tz?: string; pattern?: string };
      expect(repeat.tz).toBeTruthy();
      expect(repeat.pattern).toMatch(/^\d+ \d+ \* \* \*$/);
    });
  });
});
