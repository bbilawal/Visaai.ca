import {
  generateInviteToken,
  hasPermission,
  invitationExpiry,
  isInvitationAcceptable,
  isLocked,
  legacyAppRole,
  MAX_FAILED_ATTEMPTS,
  nextLockoutState,
  resolvePermissions,
  slugify,
} from './iam.engine';

const NOW = new Date('2026-06-28T12:00:00Z');

describe('iam.engine', () => {
  describe('resolvePermissions / hasPermission', () => {
    it('unions role permission sets and de-dupes', () => {
      const perms = resolvePermissions([
        ['profile.read', 'org.read'],
        ['org.read', 'org.update'],
      ]);
      expect(perms.sort()).toEqual(['org.read', 'org.update', 'profile.read']);
    });

    it('wildcard grants everything', () => {
      const perms = resolvePermissions([['*']]);
      expect(hasPermission(perms, 'anything.at.all')).toBe(true);
      expect(hasPermission(perms, 'org.update')).toBe(true);
    });

    it('non-wildcard grants only listed permissions', () => {
      const perms = ['profile.read'];
      expect(hasPermission(perms, 'profile.read')).toBe(true);
      expect(hasPermission(perms, 'org.update')).toBe(false);
    });
  });

  describe('legacyAppRole', () => {
    it('platform_admin / super_admin -> admin', () => {
      expect(legacyAppRole(['platform_admin'])).toBe('admin');
      expect(legacyAppRole(['super_admin', 'applicant'])).toBe('admin');
    });
    it('consultant -> consultant', () => {
      expect(legacyAppRole(['consultant', 'applicant'])).toBe('consultant');
    });
    it('applicant / support_agent / org_admin -> user', () => {
      expect(legacyAppRole(['applicant'])).toBe('user');
      expect(legacyAppRole(['support_agent'])).toBe('user');
      expect(legacyAppRole(['org_admin'])).toBe('user');
      expect(legacyAppRole([])).toBe('user');
    });
    it('admin beats consultant when both present', () => {
      expect(legacyAppRole(['consultant', 'platform_admin'])).toBe('admin');
    });
  });

  describe('account lockout', () => {
    it('increments on failure, no lock before threshold', () => {
      const s = nextLockoutState(
        { failed_count: 0, locked_until: null },
        false,
        NOW,
      );
      expect(s.failed_count).toBe(1);
      expect(s.locked_until).toBeNull();
      expect(s.just_locked).toBe(false);
    });

    it('locks at the threshold and resets the counter', () => {
      const s = nextLockoutState(
        { failed_count: MAX_FAILED_ATTEMPTS - 1, locked_until: null },
        false,
        NOW,
      );
      expect(s.just_locked).toBe(true);
      expect(s.failed_count).toBe(0);
      expect(s.locked_until).not.toBeNull();
    });

    it('success resets state', () => {
      const s = nextLockoutState(
        { failed_count: 3, locked_until: null },
        true,
        NOW,
      );
      expect(s).toMatchObject({ failed_count: 0, locked_until: null });
    });

    it('isLocked reflects locked_until vs now', () => {
      const future = new Date(NOW.getTime() + 60_000).toISOString();
      const past = new Date(NOW.getTime() - 60_000).toISOString();
      expect(isLocked({ failed_count: 0, locked_until: future }, NOW)).toBe(
        true,
      );
      expect(isLocked({ failed_count: 0, locked_until: past }, NOW)).toBe(
        false,
      );
      expect(isLocked(null, NOW)).toBe(false);
    });
  });

  describe('invitations', () => {
    it('tokens are unique and long', () => {
      const a = generateInviteToken();
      const b = generateInviteToken();
      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThan(20);
    });

    it('pending + unexpired is acceptable', () => {
      const exp = invitationExpiry(NOW);
      expect(
        isInvitationAcceptable({ status: 'pending', expires_at: exp }, NOW),
      ).toBe(true);
    });

    it('expired or non-pending is not acceptable', () => {
      const past = new Date(NOW.getTime() - 1000).toISOString();
      const future = invitationExpiry(NOW);
      expect(
        isInvitationAcceptable({ status: 'pending', expires_at: past }, NOW),
      ).toBe(false);
      expect(
        isInvitationAcceptable({ status: 'accepted', expires_at: future }, NOW),
      ).toBe(false);
      expect(isInvitationAcceptable(null, NOW)).toBe(false);
    });
  });

  describe('slugify', () => {
    it('produces url-safe slugs', () => {
      expect(slugify('Acme Immigration Inc.')).toBe('acme-immigration-inc');
      expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
      expect(slugify('***')).toBe('org');
    });
  });
});
