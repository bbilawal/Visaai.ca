import { AiUsageMeter } from './ai-usage.meter';
import type { SupabaseService } from '../supabase/supabase.service';

function makeSupabase(
  insertResult: { error: { message: string } | null } = { error: null },
) {
  const insert = jest.fn().mockResolvedValue(insertResult);
  const from = jest.fn().mockReturnValue({ insert });
  const svc = { admin: { from } } as unknown as SupabaseService;
  return { svc, from, insert };
}

describe('AiUsageMeter.record', () => {
  it('inserts a priced ai_usage_events row (service-role)', async () => {
    const { svc, from, insert } = makeSupabase();
    await new AiUsageMeter(svc).record({
      operation: 'intake',
      applicationId: 'a1',
      userId: 'u1',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(from).toHaveBeenCalledWith('ai_usage_events');
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      application_id: 'a1',
      user_id: 'u1',
      provider: 'openai',
      model: 'gpt-4o',
      operation: 'intake',
      input_tokens: 1000,
      output_tokens: 500,
      units: 0,
    });
    expect(row.request_cost_usd).toBeCloseTo(0.0075, 6);
  });

  it('never throws when the insert returns an error', async () => {
    const { svc } = makeSupabase({ error: { message: 'boom' } });
    await expect(
      new AiUsageMeter(svc).record({
        operation: 'x',
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the client itself throws', async () => {
    const svc = {
      admin: {
        from: () => {
          throw new Error('down');
        },
      },
    } as unknown as SupabaseService;
    await expect(
      new AiUsageMeter(svc).record({
        operation: 'x',
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
