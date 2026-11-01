import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { VoiceOrchestrationService } from './voice-orchestration.service';
import { VoiceContextService } from './voice-context.service';
import { VoiceProviderRegistry } from './providers/voice-provider.factory';
import {
  VOICE_LIMITS,
  VOICE_POLICY_VERSION,
  VOICE_PROVIDER_REGISTRY,
} from './voice.tokens';
import {
  VOICE_REPOSITORY,
  type IVoiceRepository,
  type VoiceSession,
} from './voice.repository';
import {
  canContinueSession,
  canStartSession,
  type LimitDecision,
  type VoiceLimits,
} from './voice-cost-control';
import {
  canShareTranscript,
  evaluateStartConsent,
  redactForLogging,
  type ConsentKind,
} from './voice-safety';

export interface VoiceCaller {
  id: string;
}

export interface StartSessionInput {
  applicationId?: string | null;
  language?: string;
}

export interface TurnInput {
  sessionId: string;
  audio: Buffer;
  mimeType: string;
}

export interface TurnOutput {
  transcript: string;
  answer: string;
  audio: Buffer;
  audioMimeType: string;
  recommendsEscalation: boolean;
  /** Set when this turn ended the session (a limit was reached). */
  endedReason?: string;
}

/**
 * Voice session lifecycle and the per-turn gate.
 *
 * Order of checks on every turn is deliberate and must not be reordered:
 *   1. session exists and is live      (cheapest, and everything else assumes it)
 *   2. consent is current               (never process audio without it)
 *   3. limits allow continuing          (before spending money on providers)
 *   4. run the turn                     (the only step that costs anything)
 *   5. record usage, then re-check      (so the NEXT turn is blocked, not this one)
 */
@Injectable()
export class VoiceSessionService {
  private readonly log = new Logger(VoiceSessionService.name);

  constructor(
    @Inject(VOICE_REPOSITORY) private readonly repo: IVoiceRepository,
    @Inject(VOICE_LIMITS) private readonly limits: VoiceLimits,
    @Inject(VOICE_POLICY_VERSION) private readonly policyVersion: string,
    @Inject(VOICE_PROVIDER_REGISTRY)
    private readonly providers: VoiceProviderRegistry,
    private readonly supabase: SupabaseService,
    private readonly orchestration: VoiceOrchestrationService,
    private readonly context: VoiceContextService,
  ) {}

  /** Languages the configured providers can both hear and speak. */
  supportedLanguages(): string[] {
    return this.providers.supportedLanguages();
  }

  async recordConsent(
    token: string,
    caller: VoiceCaller,
    kind: ConsentKind,
    granted: boolean,
  ): Promise<void> {
    await this.repo.upsertConsent(this.supabase.forUser(token), {
      userId: caller.id,
      kind,
      granted,
      policyVersion: this.policyVersion,
    });
  }

  async listConsents(token: string, caller: VoiceCaller) {
    return this.repo.listConsents(this.supabase.forUser(token), caller.id);
  }

  async start(
    token: string,
    caller: VoiceCaller,
    input: StartSessionInput,
  ): Promise<VoiceSession> {
    const db = this.supabase.forUser(token);

    // Consent first. No audio may be processed — and no session may exist —
    // without explicit, current microphone AND transcription consent.
    const consents = await this.repo.listConsents(db, caller.id);
    const consent = evaluateStartConsent(consents, this.policyVersion);
    if (!consent.allowed) {
      throw new ForbiddenException({
        message: 'Voice consent is required',
        code: 'voice_consent_required',
        missing: consent.missing,
      });
    }

    const language = this.resolveLanguage(input.language);

    const totals = await this.repo.usageTotals(db, caller.id);
    const decision = canStartSession(totals, this.limits);
    if (!decision.allowed) {
      throw new ConflictException({
        message: decision.userMessage,
        code: `voice_limit_${decision.reason}`,
      });
    }

    const session = await this.repo.createSession(db, {
      userId: caller.id,
      applicationId: input.applicationId ?? null,
      language,
    });
    this.log.log(`voice session ${session.id} started by ${caller.id}`);
    return session;
  }

  async pause(token: string, sessionId: string): Promise<VoiceSession> {
    const db = this.supabase.forUser(token);
    await this.requireLive(db, sessionId);
    return this.repo.setStatus(db, sessionId, 'paused');
  }

  async resume(token: string, sessionId: string): Promise<VoiceSession> {
    const db = this.supabase.forUser(token);
    const session = await this.repo.getSession(db, sessionId);
    if (!session) throw new NotFoundException('Voice session not found');
    if (session.status === 'active') return session;
    if (session.status !== 'paused') {
      throw new ConflictException(
        `A ${session.status} session cannot be resumed`,
      );
    }
    return this.repo.setStatus(db, sessionId, 'active');
  }

  async end(
    token: string,
    sessionId: string,
    reason = 'user_ended',
  ): Promise<VoiceSession> {
    const db = this.supabase.forUser(token);
    const session = await this.repo.getSession(db, sessionId);
    if (!session) throw new NotFoundException('Voice session not found');
    if (session.ended_at) return session;
    return this.repo.setStatus(db, sessionId, 'ended', reason);
  }

  /**
   * Reconnection: a dropped socket must not lose the conversation. The client
   * re-sends the session id; if it is still live and inside its limits, the
   * session continues with its transcript intact.
   */
  async resumeAfterReconnect(
    token: string,
    sessionId: string,
  ): Promise<VoiceSession> {
    const db = this.supabase.forUser(token);
    const session = await this.requireLive(db, sessionId);
    await this.repo.touch(db, sessionId);
    return session;
  }

  async transcript(token: string, sessionId: string) {
    const db = this.supabase.forUser(token);
    await this.getOwned(db, sessionId);
    return this.repo.listTurns(db, sessionId);
  }

  /** User-initiated erasure of a transcript. Unconditional. */
  async deleteTranscript(token: string, sessionId: string): Promise<void> {
    const db = this.supabase.forUser(token);
    await this.getOwned(db, sessionId);
    await this.repo.deleteTranscript(db, sessionId);
    this.log.log(`voice transcript ${sessionId} deleted by owner`);
  }

  /**
   * Share the transcript with a consultant. Requires a SEPARATE consent from
   * the one that allowed transcription — agreeing to be transcribed is not
   * agreeing to hand the text to another person.
   */
  async attachToConsultation(
    token: string,
    caller: VoiceCaller,
    sessionId: string,
    consultationId: string,
  ): Promise<void> {
    const db = this.supabase.forUser(token);
    await this.getOwned(db, sessionId);

    const consents = await this.repo.listConsents(db, caller.id);
    if (!canShareTranscript(consents, this.policyVersion)) {
      throw new ForbiddenException({
        message: 'Consent to share the transcript is required',
        code: 'voice_sharing_consent_required',
      });
    }
    await this.repo.linkEscalation(db, sessionId, consultationId);
    this.log.log(
      `voice session ${sessionId} escalated to consultation ${consultationId}`,
    );
  }

  /** Run one conversational turn against a live session. */
  async runTurn(
    token: string,
    caller: VoiceCaller,
    input: TurnInput,
  ): Promise<TurnOutput> {
    const db = this.supabase.forUser(token);
    const session = await this.requireLive(db, input.sessionId);

    const elapsed = Date.now() - new Date(session.started_at).getTime();
    const idle = Date.now() - new Date(session.last_activity_at).getTime();
    const totals = await this.repo.usageTotals(db, caller.id);

    const gate = canContinueSession(
      {
        sessionElapsedMs: elapsed,
        sessionAudioMs: session.audio_ms,
        sessionTokens: session.tokens_used,
        sessionCostUsd: Number(session.cost_usd),
        dailyCostUsd: totals.dailyCostUsd,
        monthlyCostUsd: totals.monthlyCostUsd,
        concurrentSessions: totals.concurrentSessions,
      },
      this.limits,
      idle,
    );
    if (!gate.allowed) return this.endWithLimit(db, session, gate);

    const history = (await this.repo.listTurns(db, session.id))
      .filter((t) => t.role !== 'system')
      .map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text }));

    const context = await this.context.build(token, session.application_id);

    const result = await this.orchestration.runTurn({
      audio: input.audio,
      mimeType: input.mimeType,
      language: session.language,
      context,
      history,
      userId: caller.id,
      applicationId: session.application_id,
    });

    // Persist both sides of the exchange. `redacted_text` is what may be logged.
    await this.repo.appendTurn(db, {
      session_id: session.id,
      userId: caller.id,
      role: 'user',
      text: result.transcript,
      redacted_text: result.redactedTranscript,
      language: result.detectedLanguage ?? session.language,
      confidence: result.confidence ?? null,
      safety_flags: result.safetyFlags,
      audio_ms: result.usage.audioMs,
    });
    await this.repo.appendTurn(db, {
      session_id: session.id,
      userId: caller.id,
      role: 'assistant',
      text: result.answer,
      redacted_text: redactForLogging(result.answer).text,
      language: session.language,
      confidence: null,
      safety_flags: [],
      audio_ms: null,
    });

    const updated = await this.repo.addUsage(db, session.id, {
      audioMs: result.usage.audioMs,
      tokens: result.usage.tokens,
      costUsd: result.usage.costUsd,
    });

    // Re-check AFTER recording. The turn the user just paid for is delivered;
    // the limit closes the session for the next one. Cutting off mid-answer
    // would waste the spend and leave them with nothing.
    const post = canContinueSession(
      {
        sessionElapsedMs: Date.now() - new Date(updated.started_at).getTime(),
        sessionAudioMs: updated.audio_ms,
        sessionTokens: updated.tokens_used,
        sessionCostUsd: Number(updated.cost_usd),
        dailyCostUsd: totals.dailyCostUsd + result.usage.costUsd,
        monthlyCostUsd: totals.monthlyCostUsd + result.usage.costUsd,
        concurrentSessions: totals.concurrentSessions,
      },
      this.limits,
    );
    let endedReason: string | undefined;
    if (!post.allowed) {
      await this.repo.setStatus(db, session.id, 'ended', post.reason);
      endedReason = post.userMessage;
    }

    return {
      transcript: result.transcript,
      answer: result.answer,
      audio: result.audio,
      audioMimeType: result.audioMimeType,
      recommendsEscalation: result.recommendsEscalation,
      endedReason,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private resolveLanguage(requested?: string): string {
    const supported = this.providers.supportedLanguages();
    if (!requested) return supported[0] ?? 'en';
    const base = requested.split('-')[0];
    if (!supported.includes(base)) {
      // Refuse rather than silently answering in another language: a user who
      // asked in French and is answered in English has been failed twice.
      throw new ConflictException({
        message: `Voice is not available in ${requested} yet.`,
        code: 'voice_language_unsupported',
        supported,
      });
    }
    return base;
  }

  private async getOwned(
    db: ReturnType<SupabaseService['forUser']>,
    id: string,
  ) {
    // RLS already restricts visibility; a null row means "not yours or not
    // there", and both must look identical to the caller.
    const session = await this.repo.getSession(db, id);
    if (!session) throw new NotFoundException('Voice session not found');
    return session;
  }

  private async requireLive(
    db: ReturnType<SupabaseService['forUser']>,
    id: string,
  ) {
    const session = await this.getOwned(db, id);
    if (session.status !== 'active' && session.status !== 'paused') {
      throw new ConflictException(`Voice session is ${session.status}`);
    }
    return session;
  }

  private async endWithLimit(
    db: ReturnType<SupabaseService['forUser']>,
    session: VoiceSession,
    decision: LimitDecision,
  ): Promise<TurnOutput> {
    await this.repo.setStatus(db, session.id, 'ended', decision.reason);
    const message = decision.userMessage ?? 'This voice session has ended.';
    // Speak the reason rather than going silent — a voice UI that simply stops
    // is indistinguishable from a crash.
    const speech = await this.providers.synthesize({
      text: message,
      language: session.language,
    });
    return {
      transcript: '',
      answer: message,
      audio: speech.audio,
      audioMimeType: speech.mimeType,
      recommendsEscalation: false,
      endedReason: message,
    };
  }
}
