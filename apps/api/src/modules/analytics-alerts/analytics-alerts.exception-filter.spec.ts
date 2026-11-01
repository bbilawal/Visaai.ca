import { AnalyticsAlertsExceptionFilter } from './analytics-alerts.exception-filter';
import {
  AlertValidationError,
  AlertNotFoundError,
} from './analytics-alerts.errors';

function host() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    h: { switchToHttp: () => ({ getResponse: () => ({ status }) }) },
    status,
  };
}
describe('AnalyticsAlertsExceptionFilter', () => {
  const f = new AnalyticsAlertsExceptionFilter();
  it.each([
    [new AlertValidationError('bad'), 400],
    [new AlertNotFoundError('a1'), 404],
  ] as const)('%s -> %d', (e, code) => {
    const x = host();
    f.catch(e, x.h as any);
    expect(x.status).toHaveBeenCalledWith(code);
  });
});
