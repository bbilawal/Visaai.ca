import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  AllowAnonymous,
  AllowUnauthenticated,
  JwtGuard,
} from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * `GET /feature-flags` → `{ flags: { key: boolean } }` for the caller.
 *
 * Only flags marked `clientExposed` in the registry are returned, and only as
 * evaluated booleans. Targeting rules — cohort names, allow-listed user ids,
 * the current rollout percentage — never cross the wire: a client that can read
 * "you are in the 10% bucket" can also read who else is, and rollout state is
 * competitively and operationally sensitive.
 *
 * `@AllowAnonymous` because guests are first-class here (anonymous Supabase
 * sign-in backs the public intake funnel) and the beta banner and kill switches
 * have to render correctly before signup. An anonymous caller has no stable
 * bucketing subject, so partial rollouts simply do not apply to them.
 */
@Controller('feature-flags')
@UseGuards(JwtGuard)
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /**
   * FLAG-001. @AllowAnonymous alone was not enough and the endpoint answered 401
   * to every logged-out caller — including the pre-signup surface this docblock
   * says it exists for. @AllowAnonymous admits a GUEST holding a token;
   * @AllowUnauthenticated admits a caller with no credential at all, which is
   * what the landing, pricing and signup screens are. A kill switch that cannot
   * be read before sign-in cannot kill anything on the pages most likely to need
   * it.
   *
   * The handler was already written for this: `user?.id` absent yields an empty
   * subject, so partial rollouts simply do not apply to an unidentified caller.
   */
  @Get()
  @AllowAnonymous()
  @AllowUnauthenticated()
  async list(@CurrentUser() user: AuthUser | null) {
    const subject = user?.id
      ? await this.flags.subjectFor({ id: user.id, appRole: user.appRole })
      : {};
    return { flags: await this.flags.evaluateAllForClient(subject) };
  }
}
