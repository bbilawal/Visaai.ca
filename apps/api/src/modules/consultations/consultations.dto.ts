import { z } from 'zod';

/**
 * Untrusted-input contracts for consultation booking. Every field the client
 * controls is bounded here — the controller parses before the service sees it,
 * matching the SubscriptionsController/BillingController convention introduced
 * in prod-hardening wave 1 (bare TS interfaces are erased at runtime and
 * validate nothing).
 */
const isoDateTime = z
  .string()
  .min(1)
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'must be an ISO 8601 datetime',
  });

/** IANA zone id, e.g. America/Toronto. Validated against the runtime's ICU data. */
const ianaTimezone = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (v) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'must be a valid IANA timezone' },
  );

export const SlotsQueryDto = z.object({
  from: isoDateTime,
  to: isoDateTime,
  // 15-minute granularity floor keeps the expansion bounded.
  slotMinutes: z.coerce.number().int().min(15).max(240).default(30),
});
export type SlotsQueryDto = z.infer<typeof SlotsQueryDto>;

/**
 * Booking windows are bounded in BOTH directions. This is a denial-of-service
 * control, not a convenience:
 *
 * `Date.parse` accepts absurd dates ("+275760-09-13T00:00:00Z" is valid), and
 * the availability check expands a slot grid across the requested range. An
 * unbounded end date therefore made a single authenticated POST spin ~10^8
 * iterations — each constructing an Intl.DateTimeFormat — and hang the Node
 * event loop for the whole process. `listSlots` had a range guard; `book` and
 * `reschedule` did not.
 */
export const MAX_BOOKING_MINUTES = 240;
export const MAX_BOOKING_HORIZON_DAYS = 365;

/**
 * Shared window check. Applied via `.superRefine` on each concrete schema
 * rather than a generic helper, because a generic over ZodRawShape loses the
 * field types and cannot read `scheduledStart` off the parsed value.
 */
function checkWindow(
  value: { scheduledStart: string; scheduledEnd: string },
  ctx: z.RefinementCtx,
): void {
  const start = Date.parse(value.scheduledStart);
  const end = Date.parse(value.scheduledEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;

  if (end <= start) {
    ctx.addIssue({
      code: 'custom',
      message: 'scheduledEnd must be after scheduledStart',
      path: ['scheduledEnd'],
    });
    return;
  }

  if ((end - start) / 60000 > MAX_BOOKING_MINUTES) {
    ctx.addIssue({
      code: 'custom',
      message: `a consultation may not exceed ${MAX_BOOKING_MINUTES} minutes`,
      path: ['scheduledEnd'],
    });
  }

  if (start > Date.now() + MAX_BOOKING_HORIZON_DAYS * 86_400_000) {
    ctx.addIssue({
      code: 'custom',
      message: `bookings may not be more than ${MAX_BOOKING_HORIZON_DAYS} days ahead`,
      path: ['scheduledStart'],
    });
  }
}

export const CreateBookingDto = z
  .object({
    consultantId: z.string().uuid(),
    scheduledStart: isoDateTime,
    scheduledEnd: isoDateTime,
    timezone: ianaTimezone,
    applicationId: z.string().uuid().optional(),
    // Meeting links are provisioned by the consultant's calendar integration;
    // the applicant only expresses a preference. Matches the DB check constraint.
    provider: z.enum(['zoom', 'google_meet', 'ms_teams']).default('zoom'),
  })
  .superRefine(checkWindow);
export type CreateBookingDto = z.infer<typeof CreateBookingDto>;

export const RescheduleBookingDto = z
  .object({
    scheduledStart: isoDateTime,
    scheduledEnd: isoDateTime,
    timezone: ianaTimezone,
  })
  .superRefine(checkWindow);
export type RescheduleBookingDto = z.infer<typeof RescheduleBookingDto>;
