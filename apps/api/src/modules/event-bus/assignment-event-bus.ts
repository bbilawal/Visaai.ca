import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type {
  ConsultantQueueEvent,
  ConsultantQueueEventType,
} from '@visaai/types';
import { consultantCoversCountry } from '../../strategies';

/**
 * Internal domain event raised by the assignment lifecycle. Carries enough
 * context for the SSE layer to decide per-consultant relevance + visibility.
 * Services emit these; they know NOTHING about streaming.
 */
export interface AssignmentBusEvent {
  type: ConsultantQueueEventType;
  application_id: string;
  destination_country: string | null;
  previous_consultant_id: string | null;
  new_consultant_id: string | null;
  timestamp: string;
}

/**
 * AssignmentEventBus — in-process pub/sub seam decoupling the assignment
 * services from the SSE delivery layer. Single hot Subject; subscribers
 * (one per SSE connection) filter for their own consultant. Stateless and
 * horizontally scalable behind a Redis fan-out later (swap the Subject for a
 * Redis-backed Observable; nothing else changes).
 */
@Injectable()
export class AssignmentEventBus {
  private readonly subject = new Subject<AssignmentBusEvent>();

  /** Emit a lifecycle event. `timestamp` defaulted if omitted. */
  emit(
    e: Omit<AssignmentBusEvent, 'timestamp'> & { timestamp?: string },
  ): void {
    this.subject.next({
      ...e,
      timestamp: e.timestamp ?? new Date().toISOString(),
    });
  }

  /** The shared event stream. */
  get events(): Observable<AssignmentBusEvent> {
    return this.subject.asObservable();
  }
}

// ---- pure per-consultant filters (no NestJS / streaming deps) ----------

/**
 * An event is relevant to a consultant iff the application's destination is in
 * their country scope, OR they are the previous/new assignee (so they learn
 * when an app enters or leaves their own queue). Prevents cross-country leakage.
 */
export function isRelevantToConsultant(
  e: AssignmentBusEvent,
  consultantId: string,
  countries: ReadonlySet<string>,
): boolean {
  // Bloc-aware: a 'SCHENGEN' consultant is relevant to any member-coded app.
  if (consultantCoversCountry(countries, e.destination_country)) return true;
  if (e.new_consultant_id === consultantId) return true;
  if (e.previous_consultant_id === consultantId) return true;
  return false;
}

/**
 * Whether the application is (now) in THIS consultant's queue after the event.
 * - created/unassigned → visible if country-eligible (it is unassigned)
 * - assigned/self-assigned/reassigned → visible only if assigned to me
 */
export function computeVisibility(
  e: AssignmentBusEvent,
  consultantId: string,
  countries: ReadonlySet<string>,
): boolean {
  switch (e.type) {
    case 'APPLICATION_CREATED':
    case 'APPLICATION_UNASSIGNED':
      // Bloc-aware: a member-coded app is visible to a 'SCHENGEN' consultant.
      return consultantCoversCountry(countries, e.destination_country);
    case 'APPLICATION_ASSIGNED':
    case 'APPLICATION_SELF_ASSIGNED':
    case 'APPLICATION_REASSIGNED':
      return e.new_consultant_id === consultantId;
    default:
      return false;
  }
}

/** Project a bus event to the per-consultant SSE payload. */
export function toQueueEvent(
  e: AssignmentBusEvent,
  consultantId: string,
  countries: ReadonlySet<string>,
): ConsultantQueueEvent {
  return {
    event_type: e.type,
    application_id: e.application_id,
    destination_country: e.destination_country,
    consultant_visibility: computeVisibility(e, consultantId, countries),
    timestamp: e.timestamp,
  };
}
