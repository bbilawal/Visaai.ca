import {
  ForbiddenException,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import { MessagingAiService } from '../src/modules/messaging/messaging-ai.service';
import { GuardrailsService } from '../src/modules/shared/guardrails/guardrails.service';

const thread = {
  conversation: { id: 'c1' },
  messages: [{ sender_role: 'user', body: 'hi' }],
  unread_count: 0,
};

function deps(
  over: { aiAvailable?: boolean; aiReturn?: string; aiThrow?: boolean } = {},
) {
  const ai = {
    available: over.aiAvailable ?? true,
    completeJSON: jest.fn(
      over.aiThrow
        ? () => Promise.reject(new Error('All AI providers failed'))
        : () =>
            Promise.resolve(
              over.aiReturn ??
                '{"reply":"Hi! Please upload your bank statement."}',
            ),
    ),
  };
  const messaging = { getThread: jest.fn().mockResolvedValue(thread) };
  const adminFrom = (table: string) => {
    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      maybeSingle: () =>
        Promise.resolve({
          data:
            table === 'applications' ? { destination_country: 'Canada' } : null,
          error: null,
        }),
    };
    (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve({
        data:
          table === 'checklist_items'
            ? [{ label: 'Bank statement', status: 'missing', required: true }]
            : [],
        error: null,
      });
    return api;
  };
  const supabase = { admin: { from: jest.fn(adminFrom) } };
  // The REAL guardrails service, not a stub: the point of the check is its
  // actual patterns, so a permissive fake would assert nothing.
  const guardrails = new GuardrailsService();
  return { ai, messaging, supabase, guardrails };
}

const staff = { id: 'c1', appRole: 'consultant' as const };

describe('MessagingAiService.draftReply', () => {
  it('rejects a non-staff caller', async () => {
    const d = deps();
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    await expect(
      svc.draftReply('tok', { id: 'u', appRole: 'user' }, 'app-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('503 when AI is not configured', async () => {
    const d = deps({ aiAvailable: false });
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    await expect(svc.draftReply('tok', staff, 'app-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('returns the parsed reply for a staff caller', async () => {
    const d = deps();
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    const out = await svc.draftReply('tok', staff, 'app-1');
    expect(out.draft).toBe('Hi! Please upload your bank statement.');
    expect(d.ai.completeJSON).toHaveBeenCalledWith(
      expect.objectContaining({ json: true }),
    );
  });

  it('falls back to raw text when the model returns non-JSON', async () => {
    const d = deps({ aiReturn: 'Just plain text reply.' });
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    expect((await svc.draftReply('tok', staff, 'app-1')).draft).toBe(
      'Just plain text reply.',
    );
  });

  it('502 when the AI call throws', async () => {
    const d = deps({ aiThrow: true });
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    await expect(svc.draftReply('tok', staff, 'app-1')).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('502 when the model returns an empty draft', async () => {
    const d = deps({ aiReturn: '{"reply":"   "}' });
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    await expect(svc.draftReply('tok', staff, 'app-1')).rejects.toThrow(
      BadGatewayException,
    );
  });

  // ── Indirect prompt injection (Task 14) ───────────────────────────────────
  // The applicant writes into the thread, and the thread goes into the prompt.
  // SYSTEM_PROMPT's "do not guarantee outcomes" is an instruction to a model,
  // not a control, so these assert the deterministic post-filter instead.

  it('blocks an approval guarantee the model was talked into producing', async () => {
    const d = deps({
      aiReturn:
        '{"reply":"Good news — your visa will definitely be approved, I guarantee it."}',
    });
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    const result = await svc.draftReply('tok', staff, 'app-1');
    expect(result.blocked).toBeDefined();
    expect(result.blocked!.length).toBeGreaterThan(0);
    expect(result.draft).not.toMatch(/guarantee/i);
  });

  it('blocks an outcome prediction', async () => {
    const d = deps({
      aiReturn:
        '{"reply":"Based on your profile you are 95% likely to be approved."}',
    });
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    const result = await svc.draftReply('tok', staff, 'app-1');
    expect(result.blocked).toBeDefined();
    expect(result.draft).not.toMatch(/95%/);
  });

  it('leaves a compliant draft untouched', async () => {
    const d = deps({
      aiReturn:
        '{"reply":"Could you upload your bank statement for the last three months?"}',
    });
    const svc = new MessagingAiService(
      d.ai as never,
      d.messaging as never,
      d.supabase as never,
      d.guardrails,
    );
    const result = await svc.draftReply('tok', staff, 'app-1');
    expect(result.blocked).toBeUndefined();
    expect(result.draft).toContain('bank statement');
  });
});
