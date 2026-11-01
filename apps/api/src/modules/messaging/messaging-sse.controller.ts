import {
  Controller,
  HttpException,
  HttpStatus,
  MessageEvent,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable, defer, interval, merge, throwError } from 'rxjs';
import { filter, finalize, map, startWith } from 'rxjs/operators';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MessagingEventBus, isRecipient } from './messaging-event-bus';
import { MessagingPresenceService } from './messaging-presence.service';
import { MessagingService } from './messaging.service';

/**
 * Real-time messaging stream (SSE). Per connection, forwards ONLY bus events
 * whose recipient_ids include the caller. The connection lifecycle drives
 * presence (connect on subscribe, disconnect on teardown). Per-user connections
 * are capped (429 over the cap); the route is @SkipThrottle'd because that cap —
 * not the global per-request rate limit — is the right control for a long-lived
 * stream. 25s heartbeat keeps idle proxies from dropping the stream.
 */
@Controller('messaging')
@UseGuards(JwtGuard)
@SkipThrottle()
export class MessagingSseController {
  constructor(
    private readonly bus: MessagingEventBus,
    private readonly presence: MessagingPresenceService,
    private readonly svc: MessagingService,
  ) {}

  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const uid = user.id;
    return defer(() => {
      if (!this.presence.tryConnect(uid)) {
        return throwError(
          () =>
            new HttpException(
              'Too many SSE connections',
              HttpStatus.TOO_MANY_REQUESTS,
            ),
        );
      }
      void this.svc.markDeliveredOnConnect(uid); // best-effort; never block the stream
      const events: Observable<MessageEvent> = this.bus.events.pipe(
        filter((e) => isRecipient(e, uid)),
        map((e) => ({
          data: {
            type: e.type,
            conversation_id: e.conversation_id,
            application_id: e.application_id,
          },
        })),
      );
      const heartbeat: Observable<MessageEvent> = interval(25_000).pipe(
        map(() => ({ data: { heartbeat: true } })),
      );
      const connected: MessageEvent = { data: { connected: true } };
      return merge(events, heartbeat).pipe(
        startWith(connected),
        finalize(() => this.presence.disconnect(uid)),
      );
    });
  }
}
