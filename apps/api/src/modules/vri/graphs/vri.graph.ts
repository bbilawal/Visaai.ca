import { StateGraph, END } from '@langchain/langgraph';
import { SupabaseClient } from '@supabase/supabase-js';
import { VriAnnotation, type VriState } from './vri.state';
import { makeLoadVriDataNode } from './nodes/load-vri-data';
import { scoreDocumentation } from './scoring/score-documentation';
import { scoreFinancial } from './scoring/score-financial';
import { scoreTravelHistory } from './scoring/score-travel-history';
import { scoreHomeTies } from './scoring/score-home-ties';
import { scoreEmployment } from './scoring/score-employment';
import { scoreConsistency } from './scoring/score-consistency';
import { makeAggregateScoreNode } from './nodes/aggregate-score';
import { makeGenerateRecommendationsNode } from './nodes/generate-recommendations';
import { makeSuggestVisaCategoriesNode } from './nodes/suggest-visa-categories';
import { makeSaveVriNode } from './nodes/save-vri';
import type { RiskConfigSnapshot } from '../risk-config.types';
import type { AiUsageMeter } from '../../shared/ai/ai-usage.meter';
import { chatModelForTask } from '../../shared/ai/model-factory';

export function buildVriGraph(
  supabase: SupabaseClient,
  openaiKey: string,
  language: string | null | undefined,
  config: RiskConfigSnapshot,
  meter: AiUsageMeter | undefined,
  ctx: { applicationId: string; userId: string },
  /** Service-role client — ONLY for the SEC-4094-pinned applications.vri_score
   *  denormalisation in the save node. Everything else uses `supabase`. */
  admin: SupabaseClient,
) {
  // Kept for the suggest-visa-categories node, which builds its own model and
  // so still needs the metering context. The scoring model below gets its
  // context from the factory instead.
  const meterCtx = { ...ctx, operation: 'vri' };
  const llm = chatModelForTask('vri_assessment', {
    apiKey: openaiKey,
    meter,
    ctx,
  });

  const graph = new StateGraph(VriAnnotation)
    .addNode('load_data', makeLoadVriDataNode(supabase))
    .addNode('score_documentation', scoreDocumentation)
    .addNode('score_financial', scoreFinancial)
    .addNode('score_travel_history', scoreTravelHistory)
    .addNode('score_home_ties', scoreHomeTies)
    .addNode('score_employment', scoreEmployment)
    .addNode('score_consistency', scoreConsistency)
    .addNode(
      'aggregate',
      makeAggregateScoreNode(config.weights, config.thresholds),
    )
    .addNode(
      'recommend',
      makeGenerateRecommendationsNode(
        llm,
        language,
        config.thresholds.weak_threshold,
      ),
    )
    .addNode(
      'suggest_visa_categories',
      makeSuggestVisaCategoriesNode(openaiKey, language, meter, meterCtx),
    )
    .addNode('save', makeSaveVriNode(supabase, admin, ctx.userId))
    .addEdge('__start__', 'load_data')
    .addEdge('load_data', 'score_documentation')
    .addEdge('score_documentation', 'score_financial')
    .addEdge('score_financial', 'score_travel_history')
    .addEdge('score_travel_history', 'score_home_ties')
    .addEdge('score_home_ties', 'score_employment')
    .addEdge('score_employment', 'score_consistency')
    .addEdge('score_consistency', 'aggregate')
    // self_service tier gets the score + dimension breakdown only. Recommendations
    // and visa-category suggestions require the copilot tier.
    .addConditionalEdges(
      'aggregate',
      (s: VriState) => (s.planTier === 'self_service' ? 'save' : 'recommend'),
      {
        save: 'save',
        recommend: 'recommend',
      },
    )
    .addEdge('recommend', 'suggest_visa_categories')
    .addEdge('suggest_visa_categories', 'save')
    .addEdge('save', END);

  return graph.compile();
}

export type CompiledVriGraph = ReturnType<typeof buildVriGraph>;
