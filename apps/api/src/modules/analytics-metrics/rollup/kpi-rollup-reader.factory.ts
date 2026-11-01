import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { KPI_ROLLUP_READER } from './kpi-rollup.service';
import { KPI_COHORT_READER } from './kpi-cohort.service';
import { SupabaseKpiRollupReader } from './supabase-kpi-rollup.reader';
import { NoopKpiRollupReader } from './kpi-rollup.sources';

export function buildRollupReader(kind: string, supabase: SupabaseService) {
  return kind === 'mock'
    ? new NoopKpiRollupReader()
    : new SupabaseKpiRollupReader(supabase);
}

export const kpiRollupReaderProvider: Provider = {
  provide: KPI_ROLLUP_READER,
  inject: [ConfigService, SupabaseService],
  useFactory: (config: ConfigService<Env>, supabase: SupabaseService) =>
    buildRollupReader(
      config.get('KPI_SOURCE', { infer: true }) ?? 'supabase',
      supabase,
    ),
};

// Same instance implements both KpiRollupReader + CohortReader.
export const kpiCohortReaderProvider: Provider = {
  provide: KPI_COHORT_READER,
  inject: [KPI_ROLLUP_READER],
  useFactory: (reader: unknown) => reader,
};
