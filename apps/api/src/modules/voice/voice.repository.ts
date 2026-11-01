import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsentKind, ConsentRecord } from './voice-safety';

export type VoiceSessionStatus =
  | 'active'
  | 'paused'
  | 'ended'
  | 'expired'
  | 'failed';
export type TurnRole = 'user' | 'assistant' | 'system';

export interface VoiceSession {
  id: string;
  user_id: string;
  application_id: string | null;
  status: VoiceSessionStatus;
  language: string;
  audio_ms: number;
  tokens_used: number;
  cost_usd: number;
  turn_count: number;
  end_reason: string | null;
  escalated_to_consultation_id: string | null;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
}

export interface VoiceTurn {
  id: string;
  session_id: string;
  role: TurnRole;
  text: string;
  redacted_text: string | null;
  language: string | null;
  confidence: number | null;
  safety_flags: string[];
  audio_ms: number | null;
  created_at: string;
}

export interface UsageTotals {
  dailyCostUsd: number;
  monthlyCostUsd: number;
  concurrentSessions: number;
}

export interface TurnUsageDelta {
  audioMs: number;
  tokens: number;
  costUsd: number;
}

export interface IVoiceRepository {
  createSession(
    db: SupabaseClient,
    input: { userId: string; applicationId: string | null; language: string },
  ): Promise<VoiceSession>;
  getSession(db: SupabaseClient, id: string): Promise<VoiceSession | null>;
  setStatus(
    db: SupabaseClient,
    id: string,
    status: VoiceSessionStatus,
    endReason?: string,
  ): Promise<VoiceSession>;
  touch(db: SupabaseClient, id: string): Promise<void>;
  addUsage(
    db: SupabaseClient,
    id: string,
    delta: TurnUsageDelta,
  ): Promise<VoiceSession>;
  usageTotals(db: SupabaseClient, userId: string): Promise<UsageTotals>;
  appendTurn(
    db: SupabaseClient,
    input: Omit<VoiceTurn, 'id' | 'created_at'> & { userId: string },
  ): Promise<VoiceTurn>;
  listTurns(db: SupabaseClient, sessionId: string): Promise<VoiceTurn[]>;
  deleteTranscript(db: SupabaseClient, sessionId: string): Promise<void>;
  linkEscalation(
    db: SupabaseClient,
    sessionId: string,
    consultationId: string,
  ): Promise<void>;

  listConsents(db: SupabaseClient, userId: string): Promise<ConsentRecord[]>;
  upsertConsent(
    db: SupabaseClient,
    input: {
      userId: string;
      kind: ConsentKind;
      granted: boolean;
      policyVersion: string;
    },
  ): Promise<ConsentRecord>;
}

export const VOICE_REPOSITORY = Symbol('IVoiceRepository');
