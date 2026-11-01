import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from './jwt.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

/**
 * F1: injects the RLS-enforcing Supabase client scoped to the current user's
 * token (set by JwtGuard). Use this in request handlers instead of
 * SupabaseService.admin so Row-Level Security applies to every query.
 */
export const SupabaseUserClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SupabaseClient => {
    const request = ctx.switchToHttp().getRequest();
    return request.supabaseUser;
  },
);
