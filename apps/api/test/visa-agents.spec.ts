import type OpenAI from 'openai';
import {
  CopywriterAgent,
  ProfileEvaluatorAgent,
  VisaResearchAgent,
} from '../src/modules/visa/visa.agents';
import {
  VisaOrchestrationEngine,
  VisaStageError,
} from '../src/modules/visa/visa-orchestration.service';
import type {
  EvaluationOutput,
  ResearchOutput,
} from '../src/modules/visa/visa.schemas';
import { modelForTask } from '../src/modules/shared/ai/model-factory';
import { TIER_ORDER } from '../src/modules/shared/ai/model-policy';
import { AI_TASKS } from '../src/modules/shared/ai/task-registry';

const RESEARCH: ResearchOutput = {
  visa_class: 'H-1B',
  mandatory_documents: ['passport', 'I-129', 'degree'],
  financial_threshold_usd: 0,
  critical_immigration_rules: [
    'specialty occupation',
    'employer sponsorship required',
  ],
};
const EVAL: EvaluationOutput = {
  calculated_success_probability: 72,
  risk_factors: ['lottery selection'],
  critical_gaps: ['no LCA yet'],
  mitigation_strategies: ['file LCA early'],
};

const parsed = (obj: unknown) => ({ choices: [{ message: { parsed: obj } }] });
const content = (md: string) => ({ choices: [{ message: { content: md } }] });

function rig() {
  const parse = jest.fn();
  const create = jest.fn();
  const client = {
    chat: { completions: { parse, create } },
  } as unknown as OpenAI;
  const research = new VisaResearchAgent(client);
  const evaluator = new ProfileEvaluatorAgent(client);
  const copywriter = new CopywriterAgent(client);
  const engine = new VisaOrchestrationEngine(research, evaluator, copywriter);
  return { parse, create, research, evaluator, copywriter, engine };
}

const INPUT = {
  country: 'USA',
  visaType: 'H-1B',
  profile: 'MSc CS, 3y exp, employer ready',
};

describe('Visa multi-agent pipeline (mocked OpenAI client)', () => {
  it('runs research -> evaluation -> copywriter in order, one call each', async () => {
    const { parse, create, engine } = rig();
    parse
      .mockResolvedValueOnce(parsed(RESEARCH))
      .mockResolvedValueOnce(parsed(EVAL));
    create.mockResolvedValue(content('## Success Probability\n**72%**'));

    const r = await engine.run(INPUT);

    expect(r.research).toEqual(RESEARCH);
    expect(r.evaluation).toMatchObject({ calculated_success_probability: 72 });
    expect(r.report).toContain('72%');
    expect(parse).toHaveBeenCalledTimes(2); // research + evaluation, no redundancy
    expect(create).toHaveBeenCalledTimes(1); // copywriter once
    // Model routing, asserted against the registry rather than a literal: the
    // property that matters is that the estimate runs on a cheaper tier than
    // the evaluation, and that holds across any future model change.
    expect(parse.mock.calls[0][0].model).toBe(
      modelForTask('visa_requirement_estimate'),
    );
    expect(parse.mock.calls[1][0].model).toBe(
      modelForTask('profile_evaluation'),
    );
    expect(create.mock.calls[0][0].model).toBe(
      modelForTask('recommendation_copy'),
    );
    // The evaluator must never be routed below the estimator.
    expect(
      TIER_ORDER.indexOf(AI_TASKS.profile_evaluation.defaultTier),
    ).toBeGreaterThan(
      TIER_ORDER.indexOf(AI_TASKS.visa_requirement_estimate.defaultTier),
    );
  });

  it.each([
    [150, 99],
    [100, 99],
    [0, 1],
    [-5, 1],
    [72.6, 73],
  ])(
    'clamps probability %p -> %p (never asserts certainty)',
    async (raw, expected) => {
      const { parse, evaluator } = rig();
      parse.mockResolvedValueOnce(
        parsed({ ...EVAL, calculated_success_probability: raw }),
      );
      const e = await evaluator.run(RESEARCH, 'profile');
      expect(e.calculated_success_probability).toBe(expected);
    },
  );

  it('maps a research-stage failure to VisaStageError(research)', async () => {
    const { parse, engine } = rig();
    parse.mockRejectedValue(new Error('boom'));
    await expect(engine.run(INPUT)).rejects.toMatchObject({
      name: 'VisaStageError',
      stage: 'research',
    });
  });

  it('maps an evaluation-stage failure to VisaStageError(evaluation)', async () => {
    const { parse, engine } = rig();
    parse
      .mockResolvedValueOnce(parsed(RESEARCH))
      .mockRejectedValue(new Error('eval down'));
    await expect(engine.run(INPUT)).rejects.toMatchObject({
      stage: 'evaluation',
    });
  });

  it('maps a copywriter-stage failure to VisaStageError(copywriter)', async () => {
    const { parse, create, engine } = rig();
    parse
      .mockResolvedValueOnce(parsed(RESEARCH))
      .mockResolvedValueOnce(parsed(EVAL));
    create.mockRejectedValue(new Error('md down'));
    await expect(engine.run(INPUT)).rejects.toMatchObject({
      stage: 'copywriter',
    });
  });

  it('retries a transient failure within an agent (2 attempts)', async () => {
    const { parse, research } = rig();
    parse
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(parsed(RESEARCH));
    const r = await research.run('USA', 'H-1B');
    expect(r).toEqual(RESEARCH);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('fails when the model returns no structured output', async () => {
    const { parse, research } = rig();
    parse.mockResolvedValue({ choices: [{ message: {} }] }); // no parsed
    await expect(research.run('USA', 'H-1B')).rejects.toThrow(
      /VisaResearchAgent failed/,
    );
  });

  it('VisaStageError is thrown (not the raw error) so the controller can map HTTP', async () => {
    const { parse, engine } = rig();
    parse.mockRejectedValue(new Error('x'));
    await expect(engine.run(INPUT)).rejects.toBeInstanceOf(VisaStageError);
  });
});
