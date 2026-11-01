import type { FunnelStepRow } from '../source/kpi-source.repository';

export function buildFunnel(rows: FunnelStepRow[]) {
  const byStep = new Map<
    number,
    { step: string; stepIndex: number; entered: number; converted: number }
  >();
  for (const r of rows) {
    const cur = byStep.get(r.stepIndex) ?? {
      step: r.step,
      stepIndex: r.stepIndex,
      entered: 0,
      converted: 0,
    };
    cur.entered += r.entered;
    cur.converted += r.converted;
    byStep.set(r.stepIndex, cur);
  }
  const steps = [...byStep.values()]
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .map((s) => ({
      ...s,
      rate: s.entered === 0 ? 0 : s.converted / s.entered,
    }));
  const firstEntered = steps[0]?.entered ?? 0;
  const lastConverted = steps.at(-1)?.converted ?? 0;
  const overallRate = firstEntered === 0 ? 0 : lastConverted / firstEntered;
  return { steps, overallRate };
}
