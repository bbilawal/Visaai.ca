import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { Observable, from, interval, merge } from 'rxjs';
import { filter, map, startWith, switchMap } from 'rxjs/operators';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AssignmentService } from '../consultant/assignment.service';
import {
  AssignmentEventBus,
  isRelevantToConsultant,
  toQueueEvent,
} from '../event-bus/assignment-event-bus';

/**
 * Real-time consultant queue (SSE). Consultant-only. PURE delivery: per
 * connection it loads the caller's country scope once, then forwards ONLY the
 * bus events relevant to that consultant (country scope OR they are an
 * assignee). No cross-country leakage, per-user isolation, no broadcast. The
 * client refetches the authoritative queue on each event (Option A).
 */
@Controller('realtime/consultant-queue')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('consultant')
export class RealtimeController {
  constructor(
    private readonly bus: AssignmentEventBus,
    private readonly assignment: AssignmentService,
  ) {}

  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const uid = user.id;
    return from(this.assignment.listConsultantCountries(uid)).pipe(
      switchMap((arr) => {
        const countries = new Set(arr);
        const queue: Observable<MessageEvent> = this.bus.events.pipe(
          filter((e) => isRelevantToConsultant(e, uid, countries)),
          map((e) => ({ data: toQueueEvent(e, uid, countries) })),
        );
        // keepalive so idle proxies don't drop the stream
        const heartbeat: Observable<MessageEvent> = interval(25_000).pipe(
          map(() => ({ data: { heartbeat: true } })),
        );
        const connected: MessageEvent = { data: { connected: true } };
        return merge(queue, heartbeat).pipe(startWith(connected));
      }),
    );
  }
}
