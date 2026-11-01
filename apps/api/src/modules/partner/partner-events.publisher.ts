import { Injectable, Logger } from '@nestjs/common';
import type { PartnerEventType } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { PartnerWebhookService } from './partner-webhook.service';

/**
 * The seam other modules use to emit a partner event.
 *
 * Two properties matter:
 *
 * 1. **Never throws.** A failure to notify a partner must not roll back the
 *    business action that caused it. An applicant's document upload does not
 *    fail because a partner's webhook table is unavailable.
 *
 * 2. **Minimal payloads.** Only identifiers and status cross this boundary.
 *    The emitting module passes what it already knows; nothing here reaches
 *    back into the database to enrich an event, because enrichment is how
 *    payloads quietly grow into personal data.
 *
 * Only wired to the marketplace assignment flow today. The other event types
 * are declared and deliverable but nothing emits them yet — see PD-1.
 */
@Injectable()
export class PartnerEventsPublisher {
  private readonly log = new Logger(PartnerEventsPublisher.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooks: PartnerWebhookService,
  ) {}

  /**
   * Emit an event about a user's resource.
   *
   * The organization is resolved from the SUBJECT — a partner hears about a
   * user only when that user belongs to their organization. Resolution failure
   * means no organization, which means no delivery: silence is the safe
   * failure mode for a notification about someone's immigration case.
   */
  async emitForUser(input: {
    subjectUserId: string;
    eventType: PartnerEventType;
    resourceType: string;
    resourceId: string | null;
    data: Record<string, unknown>;
  }): Promise<void> {
    try {
      const organizationId = await this.organizationOf(input.subjectUserId);
      if (!organizationId) return;

      await this.webhooks.publish({
        organizationId,
        subjectUserId: input.subjectUserId,
        eventType: input.eventType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        environment: 'live',
        data: input.data,
      });
    } catch (err) {
      this.log.error(
        `failed to publish partner event ${input.eventType}: ${(err as Error).message}`,
      );
    }
  }

  private async organizationOf(userId: string): Promise<string | null> {
    const res = await this.supabase.admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    const value = (res.data as { organization_id?: unknown } | null)
      ?.organization_id;
    return typeof value === 'string' ? value : null;
  }
}
