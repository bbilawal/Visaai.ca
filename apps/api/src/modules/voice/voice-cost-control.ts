/**
 * Voice cost and usage limits — pure decision logic, no I/O.
 *
 * Kept free of dependencies so every limit is directly testable. A voice
 * session bills on three axes at once (STT audio seconds, LLM tokens, TTS
 * characters), which is easy to get wrong and expensive when you do: an
 * unbounded session is an unbounded bill against a third-party API.
 *
 * Every limit is configurable, and 0 disables that particular check so an
 * operator can relax one without editing code.
 */
export interface VoiceLimits {
  maxSessionDurationMs: number;
  /** Total audio the user may send in one session. */
  maxAudioMs: number;
  maxConcurrentSessions: number;
  maxTokensPerSession: number;
  maxCostPerSessionUsd: number;
  maxDailyCostUsd: number;
  maxMonthlyCostUsd: number;
  /** No audio and no speech for this long ends the session. */
  inactivityTimeoutMs: number;
  /** Single provider call deadline. */
  streamingTimeoutMs: number;
  /** Free-tier allowance in USD per month; 0 = no free tier. */
  freeTierMonthlyUsd: number;
}

export const DEFAULT_VOICE_LIMITS: VoiceLimits = {
  maxSessionDurationMs: 15 * 60_000,
  maxAudioMs: 10 * 60_000,
  maxConcurrentSessions: 1,
  maxTokensPerSession: 20_000,
  maxCostPerSessionUsd: 0.5,
  maxDailyCostUsd: 2,
  maxMonthlyCostUsd: 20,
  inactivityTimeoutMs: 90_000,
  streamingTimeoutMs: 20_000,
  freeTierMonthlyUsd: 0.5,
};

/** Everything spent so far, from the usage ledger. */
export interface VoiceUsageSnapshot {
  sessionElapsedMs: number;
  sessionAudioMs: number;
  sessionTokens: number;
  sessionCostUsd: number;
  dailyCostUsd: number;
  monthlyCostUsd: number;
  concurrentSessions: number;
}

export type LimitReason =
  | 'session_duration'
  | 'audio_duration'
  | 'concurrent_sessions'
  | 'tokens'
  | 'session_cost'
  | 'daily_cost'
  | 'monthly_cost'
  | 'inactivity';

export interface LimitDecision {
  allowed: boolean;
  reason?: LimitReason;
  /** Copy safe to speak or show to the user. Never exposes raw figures. */
  userMessage?: string;
}

const ALLOWED: LimitDecision = { allowed: true };

/** 0 means "no limit configured", so a check against it must be skipped. */
function exceeds(value: number, limit: number): boolean {
  return limit > 0 && value >= limit;
}

/**
 * May a NEW session start? Concurrency and the cumulative budgets are checked
 * here; per-session budgets cannot have been consumed yet.
 */
export function canStartSession(
  usage: Pick<
    VoiceUsageSnapshot,
    'concurrentSessions' | 'dailyCostUsd' | 'monthlyCostUsd'
  >,
  limits: VoiceLimits,
): LimitDecision {
  if (exceeds(usage.concurrentSessions, limits.maxConcurrentSessions)) {
    return {
      allowed: false,
      reason: 'concurrent_sessions',
      userMessage: 'You already have a voice session open on another device.',
    };
  }
  if (exceeds(usage.dailyCostUsd, limits.maxDailyCostUsd)) {
    return {
      allowed: false,
      reason: 'daily_cost',
      userMessage:
        "You've reached today's voice assistant limit. It resets tomorrow.",
    };
  }
  if (exceeds(usage.monthlyCostUsd, limits.maxMonthlyCostUsd)) {
    return {
      allowed: false,
      reason: 'monthly_cost',
      userMessage:
        "You've reached this month's voice assistant limit. You can still use chat and messaging.",
    };
  }
  return ALLOWED;
}

/**
 * May the session CONTINUE? Called before each turn and on the inactivity tick.
 *
 * Ordered most-specific-first so the reason a user is told matches the thing
 * that actually stopped them.
 */
export function canContinueSession(
  usage: VoiceUsageSnapshot,
  limits: VoiceLimits,
  msSinceLastActivity = 0,
): LimitDecision {
  if (exceeds(usage.sessionElapsedMs, limits.maxSessionDurationMs)) {
    return {
      allowed: false,
      reason: 'session_duration',
      userMessage:
        "We've reached the time limit for one voice session. You can start a new one.",
    };
  }
  if (exceeds(msSinceLastActivity, limits.inactivityTimeoutMs)) {
    return {
      allowed: false,
      reason: 'inactivity',
      userMessage:
        "I didn't hear anything for a while, so I've ended the session.",
    };
  }
  if (exceeds(usage.sessionAudioMs, limits.maxAudioMs)) {
    return {
      allowed: false,
      reason: 'audio_duration',
      userMessage: "We've reached the recording limit for one session.",
    };
  }
  if (exceeds(usage.sessionTokens, limits.maxTokensPerSession)) {
    return {
      allowed: false,
      reason: 'tokens',
      userMessage:
        "This conversation has grown long. Let's start a fresh session.",
    };
  }
  if (
    usage.sessionCostUsd >= limits.maxCostPerSessionUsd &&
    limits.maxCostPerSessionUsd > 0
  ) {
    return {
      allowed: false,
      reason: 'session_cost',
      userMessage: "We've reached the limit for one voice session.",
    };
  }
  if (exceeds(usage.dailyCostUsd, limits.maxDailyCostUsd)) {
    return {
      allowed: false,
      reason: 'daily_cost',
      userMessage:
        "You've reached today's voice assistant limit. It resets tomorrow.",
    };
  }
  if (exceeds(usage.monthlyCostUsd, limits.maxMonthlyCostUsd)) {
    return {
      allowed: false,
      reason: 'monthly_cost',
      userMessage: "You've reached this month's voice assistant limit.",
    };
  }
  return ALLOWED;
}

/**
 * Remaining free-tier allowance. Overage behaviour is deliberately "stop", not
 * "bill silently": this is a consumer product handling immigration cases, and a
 * surprise charge is worse than a paused feature.
 */
export function freeTierRemainingUsd(
  monthlyCostUsd: number,
  limits: VoiceLimits,
): number {
  if (limits.freeTierMonthlyUsd <= 0) return 0;
  return Math.max(0, limits.freeTierMonthlyUsd - monthlyCostUsd);
}

/**
 * Cost of one turn. Kept here rather than in the meter so the arithmetic is
 * unit-testable without a database.
 */
export interface VoiceTurnCostInput {
  sttAudioMs: number;
  sttUsdPerMinute: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmUsdPerInputToken: number;
  llmUsdPerOutputToken: number;
  ttsCharacters: number;
  ttsUsdPerThousandChars: number;
}

export function estimateTurnCostUsd(input: VoiceTurnCostInput): number {
  const stt = (input.sttAudioMs / 60_000) * input.sttUsdPerMinute;
  const llm =
    input.llmInputTokens * input.llmUsdPerInputToken +
    input.llmOutputTokens * input.llmUsdPerOutputToken;
  const tts = (input.ttsCharacters / 1000) * input.ttsUsdPerThousandChars;
  // Rounded to a hundredth of a cent: enough precision to accumulate fairly
  // over a session without carrying float noise into the ledger.
  return Math.round((stt + llm + tts) * 10_000) / 10_000;
}
