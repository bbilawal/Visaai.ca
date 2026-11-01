import {
  AlertValidationError,
  AlertNotFoundError,
} from './analytics-alerts.errors';

describe('analytics-alerts errors', () => {
  it('AlertNotFoundError names the id', () => {
    const e = new AlertNotFoundError('a1');
    expect(e.id).toBe('a1');
    expect(e instanceof Error).toBe(true);
  });
  it('AlertValidationError carries the message', () => {
    expect(new AlertValidationError('bad').message).toBe('bad');
  });
});
