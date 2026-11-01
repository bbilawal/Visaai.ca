import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiUsageMeter } from './ai-usage.meter';
import { AiCacheService } from './ai-cache.service';

@Global()
@Module({
  providers: [AiService, AiUsageMeter, AiCacheService],
  exports: [AiService, AiUsageMeter, AiCacheService],
})
export class AiModule {}
