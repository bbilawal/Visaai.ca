import { io, type Socket } from 'socket.io-client';
import { env } from '@/config/env';
import { getAccessToken } from '@/auth/supabase';
import { api } from '@/api/client';

/**
 * Mobile voice client.
 *
 * Transport is socket.io (ADR 0001) — the same stack the intake chat uses, and
 * the reason SSE was rejected: React Native cannot consume it.
 *
 * Lifecycle (start/pause/end/consent) goes over REST because it is
 * request/response; only audio needs the socket.
 */
export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'ended';

export interface VoiceTurnEvent {
  transcript: string;
  answer: string;
  recommendsEscalation: boolean;
}

export interface VoiceClientHandlers {
  onState: (state: VoiceState) => void;
  /** Fires BEFORE audio, so the transcript is available even with sound off. */
  onTurn: (turn: VoiceTurnEvent) => void;
  onAudio: (audio: ArrayBuffer, mimeType: string) => void;
  onEnded: (reason: string) => void;
  onError: (message: string) => void;
}

export interface VoiceCapabilities {
  languages: string[];
  disclaimer: string;
  requiredConsents: string[];
}

export interface VoiceSessionSummary {
  id: string;
  language: string;
  status: string;
}

export interface VoiceTranscriptTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  created_at: string;
}

export const voiceApi = {
  capabilities: () => api.get<VoiceCapabilities>('/voice/capabilities', { auth: 'required' }),
  consents: () =>
    api.get<{ kind: string; granted: boolean }[]>('/voice/consents', { auth: 'required' }),
  recordConsent: (kind: string, granted: boolean) =>
    api.post<{ ok: true }>('/voice/consents', { kind, granted }, { auth: 'required' }),
  start: (input: { applicationId?: string; language?: string }) =>
    api.post<VoiceSessionSummary>('/voice/sessions', input, { auth: 'required' }),
  end: (id: string) =>
    api.post<VoiceSessionSummary>(`/voice/sessions/${id}/end`, undefined, { auth: 'required' }),
  transcript: (id: string) =>
    api.get<VoiceTranscriptTurn[]>(`/voice/sessions/${id}/transcript`, { auth: 'required' }),
  deleteTranscript: (id: string) =>
    api.delete<{ ok: true }>(`/voice/sessions/${id}/transcript`, undefined, { auth: 'required' }),
  attachToConsultation: (id: string, consultationId: string) =>
    api.post<{ ok: true }>(
      `/voice/sessions/${id}/attach-consultation`,
      { consultationId },
      { auth: 'required' },
    ),
};

export class VoiceClient {
  private socket: Socket | null = null;

  constructor(private readonly handlers: VoiceClientHandlers) {}

  async connect(sessionId: string): Promise<void> {
    const token = await getAccessToken();
    if (!token) throw new Error('Not signed in');

    // Auth travels in the handshake, matching the server's `server.use()` guard.
    this.socket = io(`${env.apiUrl}/voice`, {
      transports: ['websocket'],
      auth: { token },
    });

    this.socket.on('connect', () => {
      // Re-attach on every connect, including reconnects, so a dropped network
      // resumes the same conversation rather than losing it.
      this.socket?.emit('voice:attach', { sessionId });
    });
    this.socket.on('voice:attached', () => this.handlers.onState('idle'));
    this.socket.on('voice:state', (p: { state: VoiceState }) => this.handlers.onState(p.state));
    this.socket.on('voice:transcript', (p: VoiceTurnEvent) => this.handlers.onTurn(p));
    this.socket.on('voice:audio', (p: { audio: ArrayBuffer; mimeType: string }) =>
      this.handlers.onAudio(p.audio, p.mimeType),
    );
    this.socket.on('voice:ended', (p: { reason: string }) => {
      this.handlers.onState('ended');
      this.handlers.onEnded(p.reason);
    });
    this.socket.on('voice:error', (p: { message?: string }) =>
      this.handlers.onError(p.message ?? 'Something went wrong.'),
    );
    this.socket.on('connect_error', (err: Error) => this.handlers.onError(err.message));
  }

  /** Send one complete utterance. The client detects end-of-speech locally. */
  sendUtterance(audio: ArrayBuffer, mimeType: string): void {
    if (!this.socket?.connected) {
      this.handlers.onError('Not connected.');
      return;
    }
    this.socket.emit('voice:utterance', { audio, mimeType });
  }

  /** Barge-in: the user started speaking over the assistant. */
  interrupt(): void {
    this.socket?.emit('voice:interrupt');
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
