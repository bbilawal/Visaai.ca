import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { KPI_SOURCE_REPOSITORY } from './kpi-source.repository';
import { SupabaseKpiSourceRepository } from './kpi-source.repository.impl';
import { MockKpiSourceRepository } from './mock-kpi-source.repository';

export const kpiSourceProvider: Provider = {
  provide: KPI_SOURCE_REPOSITORY,
  inject: [ConfigService, SupabaseService],
  useFactory: (config: ConfigService<Env>, supabase: SupabaseService) => {
    const kind = config.get('KPI_SOURCE', { infer: true });
    return kind === 'mock'
      ? new MockKpiSourceRepository({})
      : new SupabaseKpiSourceRepository(supabase);
  },
};
