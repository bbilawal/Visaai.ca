import { AiService } from '../src/modules/shared/ai/ai.service';

function svc(openaiKey?: string) {
  const config = {
    get: (k: string) =>
      k === 'OPENAI_API_KEY'
        ? openaiKey
        : k === 'AI_PROVIDERS'
          ? 'openai'
          : undefined,
  } as never;
  // meter is only used by completeJSON; .available needs none → stub it.
  return new AiService(config, { record: async () => {} } as never);
}

describe('AiService.available', () => {
  it('false when no provider is configured', () => {
    expect(svc(undefined).available).toBe(false);
  });
  it('true when openai key is present', () => {
    expect(svc('sk-test').available).toBe(true);
  });
});
