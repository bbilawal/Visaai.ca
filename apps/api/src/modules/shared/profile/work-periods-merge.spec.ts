import { mergeProfileUpdate } from './family-members';

const HISTORY = [
  { from: '2016-06', to: '2016-09', activity: 'unemployed', city: 'Gujrat', country: 'Pakistan' },
  { from: '2016-10', to: '2025-05', activity: 'ran own business', employer: 'Acme Blocks', city: 'Gujrat', country: 'Pakistan' },
];

describe('work history updates merge by start month (live E2E 2026-10-19)', () => {
  it('pieces for one recorded period merge into it and keep the others', () => {
    const out = mergeProfileUpdate(
      { work_history: HISTORY },
      { work_history: [{ from: '2016-10', address: 'GT Road', duties: 'Ran production', city: '' }] },
    );
    expect(out.work_history).toEqual([
      HISTORY[0],
      { ...HISTORY[1], address: 'GT Road', duties: 'Ran production' },
    ]);
  });

  it('a restated list with a new period replaces the old one', () => {
    const restated = [{ from: '2015-01', to: '2016-05', activity: 'Clerk' }, ...HISTORY];
    expect(mergeProfileUpdate({ work_history: HISTORY }, { work_history: restated }).work_history).toEqual(restated);
  });

  it('a first answer is stored as given', () => {
    expect(mergeProfileUpdate({}, { work_history: HISTORY }).work_history).toEqual(HISTORY);
  });
});

describe('period merge edge cases (review)', () => {
  it('a fragment with no start month, or another format, never wipes the list', () => {
    expect(
      mergeProfileUpdate({ work_history: HISTORY }, { work_history: [{ duties: 'x' }] }).work_history,
    ).toEqual(HISTORY);
    const out = mergeProfileUpdate(
      { work_history: HISTORY },
      { work_history: [{ from: 'Oct 2016', duties: 'Ran production' }] },
    ).work_history as Record<string, unknown>[];
    expect(out).toHaveLength(2);
    expect(out[1].duties).toBe('Ran production');
  });

  it('one new whole period is added, not a replacement of the whole list', () => {
    const out = mergeProfileUpdate(
      { work_history: HISTORY },
      { work_history: [{ from: '2010-01', to: '2016-05', activity: 'Clerk' }] },
    ).work_history as unknown[];
    expect(out).toHaveLength(3);
  });

  it('a restated list with a corrected start month replaces the record (no overlap)', () => {
    const fixed = [HISTORY[0], { ...HISTORY[1], from: '2016-11' }];
    expect(mergeProfileUpdate({ work_history: HISTORY }, { work_history: fixed }).work_history).toEqual(
      fixed,
    );
  });

  it('a fragment for a period with no start month matches by employer', () => {
    const rows = [HISTORY[0], { to: '2025-05', activity: 'ran own business', employer: 'Acme Blocks' }];
    const out = mergeProfileUpdate(
      { work_history: rows },
      { work_history: [{ employer: 'Acme Blocks', duties: 'Ran production' }] },
    ).work_history as Record<string, unknown>[];
    expect(out.find((r) => r.employer === 'Acme Blocks')?.duties).toBe('Ran production');
  });

  it('remove: true takes a period out', () => {
    expect(
      mergeProfileUpdate({ work_history: HISTORY }, { work_history: [{ from: '2016-06', remove: true }] })
        .work_history,
    ).toEqual([HISTORY[1]]);
  });

  it('two periods starting the same month are told apart by employer, else left alone', () => {
    const two = [
      { from: '2018-01', to: '2019-01', activity: 'Clerk', employer: 'A' },
      { from: '2018-01', to: '2019-06', activity: 'Clerk', employer: 'B' },
    ];
    const out = mergeProfileUpdate(
      { work_history: two },
      { work_history: [{ from: '2018-01', employer: 'B', duties: 'Filing' }] },
    ).work_history as Record<string, unknown>[];
    expect(out[0].duties).toBeUndefined();
    expect(out[1].duties).toBe('Filing');
    expect(
      mergeProfileUpdate({ work_history: two }, { work_history: [{ from: '2018-01', duties: 'Filing' }] })
        .work_history,
    ).toEqual(two);
  });

  it('a full restated list replaces the record', () => {
    const restated = [
      { from: '2010-01', to: '2012-01', activity: 'Clerk' },
      { from: '2012-02', to: '2025-05', activity: 'Manager' },
    ];
    expect(mergeProfileUpdate({ work_history: HISTORY }, { work_history: restated }).work_history).toEqual(
      restated,
    );
  });
});
