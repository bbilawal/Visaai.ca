import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { WAREHOUSE_PROVIDER, IWarehouseProvider } from './warehouse.provider';
import { SupabaseWarehouseProvider } from './supabase-warehouse.provider';
import { MockWarehouseProvider } from './mock-warehouse.provider';

export const warehouseProvider: Provider = {
  provide: WAREHOUSE_PROVIDER,
  inject: [ConfigService, SupabaseService],
  useFactory: (
    config: ConfigService<Env>,
    supabase: SupabaseService,
  ): IWarehouseProvider => {
    const kind = config.get('ANALYTICS_WAREHOUSE', { infer: true });
    return kind === 'mock'
      ? new MockWarehouseProvider()
      : new SupabaseWarehouseProvider(supabase);
  },
};
