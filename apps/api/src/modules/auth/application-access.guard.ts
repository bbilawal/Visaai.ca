import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { AuthUser } from './jwt.guard';

/**
 * Authorizes READ access to an application to the people who legitimately have
 * a relationship with it: the OWNER, an ADMIN, or a consultant with an ACTIVE
 * assignment (primary or backup — backups have full access by design, P3c).
 *
 * WHY THIS EXISTS SEPARATELY FROM OwnerOrAdminGuard.
 *
 * `OwnerOrAdminGuard` is the right control for assignment *writes* — only the
 * applicant or an admin may decide who works on their case. It is the wrong
 * control for assignment *reads*, because it would lock out the very consultant
 * the assignment is about.
 *
 * The gap this closes: three read routes on the consultant controller
 * (`GET assignment`, `GET assignments`, `GET approval`) carried only the
 * class-level `@UseGuards(JwtGuard)`, so they proved a caller was logged in and
 * nothing more. Their services read through the service-role client, which
 * bypasses RLS, keyed on the path parameter alone. Any authenticated user who
 * knew or guessed an application UUID could read that application's consultant
 * assignment, its full reassignment history, and the per-field consultant
 * decision rollup for an applicant they had no relationship with.
 *
 * Fails closed: an unknown application, a database error, or an unauthenticated
 * request is a refusal, never a pass.
 */
@Injectable()
export class ApplicationAccessGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Typed rather than left as `any`: the whole job of this class is to read
    // three request fields correctly, and an implicit `any` here means the
    // compiler stops checking the one thing that matters.
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      params?: Record<string, string | undefined>;
      body?: Record<string, unknown>;
    }>();

    const user = request.user;
    if (!user?.id) throw new ForbiddenException('User not authenticated');

    if (user.appRole === 'admin') return true; // admin override

    const applicationId =
      request.params?.applicationId ??
      (typeof request.body?.applicationId === 'string'
        ? request.body.applicationId
        : undefined);
    if (!applicationId) throw new ForbiddenException('Application ID required');

    const { data: app, error } = await this.supabase.admin
      .from('applications')
      .select('user_id')
      .eq('id', applicationId)
      .maybeSingle();

    if (error || !app) {
      throw new ForbiddenException('Application not found or access denied');
    }

    if ((app as { user_id?: string }).user_id === user.id) return true;

    // Not the owner — allow only an ACTIVE assignee. `status = 'active'`
    // matters: a consultant whose assignment was revoked or superseded by a
    // reassignment must lose access at that moment, not keep it.
    const { data: assignment } = await this.supabase.admin
      .from('consultant_assignments')
      .select('id')
      .eq('application_id', applicationId)
      .eq('consultant_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (assignment) return true;

    throw new ForbiddenException(
      'Only the application owner, an assigned consultant, or an admin may view this',
    );
  }
}
