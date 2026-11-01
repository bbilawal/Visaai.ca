import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { makeAskQuestionNode } from '../src/modules/intake/graphs/nodes/ask-question';
import type { IntakeState } from '../src/modules/intake/graphs/intake.state';

function freshState(over: Partial<IntakeState> = {}): IntakeState {
  return {
    applicationId: 'app-1',
    frameworkId: null,
    visaTypeId: null,
    destinationCountry: 'CA',
    destinationState: null,
    requirementsJson: {},
    profileJson: {},
    riskIndicators: [],
    checklistItems: [],
    suggestedVisaTypes: [],
    messages: [],
    isComplete: false,
    currentQuestion: null,
    checklistBuiltAt: null,
    profileChanges: [],
    ...over,
  };
}

describe('askQuestion first-turn short-circuit', () => {
  it('returns the canned purpose question instantly without calling the LLM (fresh discovery)', async () => {
    const invoke = jest.fn();
    const node = makeAskQuestionNode({ invoke } as never);

    const result = await node(freshState());

    expect(invoke).not.toHaveBeenCalled();
    expect(result.currentQuestion).toContain('purpose of your visit to Canada');
    expect(result.currentQuestion).toContain('Next question:');
    // It must be seeded into the transcript as an AI message so the graph
    // processes the user's reply as the answer to this question.
    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);
  });

  it('falls through to the LLM once the conversation has started', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValue(
        new AIMessage('Next question:\nHow long will you stay?'),
      );
    const node = makeAskQuestionNode({ invoke } as never);

    const result = await node(
      freshState({
        messages: [new AIMessage('purpose?'), new HumanMessage('tourism')],
        profileJson: { purpose: 'tourism' },
      }),
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.currentQuestion).toContain('How long will you stay?');
  });

  it('does not short-circuit in tailored mode (framework already chosen)', async () => {
    const invoke = jest.fn().mockResolvedValue(new AIMessage('Tailored Q1'));
    const node = makeAskQuestionNode({ invoke } as never);

    await node(freshState({ frameworkId: 'fw-1' }));

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

/**
 * The applicant used to watch a static "Thinking…" bubble for the whole
 * generation. The node now surfaces the reply chunk by chunk when a sink is
 * supplied — but ONLY then: every non-socket caller still takes `.invoke()`,
 * which cannot half-emit if the model errors mid-reply.
 */
describe('askQuestion streaming', () => {
  function streamOf(chunks: string[]) {
    return jest.fn().mockResolvedValue(
      (function* () {
        for (const content of chunks) yield { content };
      })(),
    );
  }

  const started = freshState({
    messages: [new AIMessage('purpose?'), new HumanMessage('tourism')],
    profileJson: { purpose: 'tourism' },
  });

  it('emits each chunk and returns exactly what was emitted', async () => {
    const stream = streamOf([
      'Next question:\n',
      'How long ',
      'will you stay?',
    ]);
    const seen: string[] = [];
    const node = makeAskQuestionNode(
      { stream, invoke: jest.fn() } as never,
      null,
      { onToken: (d) => seen.push(d) },
    );

    const result = await node(started);

    expect(seen).toEqual(['Next question:\n', 'How long ', 'will you stay?']);
    // The transcript and the preview must not be able to disagree.
    expect(result.currentQuestion).toBe(seen.join(''));
  });

  it('uses invoke, not stream, when no sink is supplied', async () => {
    const stream = streamOf(['unused']);
    const invoke = jest.fn().mockResolvedValue(new AIMessage('Single shot'));
    const node = makeAskQuestionNode({ stream, invoke } as never);

    const result = await node(started);

    expect(stream).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.currentQuestion).toBe('Single shot');
  });

  it('never streams the deterministic first turn (no LLM call at all)', async () => {
    const stream = streamOf(['should not run']);
    const onToken = jest.fn();
    const node = makeAskQuestionNode(
      { stream, invoke: jest.fn() } as never,
      null,
      { onToken },
    );

    const result = await node(freshState());

    expect(stream).not.toHaveBeenCalled();
    expect(onToken).not.toHaveBeenCalled();
    expect(result.currentQuestion).toContain('purpose of your visit to Canada');
  });

  it('skips non-text chunks instead of stringifying them into the reply', async () => {
    // Content blocks and empty keep-alives both occur in practice; either one
    // rendered as "[object Object]" would land in the applicant's transcript.
    const stream = jest.fn().mockResolvedValue(
      (function* () {
        yield { content: 'Where ' };
        yield { content: [{ type: 'text', text: 'will you ' }] };
        yield { content: '' };
        yield { content: [{ type: 'tool_use', id: 't1' }] };
        yield { content: 'stay?' };
      })(),
    );
    const seen: string[] = [];
    const node = makeAskQuestionNode(
      { stream, invoke: jest.fn() } as never,
      null,
      { onToken: (d) => seen.push(d) },
    );

    const result = await node(started);

    expect(result.currentQuestion).toBe('Where will you stay?');
    expect(seen.join('')).toBe('Where will you stay?');
  });
});

/**
 * `onReady` is what lets the turn be delivered without waiting for the sibling
 * `update_checklist` branch. It has to fire on BOTH question paths — the
 * deterministic first turn included, which never touches the model.
 */
describe('askQuestion onReady', () => {
  const started = freshState({
    messages: [new AIMessage('purpose?'), new HumanMessage('tourism')],
    profileJson: { purpose: 'tourism' },
  });

  it('reports the finished question, matching what the node returns', async () => {
    const invoke = jest.fn().mockResolvedValue(new AIMessage('How long?'));
    const onReady = jest.fn();
    const node = makeAskQuestionNode({ invoke } as never, null, { onReady });

    const result = await node(started);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('How long?', false);
    expect(result.currentQuestion).toBe('How long?');
  });

  it('fires on the deterministic first turn too, with no LLM call', async () => {
    const invoke = jest.fn();
    const onReady = jest.fn();
    const node = makeAskQuestionNode({ invoke } as never, null, { onReady });

    const result = await node(freshState());

    expect(invoke).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(result.currentQuestion, false);
  });

  it('passes isComplete through — check_complete has already run', async () => {
    const invoke = jest.fn().mockResolvedValue(new AIMessage('Last one?'));
    const onReady = jest.fn();
    const node = makeAskQuestionNode({ invoke } as never, null, { onReady });

    await node({ ...started, isComplete: true });

    expect(onReady).toHaveBeenCalledWith('Last one?', true);
  });

  it('does not fire when the model throws', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('boom'));
    const onReady = jest.fn();
    const node = makeAskQuestionNode({ invoke } as never, null, { onReady });

    await expect(node(started)).rejects.toThrow('boom');
    expect(onReady).not.toHaveBeenCalled();
  });
});

/**
 * Dry run 2026-10-14: the discovery prompt asked "Which of these would you
 * like to apply for?" and told the model to confirm the chat choice — but a
 * chat reply never writes applications.visa_type_id (only the selector's
 * PATCH does), so the dropdown stayed "Not chosen yet", the graph stayed in
 * discovery mode and the registry checklist never loaded. The prompt must
 * send the applicant to the selector and must not pretend the choice stuck.
 */
describe('askQuestion discovery prompt — visa type selection', () => {
  const started = freshState({
    messages: [new AIMessage('purpose?'), new HumanMessage('family visit')],
    profileJson: { purpose_of_visit: 'family visit' },
  });

  async function systemPromptFor(state: IntakeState): Promise<string> {
    const invoke = jest.fn().mockResolvedValue(new AIMessage('Q'));
    const node = makeAskQuestionNode({ invoke } as never);
    await node(state);
    const sent = invoke.mock.calls[0][0] as Array<{ content: unknown }>;
    return String(sent[0].content);
  }

  it('points the applicant at the "Which visa are you applying for?" selector', async () => {
    const prompt = await systemPromptFor(started);
    expect(prompt).toContain('Which visa are you applying for?');
    expect(prompt).toMatch(/selector/i);
  });

  it('no longer asks the applicant to pick a route in chat or confirms a chat choice', async () => {
    const prompt = await systemPromptFor(started);
    expect(prompt).not.toContain('Which of these would you like to apply for?');
    expect(prompt).not.toContain(
      'After the user picks a visa type, confirm the choice',
    );
  });

  it('forbids claiming the choice was recorded when it is only named in chat', async () => {
    const prompt = await systemPromptFor(started);
    expect(prompt).toMatch(
      /do NOT (say|claim|tell)[^.]*(recorded|saved|selected|locked)/i,
    );
  });

  it('tailored mode prompt does not carry the discovery recommendation block', async () => {
    const prompt = await systemPromptFor({ ...started, frameworkId: 'fw-1' });
    expect(prompt).not.toContain('RECOMMENDING VISA TYPES');
  });
});

/**
 * Dry run 2026-10-14 (app 71ad0c29): the TRV route WAS set via the selector,
 * yet every later turn re-ran the discovery "Recommended visa types … " block.
 * Registry-sourced routes are keyed on visaTypeId and never set a legacy
 * frameworkId, while the node decided discovery mode on frameworkId alone.
 */
describe('askQuestion with a registry route chosen (visaTypeId set, no frameworkId)', () => {
  const routed = freshState({
    visaTypeId: 'vt-trv',
    frameworkId: null,
    messages: [new AIMessage('purpose?'), new HumanMessage('family visit')],
    profileJson: { purpose_of_visit: 'family visit' },
  });

  async function sentTo(state: IntakeState) {
    const invoke = jest.fn().mockResolvedValue(new AIMessage('Q'));
    const node = makeAskQuestionNode({ invoke } as never);
    await node(state);
    const sent = invoke.mock.calls[0][0] as Array<{ content: unknown }>;
    return {
      system: String(sent[0].content),
      context: String(sent[1].content),
    };
  }

  it('uses the tailored prompt, never the discovery recommendation block', async () => {
    const { system, context } = await sentTo(routed);
    expect(system).not.toContain('DISCOVERY MODE');
    expect(system).not.toContain('RECOMMENDING VISA TYPES');
    expect(system).toContain('has already selected a specific visa type');
    expect(context).toContain('Mode: TAILORED INTAKE');
  });

  it('tells the model not to re-recommend or re-ask the route', async () => {
    const { system } = await sentTo(routed);
    expect(system).toMatch(/do NOT[^.]*Recommended visa types/i);
  });

  it('skips the canned discovery first question when a route is already set', async () => {
    const invoke = jest.fn().mockResolvedValue(new AIMessage('Tailored Q1'));
    const node = makeAskQuestionNode({ invoke } as never);

    const result = await node(freshState({ visaTypeId: 'vt-trv' }));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.currentQuestion).toBe('Tailored Q1');
  });
});
