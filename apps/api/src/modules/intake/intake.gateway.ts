import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Server, Socket } from 'socket.io';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { GuardrailsService } from '../shared/guardrails/guardrails.service';
import { IntakeService } from './intake.service';
import { webOrigins } from '../../config/web-origins';

interface AuthenticatedSocket extends Socket {
  data: { userId?: string; accessToken?: string };
}

@WebSocketGateway({
  cors: {
    origin: webOrigins(),
    credentials: true,
  },
  namespace: '/intake',
})
export class IntakeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly log = new Logger(IntakeGateway.name);

  constructor(
    private intake: IntakeService,
    private supabase: SupabaseService,
    private guardrails: GuardrailsService,
  ) {}

  // Authenticate during the handshake (before the client `connect` fires) so
  // userId is guaranteed set before any message handler runs. Validating inside
  // an async handleConnection races with `intake:start`, which arrives before
  // getUser() resolves and emits a spurious "Unauthorized".
  afterInit(server: Server) {
    server.use(async (client: Socket, next: (err?: Error) => void) => {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        return next(new Error('Unauthorized: no token'));
      }
      try {
        const { data, error } = await this.supabase.admin.auth.getUser(token);
        if (error || !data?.user?.id) {
          return next(new Error('Unauthorized: invalid token'));
        }
        (client as AuthenticatedSocket).data.userId = data.user.id;
        // F1: keep the token so message handlers can build an RLS-scoped client.
        (client as AuthenticatedSocket).data.accessToken = token;
        return next();
      } catch (err) {
        return next(
          new Error(err instanceof Error ? err.message : 'Unauthorized'),
        );
      }
    });
  }

  handleConnection(client: AuthenticatedSocket) {
    console.log(`Socket: User ${client.data.userId} connected`, {
      clientId: client.id,
    });
  }

  handleDisconnect(_client: AuthenticatedSocket) {}

  // Log the full error server-side, return a clean, user-facing message plus
  // whether trying again can plausibly work. Provider failures (bad API key,
  // rate limit) must not leak raw stack/keys to the client, and a silent
  // failure leaves the intake UI blank.
  //
  // `retryable` exists because the client cannot tell the two apart from prose
  // and previously treated every failure as terminal: it showed the banner and
  // waited, so a one-second blip ended the interview. A refusal (denied,
  // unauthorized) must NOT be marked retryable — retrying that is a loop.
  private toClientMessage(
    err: unknown,
    context: string,
  ): { message: string; retryable: boolean } {
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[intake] ${context} failed:`, raw);

    const lower = raw.toLowerCase();
    if (lower.includes('access denied') || lower.includes('forbidden')) {
      return {
        message: 'You do not have access to this application.',
        retryable: false,
      };
    }
    if (lower.includes('could not read the application')) {
      return {
        message: 'We could not reach your application just now. Retrying…',
        retryable: true,
      };
    }
    if (
      lower.includes('401') ||
      lower.includes('api key') ||
      lower.includes('authentication')
    ) {
      return {
        message:
          'The AI service is unavailable right now (configuration issue). Please try again later.',
        retryable: false,
      };
    }
    if (
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('quota')
    ) {
      return {
        message: 'The AI service is busy. Please try again in a moment.',
        retryable: true,
      };
    }
    if (
      lower.includes('timeout') ||
      lower.includes('etimedout') ||
      lower.includes('econn')
    ) {
      return {
        message: 'The AI service timed out. Please retry.',
        retryable: true,
      };
    }
    return {
      message: 'Something went wrong starting your intake. Please try again.',
      retryable: true,
    };
  }

  @SubscribeMessage('intake:start')
  async handleStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { applicationId: string },
  ) {
    const userId = client.data.userId;
    const token = client.data.accessToken;
    if (!userId || !token) {
      console.error('Socket: intake:start unauthorized', {
        clientId: client.id,
        handshake: client.handshake.auth,
      });
      client.emit('intake:error', { message: 'Unauthorized' });
      return;
    }

    client.join(`intake:${data.applicationId}`);

    try {
      // F1: RLS-scoped client built from the connection's access token.
      const db = this.supabase.forUser(token);
      const state = await this.intake.startOrResume(
        db,
        data.applicationId,
        userId,
      );
      const history = await this.intake.getMessages(
        db,
        data.applicationId,
        userId,
      );
      client.emit('intake:history', {
        messages: history,
        checklistItems: state.checklistItems,
        isComplete: state.isComplete,
      });
    } catch (err) {
      client.emit('intake:error', this.toClientMessage(err, 'intake:start'));
    }
  }

  @SubscribeMessage('intake:message')
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { applicationId: string; text: string },
  ) {
    const userId = client.data.userId;
    const token = client.data.accessToken;
    if (!userId || !token) {
      client.emit('intake:error', { message: 'Unauthorized' });
      return;
    }

    // Guardrail (pre-LLM): if the user is asking for legal advice, an approval
    // prediction, or help to misrepresent, refuse and escalate. Do not run the graph.
    const intent = this.guardrails.classifyIntent(data.text);
    if (!intent.safe) {
      client.emit('intake:message', {
        role: 'assistant',
        content: this.guardrails.refusalMessage,
        guardrail: intent.label,
      });
      return;
    }

    // Correlates the token stream with the message that closes it. A slow turn
    // and a fast one can overlap on one socket (a reconnect replays a send),
    // and without an id the browser would splice the two replies together.
    const turnId = randomUUID();

    // Guardrail (post-LLM): never let an approval guarantee / outcome
    // prediction ship. Runs on the COMPLETE reply, which is why the streamed
    // chunks above it are only ever a preview.
    let delivered = false;
    const deliver = (raw: string, isComplete: boolean) => {
      const output = this.guardrails.filterOutput(raw);

      // Say so when a reply is suppressed.
      //
      // A suppressed turn is invisible otherwise: the applicant receives the
      // refusal text, the model's actual answer is discarded, and nothing
      // anywhere records that it happened or why. That is how a false positive
      // survives — on 2026-09-04 the filter was replacing whole replies because
      // the model correctly wrote "a Super Visa does not guarantee entry", and
      // the only evidence was an applicant seeing a legal-advice disclaimer
      // after answering a factual question.
      //
      // The tags say which rule fired; the snippet is capped and is model
      // output, not applicant input, so it carries no personal data of its own.
      if (!output.safe) {
        this.log.warn(
          `reply suppressed by guardrail [${output.violations?.join(', ') ?? 'unknown'}] ` +
            `application=${data.applicationId} turn=${turnId} ` +
            `text="${raw.slice(0, 160).replace(/\s+/g, ' ')}"`,
        );
      }

      delivered = true;
      client.emit('intake:message', {
        role: 'assistant',
        turnId,
        content: output.safe ? raw : output.safeFallback,
        isComplete,
      });
    };

    try {
      const db = this.supabase.forUser(token);
      const state = await this.intake.sendMessage(
        db,
        data.applicationId,
        userId,
        data.text,
        {
          // Fire-and-forget preview so the reply paints as it is written rather
          // than after the whole generation. A browser that has navigated away
          // simply stops receiving these.
          onToken: (delta) => client.emit('intake:token', { turnId, delta }),
          // Delivery, the moment the reply exists — NOT when the graph
          // settles. update_checklist runs as a sibling branch and regularly
          // outlasts the question; delivering on graph completion left the
          // applicant looking at a finished answer with the input still
          // disabled behind a checklist rebuild they were not waiting for.
          onReady: (question, isComplete) => deliver(question, isComplete),
        },
      );

      // The turn ended without the node running — a completed intake stops at
      // check_complete and never reaches ask_question.
      if (!delivered) {
        deliver(
          state.currentQuestion ?? 'Your intake is complete.',
          state.isComplete,
        );
      }
    } catch (err) {
      if (!delivered) {
        // Close the stream first. The browser is holding a partial reply it
        // was told to expect a terminator for; leaving it there would show the
        // applicant half a sentence styled as a finished answer.
        client.emit('intake:token:abort', { turnId });
        client.emit(
          'intake:error',
          this.toClientMessage(err, 'intake:message'),
        );
        return;
      }
      // The reply is already on screen and only the sibling branch failed.
      // Replacing a good answer with an error banner would be a worse lie than
      // a checklist that did not change this turn, so this is logged and not
      // surfaced. (update_checklist already swallows its own LLM errors; this
      // is the path for everything it does not.)
      console.error('[intake] post-delivery branch failed', err);
    }
  }
}
