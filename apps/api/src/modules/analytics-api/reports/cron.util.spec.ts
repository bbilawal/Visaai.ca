import { nextRunAt } from './cron.util';

describe('nextRunAt', () => {
  it('computes the next occurrence after a given time', () => {
    // every day at 08:00 UTC; after 2026-07-09T09:00Z -> next is 2026-07-10T08:00Z
    const next = nextRunAt('0 8 * * *', new Date('2026-07-09T09:00:00Z'));
    expect(next).toBe('2026-07-10T08:00:00.000Z');
  });
});
