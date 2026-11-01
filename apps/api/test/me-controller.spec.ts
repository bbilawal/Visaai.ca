import { MeController } from '../src/modules/me/me.controller';
import type { AuthUser } from '../src/modules/auth/jwt.guard';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';

describe('MeController', () => {
  // me() takes no DB; stubs satisfy the constructor.
  const c = new MeController({} as SupabaseService, {} as never);
  it('returns id/email/appRole/isAnonymous from req.user (no service/DB)', () => {
    const u: AuthUser = {
      id: 'u1',
      email: 'e@x',
      role: 'authenticated',
      appRole: 'consultant',
      isAnonymous: false,
    };
    expect(c.me(u)).toEqual({
      id: 'u1',
      email: 'e@x',
      appRole: 'consultant',
      isAnonymous: false,
    });
  });
  it('defaults appRole to user when absent', () => {
    expect(
      c.me({ id: 'u1', email: 'e@x', role: 'authenticated' }).appRole,
    ).toBe('user');
  });
  it('defaults isAnonymous to false when absent', () => {
    expect(
      c.me({ id: 'u1', email: 'e@x', role: 'authenticated' }).isAnonymous,
    ).toBe(false);
  });
  it('surfaces an anonymous (guest) identity', () => {
    expect(
      c.me({
        id: 'g1',
        email: '',
        role: 'authenticated',
        appRole: 'user',
        isAnonymous: true,
      }).isAnonymous,
    ).toBe(true);
  });
});
