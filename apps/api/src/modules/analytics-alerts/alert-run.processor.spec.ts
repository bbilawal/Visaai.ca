import { AlertRunProcessor } from './alert-run.processor';

function deps(rule: any) {
  const repo = {
    listDueRules: jest.fn().mockResolvedValue([rule]),
    updateState: jest.fn().mockResolvedValue(undefined),
    insertEvent: jest.fn().mockResolvedValue(undefined),
  } as any;
  const notifier = { fire: jest.fn().mockResolvedValue(undefined) } as any;
  return { repo, notifier };
}
const baseRule = {
  id: 'a1',
  name: 'MRR floor',
  state: 'ok',
  notifyUserIds: ['u1'],
  lastTransitionAt: null,
};

describe('AlertRunProcessor', () => {
  it('ok -> breach: persists breached, inserts event, notifies', async () => {
    const { repo, notifier } = deps({ ...baseRule });
    const evaluator = {
      evaluate: jest.fn().mockResolvedValue({ breached: true, actual: 84000 }),
    } as any;
    const proc = new AlertRunProcessor(repo, evaluator, notifier);
    await proc.process({ name: 'tick' } as any);
    expect(repo.updateState).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ state: 'breached' }),
    );
    expect(repo.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'a1', kind: 'breach' }),
    );
    expect(notifier.fire).toHaveBeenCalled();
  });
  it('steady breach: no event, no notify', async () => {
    const { repo, notifier } = deps({ ...baseRule, state: 'breached' });
    const evaluator = {
      evaluate: jest.fn().mockResolvedValue({ breached: true, actual: 84000 }),
    } as any;
    const proc = new AlertRunProcessor(repo, evaluator, notifier);
    await proc.process({ name: 'tick' } as any);
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(notifier.fire).not.toHaveBeenCalled();
  });
  it('breach -> ok: fires recovery', async () => {
    const { repo } = deps({ ...baseRule, state: 'breached' });
    const notifier = { fire: jest.fn().mockResolvedValue(undefined) } as any;
    const evaluator = {
      evaluate: jest
        .fn()
        .mockResolvedValue({ breached: false, actual: 105000 }),
    } as any;
    const proc = new AlertRunProcessor(repo, evaluator, notifier);
    await proc.process({ name: 'tick' } as any);
    expect(repo.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'recovery' }),
    );
  });
  it('one throwing rule does not stop the others', async () => {
    const repo = {
      listDueRules: jest.fn().mockResolvedValue([
        { ...baseRule, id: 'bad' },
        { ...baseRule, id: 'good' },
      ]),
      updateState: jest.fn().mockResolvedValue(undefined),
      insertEvent: jest.fn().mockResolvedValue(undefined),
    } as any;
    const notifier = { fire: jest.fn().mockResolvedValue(undefined) } as any;
    const evaluator = {
      evaluate: jest
        .fn()
        .mockImplementation((r: any) =>
          r.id === 'bad'
            ? Promise.reject(new Error('x'))
            : Promise.resolve({ breached: true, actual: 1 }),
        ),
    } as any;
    const proc = new AlertRunProcessor(repo, evaluator, notifier);
    await proc.process({ name: 'tick' } as any);
    expect(repo.updateState).toHaveBeenCalledWith('good', expect.anything());
  });

  it('an unevaluable rule does NOT walk a breached alert back to ok', async () => {
    // The failure this guards against is a FALSE ALL-CLEAR. transition() maps
    // ('breached', false) to a recovery, so returning "not breached" when the
    // metric could not be resolved — a typo'd metricKey, a rollup outage, a
    // renamed metric — announced that a still-broken thing had been fixed.
    const { repo, notifier } = deps({ ...baseRule, state: 'breached' });
    const evaluator = {
      evaluate: jest.fn().mockResolvedValue({ breached: null, actual: null }),
    } as any;
    await new AlertRunProcessor(repo, evaluator, notifier).process({
      name: 'tick',
    } as any);

    expect(repo.updateState).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ state: 'breached' }),
    );
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(notifier.fire).not.toHaveBeenCalled();
  });

  it('an unevaluable rule does not invent a breach either', async () => {
    const { repo, notifier } = deps({ ...baseRule, state: 'ok' });
    const evaluator = {
      evaluate: jest.fn().mockResolvedValue({ breached: null, actual: null }),
    } as any;
    await new AlertRunProcessor(repo, evaluator, notifier).process({
      name: 'tick',
    } as any);

    expect(repo.updateState).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ state: 'ok' }),
    );
    expect(notifier.fire).not.toHaveBeenCalled();
  });

  it('still records that the attempt happened, so silence is distinguishable from health', async () => {
    // Without lastEvaluatedAt moving, a rule that has failed to evaluate for a
    // week looks identical to one that has been quietly fine.
    const { repo, notifier } = deps({ ...baseRule, state: 'ok' });
    const evaluator = {
      evaluate: jest.fn().mockResolvedValue({ breached: null, actual: null }),
    } as any;
    await new AlertRunProcessor(repo, evaluator, notifier).process({
      name: 'tick',
    } as any);

    expect(repo.updateState).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ lastEvaluatedAt: expect.any(String) }),
    );
  });
});
