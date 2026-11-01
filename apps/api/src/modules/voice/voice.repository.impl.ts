import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsentKind, ConsentRecord } from './voice-safety';
import type {
  IVoiceRepository,
  TurnUsageDelta,
  UsageTotals,
  VoiceSession,
  VoiceSessionStatus,
  VoiceTurn,
} from './voice.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

const LIVE: VoiceSessionStatus[] = ['active', 'paused'];

@Injectable()
export class VoiceRepository implements IVoiceRepository {
  async createSession(
    db: SupabaseClient,
    input: { userId: string; applicationId: string | null; language: string },
  ): Promise<VoiceSession> {
    const res = await db
      .from('voice_sessions')
      .insert({
        user_id: input.userId,
        application_id: input.applicationId,
        language: input.language,
      })
      .select('*')
      .single();
    return unwrap<VoiceSession>(res, 'create voice session');
  }

  async getSession(
    db: SupabaseClient,
    id: string,
  ): Promise<VoiceSession | null> {
    // RLS scopes this to the caller's own sessions.
    const res = await db
      .from('voice_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as VoiceSession | null) ?? null;
  }

  async setStatus(
    db: SupabaseClient,
    id: string,
    status: VoiceSessionStatus,
    endReason?: string,
  ): Promise<VoiceSession> {
    const terminal =
      status === 'ended' || status === 'expired' || status === 'failed';
    const res = await db
      .from('voice_sessions')
      .update({
        status,
        ...(endReason ? { end_reason: endReason } : {}),
        ...(terminal ? { ended_at: new Date().toISOString() } : {}),
      })
      .eq('id', id)
      .select('*')
      .single();
    return unwrap<VoiceSession>(res, 'update voice session status');
  }

  async touch(db: SupabaseClient, id: string): Promise<void> {
    const res = await db
      .from('voice_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', id);
    if (res.error) throw new Error(res.error.message);
  }

  async addUsage(
    db: SupabaseClient,
    id: string,
    delta: TurnUsageDelta,
  ): Promise<VoiceSession> {
    // Read-modify-write. Acceptable because a session is pinned to one process
    // and one socket (ADR 0001), so there is no concurrent writer for a given
    // session. If sessions ever span workers this must become an RPC with an
    // atomic increment.
    const current = await this.getSession(db, id);
    if (!current) throw new Error('voice session not found');

    const res = await db
      .from('voice_sessions')
      .update({
        audio_ms: current.audio_ms + Math.max(0, Math.round(delta.audioMs)),
        tokens_used:
          current.tokens_used + Math.max(0, Math.round(delta.tokens)),
        cost_usd: Number(current.cost_usd) + Math.max(0, delta.costUsd),
        turn_count: current.turn_count + 1,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    return unwrap<VoiceSession>(res, 'add voice usage');
  }

  async usageTotals(db: SupabaseClient, userId: string): Promise<UsageTotals> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const res = await db
      .from('voice_sessions')
      .select('cost_usd, status, started_at')
      .eq('user_id', userId)
      .gte('started_at', monthStart.toISOString());
    if (res.error) throw new Error(res.error.message);

    const rows = (res.data ?? []) as {
      cost_usd: number;
      status: string;
      started_at: string;
    }[];
    let dailyCostUsd = 0;
    let monthlyCostUsd = 0;
    let concurrentSessions = 0;
    for (const row of rows) {
      const cost = Number(row.cost_usd) || 0;
      monthlyCostUsd += cost;
      if (new Date(row.started_at) >= dayStart) dailyCostUsd += cost;
      if (LIVE.includes(row.status as VoiceSessionStatus))
        concurrentSessions += 1;
    }
    return { dailyCostUsd, monthlyCostUsd, concurrentSessions };
  }

  async appendTurn(
    db: SupabaseClient,
    input: Omit<VoiceTurn, 'id' | 'created_at'> & { userId: string },
  ): Promise<VoiceTurn> {
    const res = await db
      .from('voice_transcript_turns')
      .insert({
        session_id: input.session_id,
        user_id: input.userId,
        role: input.role,
        text: input.text,
        redacted_text: input.redacted_text,
        language: input.language,
        confidence: input.confidence,
        safety_flags: input.safety_flags,
        audio_ms: input.audio_ms,
      })
      .select('*')
      .single();
    return unwrap<VoiceTurn>(res, 'append voice turn');
  }

  async listTurns(db: SupabaseClient, sessionId: string): Promise<VoiceTurn[]> {
    const res = await db
      .from('voice_transcript_turns')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as VoiceTurn[]) ?? [];
  }

  async deleteTranscript(db: SupabaseClient, sessionId: string): Promise<void> {
    const res = await db
      .from('voice_transcript_turns')
      .delete()
      .eq('session_id', sessionId);
    if (res.error) throw new Error(res.error.message);
  }

  async linkEscalation(
    db: SupabaseClient,
    sessionId: string,
    consultationId: string,
  ): Promise<void> {
    const res = await db
      .from('voice_sessions')
      .update({ escalated_to_consultation_id: consultationId })
      .eq('id', sessionId);
    if (res.error) throw new Error(res.error.message);
  }

  async listConsents(
    db: SupabaseClient,
    userId: string,
  ): Promise<ConsentRecord[]> {
    const res = await db
      .from('voice_consents')
      .select('kind, granted, policy_version, granted_at, revoked_at')
      .eq('user_id', userId);
    if (res.error) throw new Error(res.error.message);
    return (
      (res.data ?? []) as {
        kind: ConsentKind;
        granted: boolean;
        policy_version: string;
        granted_at: string | null;
        revoked_at: string | null;
      }[]
    ).map((row) => ({
      kind: row.kind,
      // A revoked consent is not a grant, whatever the flag says.
      granted: row.granted && !row.revoked_at,
      policyVersion: row.policy_version,
      grantedAt: row.granted_at ?? undefined,
    }));
  }

  async upsertConsent(
    db: SupabaseClient,
    input: {
      userId: string;
      kind: ConsentKind;
      granted: boolean;
      policyVersion: string;
    },
  ): Promise<ConsentRecord> {
    const now = new Date().toISOString();
    const res = await db
      .from('voice_consents')
      .upsert(
        {
          user_id: input.userId,
          kind: input.kind,
          granted: input.granted,
          policy_version: input.policyVersion,
          granted_at: input.granted ? now : null,
          // Withdrawal is recorded, not erased — the audit trail must show that
          // consent existed and when it stopped.
          revoked_at: input.granted ? null : now,
          updated_at: now,
        },
        { onConflict: 'user_id,kind,policy_version' },
      )
      .select('kind, granted, policy_version, granted_at')
      .single();
    const row = unwrap<{
      kind: ConsentKind;
      granted: boolean;
      policy_version: string;
      granted_at: string | null;
    }>(res, 'upsert voice consent');
    return {
      kind: row.kind,
      granted: row.granted,
      policyVersion: row.policy_version,
      grantedAt: row.granted_at ?? undefined,
    };
  }
}
