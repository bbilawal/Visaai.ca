import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { AuthUser } from './jwt.guard';

/**
 * Authorizes write actions on an application to its OWNER or an ADMIN only.
 * Reads `applicationId` from the route params (or body) and checks
 * `applications.user_id`. Must run after JwtGuard. Fails closed.
 *
 * Used on consultant assignment endpoints so that NOT every authenticated user
 * can assign a consultant — only the application owner or an admin.
 */
@Injectable()
export class OwnerOrAdminGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Typed rather than `any` — see ApplicationAccessGuard. Reading these three
    // fields correctly IS the job; an implicit `any` turns the compiler off
    // over exactly the code that decides access.
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

    const { data, error } = await this.supabase.admin
      .from('applications')
      .select('user_id')
      .eq('id', applicationId)
      .maybeSingle();

    if (error || !data)
      throw new ForbiddenException('Application not found or access denied');
    if (data.user_id !== user.id) {
      throw new ForbiddenException(
        'Only the application owner or an admin may perform this action',
      );
    }
    return true;
  }
}
