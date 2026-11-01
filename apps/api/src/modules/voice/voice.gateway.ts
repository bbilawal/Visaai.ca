import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { VoiceSessionService } from './voice-session.service';
import { webOrigins } from '../../config/web-origins';

interface VoiceSocket extends Socket {
  data: { userId?: string; accessToken?: string; sessionId?: string };
}

/** Hard ceiling on one utterance. Larger frames are dropped, not buffered. */
const MAX_UTTERANCE_BYTES = 5 * 1024 * 1024;

/**
 * Voice audio transport.
 *
 * Follows `IntakeGateway` exactly: the Supabase token is validated in a
 * handshake middleware, BEFORE `connect` fires, so `userId` is guaranteed set
 * by the time any message handler runs. Validating inside `handleConnection`
 * races with the first inbound frame.
 *
 * Audio is held in memory for one utterance and discarded after transcription —
 * nothing is written to disk (see voice-privacy-and-retention.md).
 */
@WebSocketGateway({
  cors: {
    origin: webOrigins(),
    credentials: true,
  },
  namespace: '/voice',
  // An utterance arrives as one binary payload; leave headroom over the cap so
  // an oversize frame is rejected by us with a clear error rather than by the
  // transport with a silent disconnect.
  maxHttpBufferSize: MAX_UTTERANCE_BYTES + 1024 * 1024,
})
export class VoiceGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger(VoiceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: VoiceSessionService,
    private readonly supabase: SupabaseService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (client: Socket, next: (err?: Error) => void) => {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Unauthorized'));
      try {
        const { data, error } = await this.supabase.admin.auth.getUser(token);
        if (error || !data.user) return next(new Error('Unauthorized'));
        // Anonymous (guest) identities cannot hold a voice session: there is no
        // case to discuss, no consent record, and no account to meter against.
        if (data.user.is_anonymous)
          return next(new Error('Voice requires an account'));
        (client as VoiceSocket).data.userId = data.user.id;
        (client as VoiceSocket).data.accessToken = token;
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: VoiceSocket): void {
    this.log.log(`voice socket connected for ${client.data.userId}`);
  }

  /**
   * Bind this socket to an existing session. Sent on connect AND after a
   * reconnect, so a dropped network does not lose the conversation.
   */
  @SubscribeMessage('voice:attach')
  async attach(
    @ConnectedSocket() client: VoiceSocket,
    @MessageBody() body: { sessionId?: string },
  ): Promise<void> {
    const { accessToken, userId } = client.data;
    if (!accessToken || !userId || !body?.sessionId) {
      client.emit('voice:error', { code: 'bad_request' });
      return;
    }
    try {
      const session = await this.sessions.resumeAfterReconnect(
        accessToken,
        body.sessionId,
      );
      client.data.sessionId = session.id;
      client.emit('voice:attached', {
        sessionId: session.id,
        language: session.language,
        status: session.status,
      });
    } catch (err) {
      client.emit('voice:error', {
        code: 'attach_failed',
        message: (err as Error).message,
      });
    }
  }

  /**
   * One complete utterance. The client does voice-activity detection locally
   * and sends when the user stops speaking — that keeps silence off the wire
   * and out of the STT bill.
   */
  @SubscribeMessage('voice:utterance')
  async utterance(
    @ConnectedSocket() client: VoiceSocket,
    @MessageBody() body: { audio?: ArrayBuffer | Buffer; mimeType?: string },
  ): Promise<void> {
    const { accessToken, userId, sessionId } = client.data;
    if (!accessToken || !userId || !sessionId) {
      client.emit('voice:error', { code: 'not_attached' });
      return;
    }

    const audio = body?.audio ? Buffer.from(body.audio as ArrayBuffer) : null;
    if (!audio?.length) {
      client.emit('voice:error', { code: 'empty_audio' });
      return;
    }
    if (audio.length > MAX_UTTERANCE_BYTES) {
      client.emit('voice:error', { code: 'utterance_too_large' });
      return;
    }

    // Tell the client we are working so it can show a "thinking" state rather
    // than dead air.
    client.emit('voice:state', { state: 'processing' });

    try {
      const result = await this.sessions.runTurn(
        accessToken,
        { id: userId },
        {
          sessionId,
          audio,
          mimeType: body.mimeType ?? 'audio/webm',
        },
      );

      // Transcript first: a deaf or hard-of-hearing user, or anyone with audio
      // muted, gets the full answer as text regardless of playback.
      client.emit('voice:transcript', {
        transcript: result.transcript,
        answer: result.answer,
        recommendsEscalation: result.recommendsEscalation,
      });
      client.emit('voice:audio', {
        audio: result.audio,
        mimeType: result.audioMimeType,
      });

      if (result.endedReason) {
        client.emit('voice:ended', { reason: result.endedReason });
        client.data.sessionId = undefined;
      } else {
        client.emit('voice:state', { state: 'idle' });
      }
    } catch (err) {
      this.log.error(`voice turn failed: ${(err as Error).message}`);
      // Never surface a raw provider or database error to the client.
      client.emit('voice:error', {
        code: 'turn_failed',
        message: 'Something went wrong. You can try again.',
      });
      client.emit('voice:state', { state: 'idle' });
    }
  }

  /** User interruption: stop speaking immediately. */
  @SubscribeMessage('voice:interrupt')
  interrupt(@ConnectedSocket() client: VoiceSocket): void {
    // Playback lives on the client, so interruption is a client-side stop; the
    // server acknowledges so the UI can settle its state deterministically.
    client.emit('voice:state', { state: 'idle' });
  }
}
