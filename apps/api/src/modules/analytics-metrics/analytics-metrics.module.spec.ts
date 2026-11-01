import { buildMetricRegistry } from './metric.registry';
import { MockKpiSourceRepository } from './source/mock-kpi-source.repository';
import { FinancialMetricsService } from './services/financial-metrics.service';
import { RetentionMetricsService } from './services/retention-metrics.service';
import { GrowthMetricsService } from './services/growth-metrics.service';
import { VisaMetricsService } from './services/visa-metrics.service';
import { ConsultantMetricsService } from './services/consultant-metrics.service';
import { AiMetricsService } from './services/ai-metrics.service';
import { JourneyMetricsService } from './services/journey-metrics.service';

// Composition test (infra-free): the seven services compose into a registry with
// seven distinct keys. Mirrors the module's METRIC_REGISTRY useFactory wiring
// without booting BullMQ / Supabase.
describe('AnalyticsMetrics registry composition', () => {
  it('registers all 7 metric services with distinct keys', () => {
    const src = new MockKpiSourceRepository({});
    const billing = {
      subscriptionMetrics: jest.fn(),
      outstanding: jest.fn(),
    } as any;
    const reports = { report: jest.fn() } as any;

    const services = [
      new FinancialMetricsService(billing, reports, src),
      new RetentionMetricsService(src),
      new GrowthMetricsService(src),
      new VisaMetricsService(src),
      new ConsultantMetricsService(src),
      new AiMetricsService(src),
      new JourneyMetricsService(src),
    ];
    const registry = buildMetricRegistry(services);

    expect(registry.size).toBe(7);
    for (const k of [
      'financial',
      'growth',
      'retention',
      'visa',
      'consultant',
      'ai',
      'journey',
    ]) {
      expect(registry.has(k)).toBe(true);
    }
  });
});
