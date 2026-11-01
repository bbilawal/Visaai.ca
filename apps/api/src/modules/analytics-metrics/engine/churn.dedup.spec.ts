import { dedupeChurn } from './churn.dedup';

describe('dedupeChurn', () => {
  it('a sub that fails payment AND cancels counts once, voluntary wins', () => {
    const out = dedupeChurn([
      { subscriptionId: 'sub_1', day: '2026-07-03', kind: 'involuntary' },
      { subscriptionId: 'sub_1', day: '2026-07-05', kind: 'voluntary' },
    ]);
    expect(out).toEqual([
      { subscriptionId: 'sub_1', day: '2026-07-05', kind: 'voluntary' },
    ]);
  });
  it('keeps distinct subs separate', () => {
    const out = dedupeChurn([
      { subscriptionId: 'sub_1', day: '2026-07-03', kind: 'voluntary' },
      { subscriptionId: 'sub_2', day: '2026-07-04', kind: 'involuntary' },
    ]);
    expect(out).toHaveLength(2);
  });
  it('within the same kind keeps the earliest day', () => {
    const out = dedupeChurn([
      { subscriptionId: 'sub_1', day: '2026-07-10', kind: 'involuntary' },
      { subscriptionId: 'sub_1', day: '2026-07-03', kind: 'involuntary' },
    ]);
    expect(out).toEqual([
      { subscriptionId: 'sub_1', day: '2026-07-03', kind: 'involuntary' },
    ]);
  });
});
