import { Module } from '@nestjs/common';
import { NarrativeController } from './narrative.controller';
import { NarrativeService } from './narrative.service';

@Module({
  controllers: [NarrativeController],
  providers: [NarrativeService],
})
export class NarrativeModule {}
