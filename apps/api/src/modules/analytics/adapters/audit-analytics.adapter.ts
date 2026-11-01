import { Injectable, Optional } from '@nestjs/common';
import { AnalyticsEventBus } from '../analytics-event-bus';
import { makeServerEvent } from '../events/catalog';

/**
 * Non-invasive bridge: callers that already append certain audit events also
 * call this to mirror them into analytics as `audit.mirrored`. Does NOT touch
 * `audit.service.ts` or the hash-chain — this is a side-channel observer, not
 * a source of truth. If this bus is unavailable (@Optional), mirroring is a
 * silent no-op and the audit append itself is unaffected.
 */
@Injectable()
export class AuditAnalyticsAdapter {
  constructor(@Optional() private readonly analytics?: AnalyticsEventBus) {}

  mirror(applicationId: string, auditType: string): void {
    this.analytics?.emitSafe(
      makeServerEvent('audit.mirrored', {
        application_id: applicationId,
        props: { audit_type: auditType },
      }),
    );
  }
}
