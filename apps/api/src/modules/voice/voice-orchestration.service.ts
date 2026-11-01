import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../shared/ai/ai.service';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { GuardrailsService } from '../shared/guardrails/guardrails.service';
import {
  VoiceContextService,
  type VoiceContext,
} from './voice-context.service';
import { VoiceProviderRegistry } from './providers/voice-provider.factory';
import { VOICE_PROVIDER_REGISTRY } from './voice.tokens';
import {
  VOICE_DISCLAIMER_EN,
  assessAdviceBoundary,
  assessPromptInjection,
  redactForLogging,
} from './voice-safety';
import { estimateTurnCostUsd } from './voice-cost-control';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../shared/ai/untrusted';

/**
 * One conversational turn: audio in → transcript → answer → audio out.
 *
 * Reuses the platform's AI router (`AiService`) rather than adding a second
 * orchestration engine, so provider fallback, retry and analytics behave
 * identically to every other AI call in the product.
 */
export interface VoiceTurnInput {
  audio: Buffer;
  mimeType: string;
  language: string;
  context: VoiceContext;
  /** Prior turns, oldest first, for conversational continuity. */
  history: { role: 'user' | 'assistant'; text: string }[];
  userId: string;
  applicationId: string | null;
}

export interface VoiceTurnResult {
  transcript: string;
  /** Redacted copy for logs/analytics/audit. */
  redactedTranscript: string;
  confidence?: number;
  detectedLanguage?: string;
  answer: string;
  audio: Buffer;
  audioMimeType: string;
  /** Safety signals raised on this turn. */
  safetyFlags: string[];
  /** True when a licensed human should take over. */
  recommendsEscalation: boolean;
  usage: { audioMs: number; tokens: number; costUsd: number };
}

/** Pricing inputs; overridden from config in the module. */
export interface VoicePricing {
  sttUsdPerMinute: number;
  llmUsdPerInputToken: number;
  llmUsdPerOutputToken: number;
  ttsUsdPerThousandChars: number;
}

export const DEFAULT_VOICE_PRICING: VoicePricing = {
  sttUsdPerMinute: 0.006,
  llmUsdPerInputToken: 0.0000025,
  llmUsdPerOutputToken: 0.00001,
  ttsUsdPerThousandChars: 0.015,
};

/** Rough token estimate when the model does not report usage: ~4 chars/token. */
const CHARS_PER_TOKEN = 4;

@Injectable()
export class VoiceOrchestrationService {
  private readonly log = new Logger(VoiceOrchestrationService.name);

  constructor(
    @Inject(VOICE_PROVIDER_REGISTRY)
    private readonly providers: VoiceProviderRegistry,
    private readonly ai: AiService,
    private readonly guardrails: GuardrailsService,
    private readonly context: VoiceContextService,
    private readonly meter: AiUsageMeter,
  ) {}

  async runTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    // 1. Speech → text.
    const stt = await this.providers.transcribe({
      audio: input.audio,
      mimeType: input.mimeType,
      language: input.language,
    });

    const transcript = stt.text.trim();
    const { text: redactedTranscript } = redactForLogging(transcript);

    // 2. Safety, BEFORE the model sees anything.
    const injection = assessPromptInjection(transcript);
    const advice = assessAdviceBoundary(transcript);
    const intent = this.guardrails.classifyIntent(transcript);
    const safetyFlags = [
      ...injection.signals,
      ...(advice.requiresHuman ? ['regulated_advice'] : []),
      ...(intent.safe ? [] : [`intent:${intent.label}`]),
    ];

    if (injection.suspected) {
      // Refuse the turn outright. The transcript is still recorded — the user
      // said it, and hiding it would break the audit trail — but it never
      // reaches the model.
      this.log.warn(
        `voice: prompt injection suspected [${injection.signals.join(',')}]`,
      );
      return this.refusal(
        input,
        stt.durationMs,
        transcript,
        redactedTranscript,
        safetyFlags,
        "I can't help with that. I can answer questions about visas and your application.",
        false,
      );
    }

    if (!intent.safe) {
      // GuardrailsService already classifies legal-advice / approval-prediction
      // / misrepresentation asks. Reuse that judgement rather than duplicating
      // it — one place to change when policy changes.
      return this.refusal(
        input,
        stt.durationMs,
        transcript,
        redactedTranscript,
        safetyFlags,
        `${VOICE_DISCLAIMER_EN} Would you like me to check a consultant's availability?`,
        true,
      );
    }

    if (advice.requiresHuman) {
      // Regulated immigration advice: the assistant must not answer, and must
      // offer the human path rather than a hedge.
      return this.refusal(
        input,
        stt.durationMs,
        transcript,
        redactedTranscript,
        safetyFlags,
        `${VOICE_DISCLAIMER_EN} Would you like me to check a consultant's availability?`,
        true,
      );
    }

    // 3. Ask the model, with the case context as delimited DATA.
    const system = this.buildSystemPrompt(
      input.language,
      this.context.render(input.context),
    );
    // Both the prior turns and the fresh transcript are user speech, and the
    // transcript in particular is whatever a speech-to-text model decided it
    // heard. Fenced as data: an instruction spoken aloud is still an
    // instruction from an untrusted party.
    const conversation = input.history
      .slice(-8)
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
      .join('\n');
    const prompt =
      `${asUntrustedData('conversation history', conversation)}\n` +
      `User: ${asUntrustedData('user speech', transcript)}\nAssistant:`;

    let answer: string;
    try {
      const raw = await this.ai.completeJSON({
        system: `${system}\n${UNTRUSTED_DATA_DIRECTIVE}`,
        user: `${prompt}\n\nRespond with JSON: {"answer": string, "escalate": boolean}`,
        json: true,
        maxTokens: 500,
        meta: {
          operation: 'voice',
          userId: input.userId,
          applicationId: input.applicationId,
        },
      });
      const parsed = JSON.parse(raw) as { answer?: string; escalate?: boolean };
      answer = (parsed.answer ?? '').trim();
      if (!answer) throw new Error('empty answer');
      if (parsed.escalate) safetyFlags.push('model_recommends_escalation');
    } catch (err) {
      this.log.error(`voice: model turn failed: ${(err as Error).message}`);
      answer =
        "I'm having trouble answering right now. You can try again, or I can connect you with a consultant.";
      safetyFlags.push('model_error');
    }

    // 4. Filter the model's output before it is spoken. Once synthesised, it is
    // in the user's ear — there is no taking it back, so an unsafe answer is
    // REPLACED with the guardrail's compliant fallback rather than softened.
    const filtered = this.guardrails.filterOutput(answer);
    const finalAnswer = filtered.safe ? answer : filtered.safeFallback;
    if (!filtered.safe)
      safetyFlags.push(`output_filtered:${filtered.violations.join('|')}`);

    // 5. Text → speech.
    const tts = await this.providers.synthesize({
      text: finalAnswer,
      language: input.language,
    });

    const tokens = Math.ceil(
      (prompt.length + finalAnswer.length) / CHARS_PER_TOKEN,
    );
    const costUsd = estimateTurnCostUsd({
      sttAudioMs: stt.durationMs,
      llmInputTokens: Math.ceil(prompt.length / CHARS_PER_TOKEN),
      llmOutputTokens: Math.ceil(finalAnswer.length / CHARS_PER_TOKEN),
      ttsCharacters: finalAnswer.length,
      ...DEFAULT_VOICE_PRICING,
    });

    // Metering rides the existing ai_usage_events ledger, so voice spend shows
    // up in the same dashboards as every other AI cost.
    await this.meter
      .record({
        operation: 'voice',
        userId: input.userId,
        applicationId: input.applicationId,
        provider: 'openai',
        model: 'voice-turn',
        inputTokens: Math.ceil(prompt.length / CHARS_PER_TOKEN),
        outputTokens: Math.ceil(finalAnswer.length / CHARS_PER_TOKEN),
      })
      .catch(() => undefined);

    return {
      transcript,
      redactedTranscript,
      confidence: stt.segments[0]?.confidence,
      detectedLanguage: stt.detectedLanguage,
      answer: finalAnswer,
      audio: tts.audio,
      audioMimeType: tts.mimeType,
      safetyFlags,
      recommendsEscalation: safetyFlags.includes('model_recommends_escalation'),
      usage: { audioMs: stt.durationMs, tokens, costUsd },
    };
  }

  /** A refused turn still speaks, still meters audio, and never calls the model. */
  private async refusal(
    input: VoiceTurnInput,
    audioMs: number,
    transcript: string,
    redactedTranscript: string,
    safetyFlags: string[],
    answer: string,
    recommendsEscalation: boolean,
  ): Promise<VoiceTurnResult> {
    const tts = await this.providers.synthesize({
      text: answer,
      language: input.language,
    });
    return {
      transcript,
      redactedTranscript,
      answer,
      audio: tts.audio,
      audioMimeType: tts.mimeType,
      safetyFlags,
      recommendsEscalation,
      usage: {
        audioMs,
        tokens: 0,
        costUsd: estimateTurnCostUsd({
          sttAudioMs: audioMs,
          llmInputTokens: 0,
          llmOutputTokens: 0,
          ttsCharacters: answer.length,
          ...DEFAULT_VOICE_PRICING,
        }),
      },
    };
  }

  private buildSystemPrompt(language: string, contextBlock: string): string {
    return [
      'You are the VisaAI voice assistant. You help people understand visa options',
      'and prepare their applications.',
      '',
      'HARD RULES:',
      '- You are NOT a licensed immigration consultant or lawyer. Never claim to be,',
      '  and never present your answers as legal advice.',
      '- Distinguish general information from advice about a specific case. For the',
      '  latter, recommend a licensed consultant.',
      '- Never guarantee or predict an immigration outcome.',
      "- If you are unsure, say so plainly. A wrong answer about someone's visa is",
      '  worse than "I don\'t know".',
      '- Answer only from the case data provided and general visa knowledge. Never',
      '  invent document names, fees, processing times, or deadlines.',
      '- You are speaking aloud: keep answers under 80 words, plain, no markdown.',
      `- Reply in this language: ${language}.`,
      '',
      contextBlock,
    ].join('\n');
  }
}
