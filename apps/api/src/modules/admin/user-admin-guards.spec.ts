import { canLifecycle, canRemoveAdmin, planBulk } from './user-admin-guards';
const T = (over = {}) => ({
  id: 'u1',
  status: 'active' as const,
  isAdmin: false,
  ...over,
});

describe('canLifecycle', () => {
  it('allows active -> suspended for a non-self non-admin', () => {
    expect(
      canLifecycle('suspend', { actorId: 'admin', target: T(), adminCount: 2 }),
    ).toEqual({ allowed: true });
  });
  it('rejects illegal transition (suspend a deleted user)', () => {
    const d = canLifecycle('suspend', {
      actorId: 'admin',
      target: T({ status: 'deleted' }),
      adminCount: 2,
    });
    expect(d.allowed).toBe(false);
  });
  it('blocks self-suspend', () => {
    const d = canLifecycle('suspend', {
      actorId: 'u1',
      target: T({ id: 'u1' }),
      adminCount: 2,
    });
    expect(d).toEqual({
      allowed: false,
      reason: expect.stringContaining('your own'),
    });
  });
  it('blocks suspending the last admin', () => {
    const d = canLifecycle('suspend', {
      actorId: 'admin',
      target: T({ isAdmin: true }),
      adminCount: 1,
    });
    expect(d.allowed).toBe(false);
  });
  it('allows suspending an admin when others remain', () => {
    expect(
      canLifecycle('suspend', {
        actorId: 'admin',
        target: T({ isAdmin: true }),
        adminCount: 2,
      }),
    ).toEqual({ allowed: true });
  });
  it('restore only from deleted; reactivate only from suspended', () => {
    expect(
      canLifecycle('restore', {
        actorId: 'a',
        target: T({ status: 'deleted' }),
        adminCount: 2,
      }).allowed,
    ).toBe(true);
    expect(
      canLifecycle('reactivate', {
        actorId: 'a',
        target: T({ status: 'active' }),
        adminCount: 2,
      }).allowed,
    ).toBe(false);
  });
  it('blocks self soft-delete', () => {
    const d = canLifecycle('soft-delete', {
      actorId: 'u1',
      target: T({ id: 'u1' }),
      adminCount: 2,
    });
    expect(d).toEqual({
      allowed: false,
      reason: expect.stringContaining('your own'),
    });
  });
  it('fails closed when adminCount is NaN for an admin target (no orphan bypass)', () => {
    const d = canLifecycle('suspend', {
      actorId: 'other',
      target: T({ isAdmin: true }),
      adminCount: NaN,
    });
    expect(d).toEqual({ allowed: false, reason: 'invalid adminCount' });
  });
});

describe('canRemoveAdmin', () => {
  it('blocks removing the last admin and self-demotion', () => {
    expect(
      canRemoveAdmin({
        actorId: 'a',
        targetId: 'b',
        targetIsAdmin: true,
        adminCount: 1,
      }).allowed,
    ).toBe(false);
    expect(
      canRemoveAdmin({
        actorId: 'a',
        targetId: 'a',
        targetIsAdmin: true,
        adminCount: 3,
      }).allowed,
    ).toBe(false);
    expect(
      canRemoveAdmin({
        actorId: 'a',
        targetId: 'b',
        targetIsAdmin: false,
        adminCount: 1,
      }).allowed,
    ).toBe(true);
  });
  it('allows removing an admin when others remain', () => {
    expect(
      canRemoveAdmin({
        actorId: 'a',
        targetId: 'b',
        targetIsAdmin: true,
        adminCount: 2,
      }),
    ).toEqual({ allowed: true });
  });
  it('fails closed on NaN adminCount', () => {
    expect(
      canRemoveAdmin({
        actorId: 'a',
        targetId: 'b',
        targetIsAdmin: true,
        adminCount: NaN,
      }),
    ).toEqual({ allowed: false, reason: 'invalid adminCount' });
  });
});

describe('planBulk', () => {
  it('skips blocked items without failing the batch and never drains admins', () => {
    const targets = [
      T({ id: 'x' }),
      T({ id: 'self' }),
      T({ id: 'a1', isAdmin: true }),
      T({ id: 'a2', isAdmin: true }),
    ];
    const { toApply, skipped } = planBulk('suspend', targets, {
      actorId: 'self',
      adminCount: 2,
    });
    expect(toApply).toContain('x');
    expect(skipped.map((s) => s.id)).toContain('self');
    // two admins, only one may be suspended (second skipped to avoid zero-admin)
    const suspendedAdmins = toApply.filter((id) => id === 'a1' || id === 'a2');
    expect(suspendedAdmins).toHaveLength(1);
  });
  it('fails closed: NaN adminCount skips the whole batch for access-removing actions', () => {
    const targets = [T({ id: 'a1', isAdmin: true }), T({ id: 'x' })];
    const { toApply, skipped } = planBulk('suspend', targets, {
      actorId: 'z',
      adminCount: NaN,
    });
    expect(toApply).toEqual([]);
    expect(skipped.map((s) => s.id).sort()).toEqual(['a1', 'x']);
  });
});
