import { describe, it, expect, beforeEach } from 'vitest';
import { getAnonymousId } from './anonymous-id';

describe('getAnonymousId', () => {
  beforeEach(() => localStorage.clear());

  it('mints once and persists', () => {
    const a = getAnonymousId();
    const b = getAnonymousId();
    expect(a).toBe(b);
    expect(a).toMatch(/[0-9a-f-]{36}/);
  });
});
