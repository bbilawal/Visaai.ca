import { AnalyticsApiExceptionFilter } from './analytics-api.exception-filter';
import {
  UnknownMetricError,
  UnsupportedExportFormatError,
  ReportNotFoundError,
} from './analytics-api.errors';
import {
  InvalidQueryError,
  MetricComputeError,
} from '../../analytics-metrics/contracts/metric.errors';

function fakeHost(): any {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status };
  return {
    host: { switchToHttp: () => ({ getResponse: () => res }) },
    status,
    json,
  };
}

describe('AnalyticsApiExceptionFilter', () => {
  const filter = new AnalyticsApiExceptionFilter();
  it.each([
    [new UnknownMetricError('nope'), 404],
    [new ReportNotFoundError('r1'), 404],
    [new InvalidQueryError('bad'), 400],
    [new UnsupportedExportFormatError('json'), 400],
    [new MetricComputeError('mrr', new Error('x')), 502],
  ])('maps %s to %d', (err, code) => {
    const f = fakeHost();
    filter.catch(err, f.host);
    expect(f.status).toHaveBeenCalledWith(code);
  });
});
