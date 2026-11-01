import { computeDashboard } from './dashboard';
import type { ConsultantQueueItem, ConsultantQueueResult } from '@visaai/types';

const NOW = new Date('2026-06-29T12:00:00Z');

function item(p: Partial<ConsultantQueueItem>): ConsultantQueueItem {
  return {
    id: p.id ?? 'a',
    destination_country: p.destination_country ?? 'CA',
    status: p.status ?? 'in_review',
    assignment_status: p.assignment_status ?? 'ASSIGNED',
    visa_type: p.visa_type ?? 'visitor',
    created_at: p.created_at ?? '2026-06-20T00:00:00Z',
    due_at: p.due_at ?? null,
    completed_at: p.completed_at ?? null,
  };
}

describe('computeDashboard', () => {
  it('counts assigned, newRequests, awaitingReview and highPriority', () => {
    const result: ConsultantQueueResult = {
      queue: [item({ id: 'q1' }), item({ id: 'q2' })],
      mine: [
        item({ id: 'm1', due_at: '2026-06-29T18:00:00Z' }), // due today, active -> high priority
        item({ id: 'm2', due_at: '2026-06-28T00:00:00Z' }), // overdue, active -> high priority
        item({ id: 'm3', due_at: '2026-07-10T00:00:00Z' }), // far future, active
        item({ id: 'm4', completed_at: '2026-06-27T00:00:00Z' }), // completed -> not awaiting
      ],
    };
    const d = computeDashboard(result, NOW);
    expect(d.counts.assigned).toBe(4);
    expect(d.counts.newRequests).toBe(2);
    expect(d.counts.awaitingReview).toBe(3); // m1,m2,m3
    expect(d.counts.highPriority).toBe(2); // m1 (<=24h), m2 (overdue)
  });

  it('buckets workload into today and week, excluding completed', () => {
    const result: ConsultantQueueResult = {
      queue: [],
      mine: [
        item({ id: 'm1', due_at: '2026-06-29T23:00:00Z' }), // today + week
        item({ id: 'm2', due_at: '2026-07-02T00:00:00Z' }), // week only
        item({ id: 'm3', due_at: '2026-07-20T00:00:00Z' }), // outside week
        item({
          id: 'm4',
          due_at: '2026-06-29T20:00:00Z',
          completed_at: '2026-06-29T21:00:00Z',
        }),
      ],
    };
    const d = computeDashboard(result, NOW);
    expect(d.workload.today).toBe(1); // m1
    expect(d.workload.week).toBe(2); // m1, m2
  });

  it('orders highPriorityCases by soonest due_at and caps at 5', () => {
    const mine = Array.from({ length: 7 }, (_, i) =>
      item({ id: `m${i}`, due_at: `2026-06-${10 + i}T00:00:00Z` }),
    );
    const d = computeDashboard({ queue: [], mine }, NOW);
    expect(d.highPriorityCases).toHaveLength(5);
    expect(d.highPriorityCases[0].id).toBe('m0'); // earliest due_at first
  });

  it('awaitingReview is ordered newest created_at first and capped at 5', () => {
    const mine = [
      item({ id: 'a1', created_at: '2026-06-21T00:00:00Z' }),
      item({ id: 'a2', created_at: '2026-06-22T00:00:00Z' }),
      item({ id: 'a3', created_at: '2026-06-23T00:00:00Z' }),
      item({ id: 'a4', created_at: '2026-06-24T00:00:00Z' }),
      item({ id: 'a5', created_at: '2026-06-25T00:00:00Z' }),
      item({ id: 'a6', created_at: '2026-06-29T00:00:00Z' }), // newest active
      item({
        id: 'c1',
        created_at: '2026-06-28T00:00:00Z',
        completed_at: '2026-06-28T12:00:00Z',
      }), // completed — must be excluded
    ];
    const d = computeDashboard({ queue: [], mine }, NOW);
    expect(d.awaitingReview).toHaveLength(5); // capped at 5
    expect(d.awaitingReview[0].id).toBe('a6'); // newest created_at is first
    expect(d.awaitingReview.find((i) => i.id === 'c1')).toBeUndefined(); // completed excluded
  });

  it('excludes completed items from highPriority counts and lists even when due_at qualifies', () => {
    const mine = [
      // active + overdue -> counts as 1 high-priority case
      item({ id: 'active1', due_at: '2026-06-28T00:00:00Z' }),
      // completed + overdue -> MUST NOT count or appear in any high-priority output
      item({
        id: 'done1',
        due_at: '2026-06-27T00:00:00Z',
        completed_at: '2026-06-28T06:00:00Z',
      }),
    ];
    const d = computeDashboard({ queue: [], mine }, NOW);
    expect(d.counts.highPriority).toBe(1); // only active1, not done1
    expect(d.highPriorityCases.find((i) => i.id === 'done1')).toBeUndefined();
    expect(d.awaitingReview.find((i) => i.id === 'done1')).toBeUndefined();
  });
});
