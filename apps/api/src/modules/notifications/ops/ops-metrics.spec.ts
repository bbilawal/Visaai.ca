import { shapeOpsMetrics } from './ops-metrics';

const q = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

describe('shapeOpsMetrics', () => {
  it('fills every status key and totals the statuses', () => {
    const m = shapeOpsMetrics({
      range: '7d',
      statusCounts: { sent: 5, failed: 2 },
      channelCounts: { email: 7 },
      eventCounts: { 'payment.received': 7 },
      queue: { ...q, waiting: 3 },
    });
    expect(m.byStatus.sent).toBe(5);
    expect(m.byStatus.failed).toBe(2);
    expect(m.byStatus.queued).toBe(0); // missing → 0
    expect(m.total).toBe(7); // 5 + 2
    expect(m.range).toBe('7d');
    expect(m.byChannel.email).toBe(7);
    expect(m.queue.waiting).toBe(3);
  });

  it('is all-zero for an empty range (no fabrication)', () => {
    const m = shapeOpsMetrics({
      range: '24h',
      statusCounts: {},
      channelCounts: {},
      eventCounts: {},
      queue: q,
    });
    expect(m.total).toBe(0);
    expect(Object.values(m.byStatus).every((n) => n === 0)).toBe(true);
    expect(m.byChannel).toEqual({});
    expect(m.byEvent).toEqual({});
  });

  it('returns copies (mutating output does not affect input)', () => {
    const raw = {
      range: '30d' as const,
      statusCounts: { sent: 1 },
      channelCounts: { sms: 1 },
      eventCounts: {},
      queue: { ...q },
    };
    const m = shapeOpsMetrics(raw);
    m.byChannel.sms = 999;
    m.queue.waiting = 999;
    expect(raw.channelCounts.sms).toBe(1);
    expect(raw.queue.waiting).toBe(0);
  });
});
