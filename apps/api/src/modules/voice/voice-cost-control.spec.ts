import {
  DEFAULT_VOICE_LIMITS,
  canContinueSession,
  canStartSession,
  estimateTurnCostUsd,
  freeTierRemainingUsd,
  type VoiceLimits,
  type VoiceUsageSnapshot,
} from './voice-cost-control';

const limits: VoiceLimits = { ...DEFAULT_VOICE_LIMITS };

const fresh: VoiceUsageSnapshot = {
  sessionElapsedMs: 0,
  sessionAudioMs: 0,
  sessionTokens: 0,
  sessionCostUsd: 0,
  dailyCostUsd: 0,
  monthlyCostUsd: 0,
  concurrentSessions: 0,
};

describe('canStartSession', () => {
  it('allows a first session', () => {
    expect(canStartSession(fresh, limits).allowed).toBe(true);
  });

  it('blocks a second concurrent session', () => {
    const decision = canStartSession(
      { ...fresh, concurrentSessions: 1 },
      limits,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('concurrent_sessions');
  });

  it('blocks when the daily budget is spent', () => {
    const decision = canStartSession({ ...fresh, dailyCostUsd: 2 }, limits);
    expect(decision.reason).toBe('daily_cost');
  });

  it('blocks when the monthly budget is spent', () => {
    const decision = canStartSession({ ...fresh, monthlyCostUsd: 20 }, limits);
    expect(decision.reason).toBe('monthly_cost');
  });

  it('never leaks raw figures into the user-facing message', () => {
    const decision = canStartSession({ ...fresh, monthlyCostUsd: 20 }, limits);
    expect(decision.userMessage).toBeDefined();
    expect(decision.userMessage).not.toMatch(/\$|\d+\.\d+|usd/i);
  });
});

describe('canContinueSession', () => {
  it('allows a healthy session', () => {
    expect(canContinueSession(fresh, limits).allowed).toBe(true);
  });

  it('stops at the session duration limit', () => {
    const decision = canContinueSession(
      { ...fresh, sessionElapsedMs: 15 * 60_000 },
      limits,
    );
    expect(decision.reason).toBe('session_duration');
  });

  it('stops on inactivity', () => {
    const decision = canContinueSession(fresh, limits, 90_000);
    expect(decision.reason).toBe('inactivity');
  });

  it('stops at the audio limit', () => {
    const decision = canContinueSession(
      { ...fresh, sessionAudioMs: 10 * 60_000 },
      limits,
    );
    expect(decision.reason).toBe('audio_duration');
  });

  it('stops at the token limit', () => {
    const decision = canContinueSession(
      { ...fresh, sessionTokens: 20_000 },
      limits,
    );
    expect(decision.reason).toBe('tokens');
  });

  it('stops at the per-session cost limit', () => {
    const decision = canContinueSession(
      { ...fresh, sessionCostUsd: 0.5 },
      limits,
    );
    expect(decision.reason).toBe('session_cost');
  });

  it('reports the MOST SPECIFIC reason when several limits are breached', () => {
    // Duration is the thing the user experienced; telling them "monthly budget"
    // when their session simply ran long would be misleading.
    const decision = canContinueSession(
      { ...fresh, sessionElapsedMs: 15 * 60_000, monthlyCostUsd: 999 },
      limits,
    );
    expect(decision.reason).toBe('session_duration');
  });

  it('treats a 0 limit as "disabled", not "always exceeded"', () => {
    const unlimited: VoiceLimits = {
      ...limits,
      maxSessionDurationMs: 0,
      maxAudioMs: 0,
    };
    const decision = canContinueSession(
      { ...fresh, sessionElapsedMs: 10 ** 9, sessionAudioMs: 10 ** 9 },
      unlimited,
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('freeTierRemainingUsd', () => {
  it('reports the unspent allowance', () => {
    expect(freeTierRemainingUsd(0.2, limits)).toBeCloseTo(0.3, 5);
  });

  it('never goes negative', () => {
    expect(freeTierRemainingUsd(99, limits)).toBe(0);
  });

  it('returns 0 when no free tier is configured', () => {
    expect(freeTierRemainingUsd(0, { ...limits, freeTierMonthlyUsd: 0 })).toBe(
      0,
    );
  });
});

describe('estimateTurnCostUsd', () => {
  const pricing = {
    sttUsdPerMinute: 0.006,
    llmUsdPerInputToken: 0.0000025,
    llmUsdPerOutputToken: 0.00001,
    ttsUsdPerThousandChars: 0.015,
  };

  it('bills all three axes of a turn', () => {
    const cost = estimateTurnCostUsd({
      sttAudioMs: 60_000,
      llmInputTokens: 1000,
      llmOutputTokens: 200,
      ttsCharacters: 500,
      ...pricing,
    });
    // 0.006 (stt) + 0.0025 + 0.002 (llm) + 0.0075 (tts)
    expect(cost).toBeCloseTo(0.018, 4);
  });

  it('is zero for an empty turn', () => {
    expect(
      estimateTurnCostUsd({
        sttAudioMs: 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        ttsCharacters: 0,
        ...pricing,
      }),
    ).toBe(0);
  });

  it('does not silently round a real cost to zero', () => {
    const cost = estimateTurnCostUsd({
      sttAudioMs: 5_000,
      llmInputTokens: 100,
      llmOutputTokens: 50,
      ttsCharacters: 100,
      ...pricing,
    });
    expect(cost).toBeGreaterThan(0);
  });
});
