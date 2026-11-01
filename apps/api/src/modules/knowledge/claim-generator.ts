/**
 * The model side of grounded answering, kept behind a one-method port.
 *
 * `KnowledgeAnswerService` is where the safety rules live and it must be
 * testable without a network, so the model call sits here. This file is the
 * only place in the knowledge module that knows a model exists.
 *
 * It routes through `chatModelForTask('visa_knowledge_answer')` rather than
 * constructing a model directly, which is what puts the tier, the token cap,
 * the timeout and the cost metering under the AI task registry instead of in a
 * literal here — the exact mistake `model-factory.ts` was written to end.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { chatModelForTask } from '../shared/ai/model-factory';
import { overridesFromEnv } from '../shared/ai/model-factory';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import type {
  ClaimGenerator,
  ModelClaimOutput,
} from './knowledge-answer.service';

@Injectable()
export class OpenAiClaimGenerator implements ClaimGenerator {
  private readonly log = new Logger(OpenAiClaimGenerator.name);

  constructor(
    private readonly config: ConfigService<Env>,
    private readonly meter?: AiUsageMeter,
  ) {}

  async generate(input: {
    question: string;
    prompt: string;
    system: string;
  }): Promise<ModelClaimOutput> {
    const apiKey = this.config.get('OPENAI_API_KEY', { infer: true });
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

    const model = chatModelForTask('visa_knowledge_answer', {
      apiKey,
      meter: this.meter,
      ctx: { operation: 'visa_knowledge_answer' },
      overrides: overridesFromEnv(process.env),
    });

    const res = await model.invoke([
      { role: 'system', content: input.system },
      { role: 'user', content: input.prompt },
    ]);

    const raw =
      typeof res.content === 'string'
        ? res.content
        : JSON.stringify(res.content);
    return parseClaimOutput(raw);
  }
}

/**
 * Parse and validate the model's JSON.
 *
 * A malformed response is treated as "no claims", NOT as an error to retry
 * into. The difference matters: a retry on a model that has misunderstood the
 * schema usually produces the same misunderstanding at twice the cost, and the
 * caller's refusal path already handles "the model gave us nothing usable"
 * correctly — it tells the user to check the official source.
 *
 * Every field is validated rather than cast. The output of this function feeds
 * `verifyGrounding`, and a claim object with a missing `citations` array would
 * otherwise crash the one component whose job is to be the last line of
 * defence.
 */
export function parseClaimOutput(raw: string): ModelClaimOutput {
  const text = raw.trim();
  // Models fence JSON in markdown even when told not to.
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(text)?.[1] ?? text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    // Last resort: the first balanced object in the string.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) return { claims: [], insufficient: true };
    try {
      parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return { claims: [], insufficient: true };
    }
  }

  if (typeof parsed !== 'object' || parsed === null)
    return { claims: [], insufficient: true };
  const obj = parsed as Record<string, unknown>;

  const rawClaims = Array.isArray(obj.claims) ? obj.claims : [];
  const claims: ModelClaimOutput['claims'] = [];

  for (const c of rawClaims) {
    if (typeof c !== 'object' || c === null) continue;
    const rec = c as Record<string, unknown>;
    const claimText = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!claimText) continue;

    const citations = Array.isArray(rec.citations)
      ? rec.citations.filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        )
      : [];

    const modality =
      rec.modality === 'mandatory' ||
      rec.modality === 'recommended' ||
      rec.modality === 'informational'
        ? rec.modality
        : 'informational';

    claims.push({
      text: claimText,
      citations,
      quote:
        typeof rec.quote === 'string' && rec.quote.trim()
          ? rec.quote.trim()
          : undefined,
      modality,
    });
  }

  return {
    claims,
    insufficient: obj.insufficient === true || claims.length === 0,
    conflicting: obj.conflicting === true,
  };
}
