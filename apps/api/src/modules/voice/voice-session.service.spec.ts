import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { VoiceSessionService } from './voice-session.service';
import { DEFAULT_VOICE_LIMITS } from './voice-cost-control';
import type { IVoiceRepository, VoiceSession } from './voice.repository';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import type { VoiceOrchestrationService } from './voice-orchestration.service';
import type { VoiceContextService } from './voice-context.service';
import type { VoiceProviderRegistry } from './providers/voice-provider.factory';
import type { ConsentRecord } from './voice-safety';

const POLICY = 'v1';
const USER = { id: 'user-1' };

function grant(kind: ConsentRecord['kind']): ConsentRecord {
  return { kind, granted: true, policyVersion: POLICY };
}

const FULL_CONSENT = [grant('microphone'), grant('transcription')];

function session(over: Partial<VoiceSession> = {}): VoiceSession {
  return {
    id: 'sess-1',
    user_id: USER.id,
    application_id: null,
    status: 'active',
    language: 'en',
    audio_ms: 0,
    tokens_used: 0,
    cost_usd: 0,
    turn_count: 0,
    end_reason: null,
    escalated_to_consultation_id: null,
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    ended_at: null,
    ...over,
  };
}

function setup(
  over: {
    consents?: ConsentRecord[];
    totals?: {
      dailyCostUsd: number;
      monthlyCostUsd: number;
      concurrentSessions: number;
    };
    existing?: VoiceSession | null;
  } = {},
) {
  const repo = {
    createSession: jest
      .fn()
      .mockImplementation(async (_db, input) => session(input)),
    getSession: jest
      .fn()
      .mockResolvedValue(
        over.existing === undefined ? session() : over.existing,
      ),
    setStatus: jest
      .fn()
      .mockImplementation(async (_db, id, status, reason) =>
        session({ id, status, end_reason: reason ?? null }),
      ),
    touch: jest.fn().mockResolvedValue(undefined),
    addUsage: jest
      .fn()
      .mockImplementation(async (_db, id) => session({ id, turn_count: 1 })),
    usageTotals: jest.fn().mockResolvedValue(
      over.totals ?? {
        dailyCostUsd: 0,
        monthlyCostUsd: 0,
        concurrentSessions: 0,
      },
    ),
    appendTurn: jest.fn().mockResolvedValue({}),
    listTurns: jest.fn().mockResolvedValue([]),
    deleteTranscript: jest.fn().mockResolvedValue(undefined),
    linkEscalation: jest.fn().mockResolvedValue(undefined),
    listConsents: jest.fn().mockResolvedValue(over.consents ?? FULL_CONSENT),
    upsertConsent: jest.fn().mockResolvedValue(grant('microphone')),
  } as unknown as jest.Mocked<IVoiceRepository>;

  const forUser = jest.fn().mockReturnValue({ __scoped: true });
  const supabase = {
    forUser,
    admin: { __admin: true },
  } as unknown as SupabaseService;

  const orchestration = {
    runTurn: jest.fn().mockResolvedValue({
      transcript: 'what documents do I need',
      redactedTranscript: 'what documents do I need',
      answer: 'You need a passport and proof of funds.',
      audio: Buffer.from('audio'),
      audioMimeType: 'audio/mpeg',
      safetyFlags: [],
      recommendsEscalation: false,
      usage: { audioMs: 2000, tokens: 100, costUsd: 0.01 },
    }),
  } as unknown as jest.Mocked<VoiceOrchestrationService>;

  const context = {
    build: jest.fn().mockResolvedValue({ applicationId: null }),
  } as unknown as VoiceContextService;

  const providers = {
    supportedLanguages: () => ['en', 'fr', 'es'],
    synthesize: jest.fn().mockResolvedValue({
      audio: Buffer.from('limit'),
      mimeType: 'audio/mpeg',
      durationMs: 100,
      provider: 'mock',
      voice: 'mock-en',
    }),
  } as unknown as VoiceProviderRegistry;

  const svc = new VoiceSessionService(
    repo,
    DEFAULT_VOICE_LIMITS,
    POLICY,
    providers,
    supabase,
    orchestration,
    context,
  );
  return { svc, repo, forUser, orchestration, providers };
}

describe('start — consent enforcement', () => {
  it('starts when microphone and transcription consent are current', async () => {
    const { svc, repo } = setup();
    await svc.start('jwt', USER, {});
    expect(repo.createSession).toHaveBeenCalled();
  });

  it('REFUSES without consent — no session, no audio processed', async () => {
    const { svc, repo } = setup({ consents: [] });
    await expect(svc.start('jwt', USER, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it('refuses when only microphone consent exists', async () => {
    const { svc } = setup({ consents: [grant('microphone')] });
    await expect(svc.start('jwt', USER, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a stale policy version', async () => {
    const { svc } = setup({
      consents: [
        { kind: 'microphone', granted: true, policyVersion: 'v0' },
        grant('transcription'),
      ],
    });
    await expect(svc.start('jwt', USER, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('uses the RLS-scoped client, never service-role', async () => {
    const { svc, forUser } = setup();
    await svc.start('jwt-abc', USER, {});
    expect(forUser).toHaveBeenCalledWith('jwt-abc');
  });
});

describe('start — limits', () => {
  it('blocks a second concurrent session', async () => {
    const { svc } = setup({
      totals: { dailyCostUsd: 0, monthlyCostUsd: 0, concurrentSessions: 1 },
    });
    await expect(svc.start('jwt', USER, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('blocks when the monthly budget is exhausted', async () => {
    const { svc } = setup({
      totals: { dailyCostUsd: 0, monthlyCostUsd: 999, concurrentSessions: 0 },
    });
    await expect(svc.start('jwt', USER, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('start — language', () => {
  it('accepts a supported language', async () => {
    const { svc, repo } = setup();
    await svc.start('jwt', USER, { language: 'fr-CA' });
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ language: 'fr' }),
    );
  });

  it('REFUSES an unvalidated language rather than answering in another one', async () => {
    // Being asked in Swahili and answered in English fails the user twice.
    const { svc } = setup();
    await expect(
      svc.start('jwt', USER, { language: 'sw' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('lifecycle', () => {
  it('pauses and resumes', async () => {
    const { svc, repo } = setup();
    await svc.pause('jwt', 'sess-1');
    expect(repo.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      'sess-1',
      'paused',
    );

    repo.getSession.mockResolvedValueOnce(session({ status: 'paused' }));
    await svc.resume('jwt', 'sess-1');
    expect(repo.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      'sess-1',
      'active',
    );
  });

  it('refuses to resume an ended session', async () => {
    const { svc } = setup({ existing: session({ status: 'ended' }) });
    await expect(svc.resume('jwt', 'sess-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('end is idempotent', async () => {
    const { svc, repo } = setup({
      existing: session({ ended_at: '2026-08-05T00:00:00Z' }),
    });
    await svc.end('jwt', 'sess-1');
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('404s for a session the caller cannot see (RLS-filtered)', async () => {
    const { svc } = setup({ existing: null });
    await expect(svc.end('jwt', 'sess-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reconnect resumes a live session and refreshes activity', async () => {
    const { svc, repo } = setup();
    await svc.resumeAfterReconnect('jwt', 'sess-1');
    expect(repo.touch).toHaveBeenCalled();
  });
});

describe('runTurn', () => {
  it('records both sides of the exchange and the usage', async () => {
    const { svc, repo } = setup();
    const out = await svc.runTurn('jwt', USER, {
      sessionId: 'sess-1',
      audio: Buffer.alloc(64),
      mimeType: 'audio/webm',
    });

    expect(out.answer).toContain('passport');
    expect(repo.appendTurn).toHaveBeenCalledTimes(2);
    expect(repo.addUsage).toHaveBeenCalledWith(
      expect.anything(),
      'sess-1',
      expect.objectContaining({ audioMs: 2000, costUsd: 0.01 }),
    );
  });

  it('stores a redacted copy alongside the transcript', async () => {
    const { svc, repo } = setup();
    await svc.runTurn('jwt', USER, {
      sessionId: 'sess-1',
      audio: Buffer.alloc(8),
      mimeType: 'audio/webm',
    });
    const userTurn = repo.appendTurn.mock.calls[0][1];
    expect(userTurn.redacted_text).toBeDefined();
  });

  it('refuses a turn on a session that already ended', async () => {
    const { svc } = setup({ existing: session({ status: 'ended' }) });
    await expect(
      svc.runTurn('jwt', USER, {
        sessionId: 'sess-1',
        audio: Buffer.alloc(8),
        mimeType: 'audio/webm',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ends the session BEFORE calling a provider when a limit is already breached', async () => {
    const { svc, orchestration, repo } = setup({
      existing: session({
        started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      }),
    });
    const out = await svc.runTurn('jwt', USER, {
      sessionId: 'sess-1',
      audio: Buffer.alloc(8),
      mimeType: 'audio/webm',
    });
    // No spend: the orchestration layer was never reached.
    expect(orchestration.runTurn).not.toHaveBeenCalled();
    expect(repo.setStatus).toHaveBeenCalledWith(
      expect.anything(),
      'sess-1',
      'ended',
      'session_duration',
    );
    // The user is TOLD, not cut off silently — a voice UI that just stops is
    // indistinguishable from a crash.
    expect(out.endedReason).toBeTruthy();
    expect(out.audio.length).toBeGreaterThan(0);
  });

  it('delivers the paid-for turn, then closes the session for the next one', async () => {
    const { svc, repo, orchestration } = setup();
    // Push the post-turn total over the per-session cost limit.
    (orchestration.runTurn as jest.Mock).mockResolvedValueOnce({
      transcript: 't',
      redactedTranscript: 't',
      answer: 'a',
      audio: Buffer.from('a'),
      audioMimeType: 'audio/mpeg',
      safetyFlags: [],
      recommendsEscalation: false,
      usage: { audioMs: 1000, tokens: 10, costUsd: 0.01 },
    });
    repo.addUsage.mockResolvedValueOnce(session({ cost_usd: 0.6 }));

    const out = await svc.runTurn('jwt', USER, {
      sessionId: 'sess-1',
      audio: Buffer.alloc(8),
      mimeType: 'audio/webm',
    });

    expect(out.answer).toBe('a');
    expect(out.endedReason).toBeTruthy();
  });
});

describe('transcript privacy', () => {
  it('lets the owner delete their transcript unconditionally', async () => {
    const { svc, repo } = setup();
    await svc.deleteTranscript('jwt', 'sess-1');
    expect(repo.deleteTranscript).toHaveBeenCalled();
  });

  it('requires SEPARATE consent to share a transcript with a consultant', async () => {
    const { svc, repo } = setup(); // has microphone + transcription only
    await expect(
      svc.attachToConsultation('jwt', USER, 'sess-1', 'consult-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.linkEscalation).not.toHaveBeenCalled();
  });

  it('attaches once sharing consent exists', async () => {
    const { svc, repo } = setup({
      consents: [...FULL_CONSENT, grant('transcript_sharing')],
    });
    await svc.attachToConsultation('jwt', USER, 'sess-1', 'consult-1');
    expect(repo.linkEscalation).toHaveBeenCalledWith(
      expect.anything(),
      'sess-1',
      'consult-1',
    );
  });
});
