import { resolveDistinct } from './identity.resolver';

describe('resolveDistinct', () => {
  it('merges anon + identified events for the same human to one', () => {
    const map = new Map([['anon_1', 'user_1']]);
    const n = resolveDistinct(
      [
        { userId: null, anonymousId: 'anon_1' },
        { userId: 'user_1', anonymousId: 'anon_1' },
      ],
      map,
    );
    expect(n).toBe(1);
  });
  it('counts unmapped anon separately', () => {
    const n = resolveDistinct(
      [
        { userId: null, anonymousId: 'anon_1' },
        { userId: null, anonymousId: 'anon_2' },
      ],
      new Map(),
    );
    expect(n).toBe(2);
  });
});
