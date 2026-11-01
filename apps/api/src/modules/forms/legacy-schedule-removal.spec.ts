import { Queue } from 'bullmq';
import { FormRefreshScheduler } from './form-refresh.scheduler';
import { DocRefreshScheduler } from '../doc-templates/doc-refresh.scheduler';
import '../../strategies';

/**
 * The shape `getRepeatableJobs()` ACTUALLY returns.
 *
 * MEASURED against the live queue 2026-08-13: it carries `name` (the first
 * argument to queue.add) and `key`, and leaves `id` null — even when the job
 * was added with an explicit `jobId`. An earlier version of the removal matched
 * on `job.id`, never fired, and left the global 02:00 UTC schedule registered
 * alongside all 33 per-country ones: every government host would have been
 * crawled twice a day, which is how the European Commission rate-limited us in
 * the first place.
 */
const LEGACY_FORM_JOB = {
  key: 'cf6259f6e9ff8f3bea38665cf539a19a',
  name: 'daily-form-refresh',
  id: null,
  tz: null,
  pattern: '0 2 * * *',
  next: 0,
};

const LEGACY_DOC_JOB = {
  key: '2262e6f8b6bcc11cedf591455b902be6',
  name: 'daily-document-template-refresh',
  id: null,
  tz: null,
  pattern: '30 2 * * *',
  next: 0,
};

function fakeQueue(existing: unknown[]) {
  const removed: string[] = [];
  const added: {
    name: string;
    opts: { repeat?: { pattern: string; tz: string } };
  }[] = [];
  const queue = {
    getRepeatableJobs: () => Promise.resolve(existing),
    removeRepeatableByKey: (key: string) => {
      removed.push(key);
      return Promise.resolve(true);
    },
    add: (
      name: string,
      _data: unknown,
      opts: { repeat?: { pattern: string; tz: string } },
    ) => {
      added.push({ name, opts });
      return Promise.resolve({ id: '1' });
    },
  } as unknown as Queue;
  return { queue, removed, added };
}

describe('FormRefreshScheduler', () => {
  it('removes the legacy global schedule it finds by NAME', async () => {
    const { queue, removed, added } = fakeQueue([LEGACY_FORM_JOB]);

    await new FormRefreshScheduler(queue).onModuleInit();

    expect(removed).toEqual([LEGACY_FORM_JOB.key]);
    // And the per-country schedule replaced it.
    expect(added.length).toBeGreaterThan(20);
    for (const job of added) {
      expect(job.opts.repeat?.tz).toBeTruthy();
      expect(job.opts.repeat?.pattern).toMatch(/^\d{1,2} 9 \* \* \*$/);
    }
  });

  it('still schedules every country when the queue cannot be inspected', async () => {
    const { added } = fakeQueue([]);
    const queue = {
      getRepeatableJobs: () => Promise.reject(new Error('redis down')),
      removeRepeatableByKey: () => Promise.resolve(true),
      add: (name: string, _d: unknown, opts: unknown) => {
        added.push({ name, opts } as never);
        return Promise.resolve({ id: '1' });
      },
    } as unknown as Queue;

    await new FormRefreshScheduler(queue).onModuleInit();

    // Cleanup is best effort; keeping the caches fresh is not.
    expect(added.length).toBeGreaterThan(20);
  });
});

describe('DocRefreshScheduler', () => {
  it('removes its own legacy global schedule and offsets from the form run', async () => {
    const { queue, removed, added } = fakeQueue([LEGACY_DOC_JOB]);

    await new DocRefreshScheduler(queue).onModuleInit();

    expect(removed).toEqual([LEGACY_DOC_JOB.key]);
    // 30 minutes after that country's forms, rolling into hour 10 when the
    // staggered minute is late enough.
    for (const job of added) {
      expect(job.opts.repeat?.pattern).toMatch(/^\d{1,2} (9|10) \* \* \*$/);
    }
  });

  it('leaves another queue-mate alone', async () => {
    const { queue, removed } = fakeQueue([
      { ...LEGACY_DOC_JOB, name: 'country-document-refresh' },
    ]);
    await new DocRefreshScheduler(queue).onModuleInit();
    expect(removed).toEqual([]);
  });
});
