import { audienceSummary } from './broadcast-audience';

describe('audienceSummary', () => {
  it('summarizes all', () => {
    expect(audienceSummary({ kind: 'all' })).toBe('All users');
  });
  it('summarizes a role', () => {
    expect(audienceSummary({ kind: 'role', role: 'consultant' })).toBe(
      'Role: consultant',
    );
  });
  it('summarizes explicit users (singular + plural)', () => {
    expect(audienceSummary({ kind: 'users', userIds: ['a'] })).toBe(
      '1 specific user',
    );
    expect(audienceSummary({ kind: 'users', userIds: ['a', 'b'] })).toBe(
      '2 specific users',
    );
  });
});
