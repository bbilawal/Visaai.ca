import { BadRequestException } from '@nestjs/common';
import type { ZodType, output } from 'zod';

/**
 * API-002: `@Body()` annotated with a TypeScript type is erased at runtime, so
 * a route declaring `body: { status?: string }` accepted literally anything.
 * Bad input reached the service or the database and surfaced as a 500 rather
 * than a 400.
 *
 * This mirrors the repository's existing zod idiom (matching.controller.ts,
 * privacy.controller.ts) as a one-liner so the pattern is cheap to apply:
 *
 *   const { status } = parseBody(UpdateStatusDto, body);
 *
 * Schemas deliberately MIRROR the previously declared TypeScript type rather
 * than tightening it. A route that accepted `status?: string` still accepts any
 * string — narrowing to an enum here would change behaviour beyond fixing the
 * validation gap, and any such narrowing is done explicitly, per route, where
 * the service already enforced the same constraint.
 *
 * Unknown keys are stripped (zod's default), which is the desired whitelist
 * behaviour: the service is typed against the declared fields and cannot read
 * anything else.
 */
export function parseBody<S extends ZodType>(
  schema: S,
  body: unknown,
): output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}
