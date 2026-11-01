import { Module } from '@nestjs/common';
import { VisaController } from './visa.controller';
import { VisaOrchestrationEngine } from './visa-orchestration.service';
import {
  CopywriterAgent,
  ProfileEvaluatorAgent,
  VisaResearchAgent,
} from './visa.agents';
import { visaOpenAiProvider } from './openai.provider';

/**
 * VisaModule — multi-agent visa-guidance pipeline.
 * research (gpt-4o-mini) -> evaluation (gpt-4o) -> copywriter (gpt-4o-mini),
 * orchestrated sequentially with strict Zod-typed inter-agent contracts.
 */
@Module({
  controllers: [VisaController],
  providers: [
    visaOpenAiProvider,
    VisaResearchAgent,
    ProfileEvaluatorAgent,
    CopywriterAgent,
    VisaOrchestrationEngine,
  ],
  exports: [VisaOrchestrationEngine],
})
export class VisaModule {}
