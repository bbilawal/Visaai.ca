import {
  buildRecSystemPrompt,
  makeGenerateRecommendationsNode,
} from '../src/modules/vri/graphs/nodes/generate-recommendations';

describe('buildRecSystemPrompt', () => {
  it('appends a language directive for a non-English locale', () => {
    const p = buildRecSystemPrompt('de');
    expect(p).toContain('German');
    expect(p.length).toBeGreaterThan(buildRecSystemPrompt('en').length);
  });
  it('returns the base prompt unchanged for en/null/undefined', () => {
    const base = buildRecSystemPrompt('en');
    expect(buildRecSystemPrompt(null)).toBe(base);
    expect(buildRecSystemPrompt(undefined)).toBe(base);
    expect(base).not.toContain('RESPONSE LANGUAGE');
  });
});

describe('makeGenerateRecommendationsNode language threading', () => {
  // weak factor (<70) so the node proceeds to the LLM call
  const state = { scores: { documentation_pct: 50 }, data: { profile: {} } };

  function fakeLlm(capture: { messages?: unknown[] }) {
    return {
      invoke: async (messages: unknown[]) => {
        capture.messages = messages;
        return { content: '[]' };
      },
    };
  }

  it('injects the language into the system prompt', async () => {
    const cap: { messages?: any[] } = {};
    const node = makeGenerateRecommendationsNode(fakeLlm(cap) as any, 'de');
    await node(state as any);
    expect(String(cap.messages![0].content)).toContain('German');
  });

  it('emits no directive for English', async () => {
    const cap: { messages?: any[] } = {};
    const node = makeGenerateRecommendationsNode(fakeLlm(cap) as any, 'en');
    await node(state as any);
    expect(String(cap.messages![0].content)).not.toContain('RESPONSE LANGUAGE');
  });
});
