import { buildFunnel } from './funnel.builder';

describe('buildFunnel', () => {
  it('aggregates steps across days and computes conversion rates', () => {
    const f = buildFunnel([
      {
        day: '2026-07-01',
        funnel: 'approval',
        step: 'submitted',
        stepIndex: 0,
        dimVal: '',
        entered: 100,
        converted: 100,
      },
      {
        day: '2026-07-02',
        funnel: 'approval',
        step: 'submitted',
        stepIndex: 0,
        dimVal: '',
        entered: 50,
        converted: 50,
      },
      {
        day: '2026-07-01',
        funnel: 'approval',
        step: 'approved',
        stepIndex: 1,
        dimVal: '',
        entered: 150,
        converted: 90,
      },
    ]);
    expect(f.steps[0]).toMatchObject({
      step: 'submitted',
      entered: 150,
      converted: 150,
    });
    expect(f.steps[1]).toMatchObject({
      step: 'approved',
      entered: 150,
      converted: 90,
    });
    expect(f.overallRate).toBeCloseTo(0.6);
  });
});
