import { Injectable, Logger } from '@nestjs/common';
import {
  CopywriterAgent,
  ProfileEvaluatorAgent,
  VisaResearchAgent,
} from './visa.agents';
import type { VisaAnalysis } from './visa.schemas';

export interface VisaAnalysisInput {
  country: string;
  visaType: string;
  profile: string;
  notes?: string;
  /** User's preferred UI language; drives the language of generated prose and
   *  free-text fields. null/en => English (no change). */
  language?: string | null;
}

/** Stage label surfaced when a single agent fails (error isolation). */
export class VisaStageError extends Error {
  constructor(
    readonly stage: 'research' | 'evaluation' | 'copywriter',
    message: string,
  ) {
    super(message);
    this.name = 'VisaStageError';
  }
}

/**
 * VisaOrchestrationEngine — sequential, error-isolated 3-agent pipeline:
 *   research (gpt-4o-mini) -> evaluation (gpt-4o) -> copywriter (gpt-4o-mini)
 *
 * One model call per agent (no redundancy); only typed objects cross stages;
 * each stage failure is isolated + labelled. Deterministic (temperature 0).
 */
@Injectable()
export class VisaOrchestrationEngine {
  private readonly log = new Logger(VisaOrchestrationEngine.name);

  constructor(
    private readonly research: VisaResearchAgent,
    private readonly evaluator: ProfileEvaluatorAgent,
    private readonly copywriter: CopywriterAgent,
  ) {}

  async run(input: VisaAnalysisInput): Promise<VisaAnalysis> {
    const research = await this.stage('research', () =>
      this.research.run(
        input.country,
        input.visaType,
        input.notes,
        input.language,
      ),
    );
    const evaluation = await this.stage('evaluation', () =>
      this.evaluator.run(research, input.profile, input.language),
    );
    const report = await this.stage('copywriter', () =>
      this.copywriter.run(research, evaluation, input.language),
    );
    return { research, evaluation, report };
  }

  private async stage<T>(
    stage: VisaStageError['stage'],
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.log.error(`visa pipeline stage "${stage}" failed: ${msg}`);
      throw new VisaStageError(stage, msg);
    }
  }
}
