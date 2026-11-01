import { StateGraph, END } from '@langchain/langgraph';
import { SupabaseClient } from '@supabase/supabase-js';
import { NarrativeAnnotation } from './narrative.state';
import { makeLoadNarrativeDataNode } from './nodes/load-narrative-data';
import { makeDraftDocumentNode } from './nodes/draft-document';
import { makeSelfReviewNode, reviewRouter } from './nodes/self-review';
import {
  makeFinalizeDocumentNode,
  type KeepPreviousLetter,
} from './nodes/finalize-document';
import type { AiUsageMeter } from '../../shared/ai/ai-usage.meter';
import { chatModelForTask } from '../../shared/ai/model-factory';

export function buildNarrativeGraph(
  supabase: SupabaseClient,
  openaiKey: string,
  language?: string | null,
  meter?: AiUsageMeter,
  ctx?: { applicationId?: string | null; userId?: string | null },
  keepPrevious?: KeepPreviousLetter,
) {
  // Model, output budget, timeout and metering label all come from the
  // registry entry. PRICE-8 metering is attached by the factory, so it can no
  // longer drift from the model actually used.
  const llm = chatModelForTask('user_draft_generation', {
    apiKey: openaiKey,
    meter,
    ctx,
  });

  const graph = new StateGraph(NarrativeAnnotation)
    .addNode('load_data', makeLoadNarrativeDataNode(supabase))
    .addNode('draft_document', makeDraftDocumentNode(llm, language))
    .addNode('self_review', makeSelfReviewNode(llm, language))
    .addNode('finalize', makeFinalizeDocumentNode(supabase, keepPrevious))
    .addEdge('__start__', 'load_data')
    .addEdge('load_data', 'draft_document')
    .addEdge('draft_document', 'self_review')
    .addConditionalEdges('self_review', reviewRouter, {
      draft: 'draft_document',
      finalize: 'finalize',
    })
    .addEdge('finalize', END);

  return graph.compile();
}

export type CompiledNarrativeGraph = ReturnType<typeof buildNarrativeGraph>;
