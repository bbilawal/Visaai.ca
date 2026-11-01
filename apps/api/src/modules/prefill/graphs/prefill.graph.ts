import { StateGraph, END } from '@langchain/langgraph';
import { SupabaseClient } from '@supabase/supabase-js';
import { PrefillAnnotation } from './prefill.state';
import { makeLoadContextNode } from './nodes/load-context';
import { makeGenerateFieldsNode } from './nodes/generate-fields';
import { makeStorePrefillNode } from './nodes/store-prefill';
import type { AiUsageMeter } from '../../shared/ai/ai-usage.meter';
import { chatModelForTask } from '../../shared/ai/model-factory';

export function buildPrefillGraph(
  supabase: SupabaseClient,
  openaiKey: string,
  language?: string | null,
  meter?: AiUsageMeter,
  ctx?: { applicationId?: string | null; userId?: string | null },
) {
  const llm = chatModelForTask('form_prefill', {
    apiKey: openaiKey,
    meter,
    ctx,
  });

  const graph = new StateGraph(PrefillAnnotation)
    .addNode('load_context', makeLoadContextNode(supabase))
    .addNode('generate_fields', makeGenerateFieldsNode(llm, language))
    .addNode('store_prefill', makeStorePrefillNode(supabase))
    .addEdge('__start__', 'load_context')
    .addEdge('load_context', 'generate_fields')
    .addEdge('generate_fields', 'store_prefill')
    .addEdge('store_prefill', END);

  return graph.compile();
}

export type CompiledPrefillGraph = ReturnType<typeof buildPrefillGraph>;
