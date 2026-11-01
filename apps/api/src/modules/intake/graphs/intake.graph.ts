import { StateGraph, END } from '@langchain/langgraph';
import { SupabaseClient } from '@supabase/supabase-js';
import { IntakeAnnotation, IntakeState } from './intake.state';
import type { AiUsageMeter } from '../../shared/ai/ai-usage.meter';
import { chatModelForTask } from '../../shared/ai/model-factory';
import { makeLoadFrameworkNode } from './nodes/load-framework';
import {
  makeAskQuestionNode,
  type AskQuestionHooks,
} from './nodes/ask-question';
import { makeProcessAnswerNode } from './nodes/process-answer';
import { makeUpdateProfileNode } from './nodes/update-profile';
import { checkComplete, intakeRouter } from './nodes/check-complete';
import { makeConfirmUpdateNode } from './nodes/confirm-update';

/**
 * Wraps a node so its wall-clock cost lands in the logs.
 *
 * The reason this exists rather than a profiler: the turn's latency is a
 * property of the WIRING, and the wiring is what changes. When update_checklist
 * moved off the critical path, the only way to say by how much — rather than
 * assert it — was to have each node's duration written down. It also makes the
 * next regression visible: a node that quietly doubles shows up here before an
 * applicant reports it.
 *
 * Logged on failure too, via `finally` — a node that times out is exactly the
 * one whose duration you want.
 */
function timed<S, R>(
  name: string,
  node: (state: S) => Promise<R>,
): (state: S) => Promise<R> {
  return async (state: S): Promise<R> => {
    const startedAt = Date.now();
    try {
      return await node(state);
    } finally {
      console.log(`[intake:timing] ${name} ${Date.now() - startedAt}ms`);
    }
  };
}

// Routes __start__ based on whether the user has sent a message.
// First run (no messages or last message is AI): load framework then ask.
// Subsequent runs (last message is human): process the answer.
function entryRouter(state: IntakeState): 'load_framework' | 'process_answer' {
  const msgs = state.messages;
  if (msgs.length > 0 && msgs[msgs.length - 1].getType() === 'human') {
    return 'process_answer';
  }
  return 'load_framework';
}

export function buildIntakeGraph(
  supabase: SupabaseClient,
  openaiKey: string,
  language?: string | null,
  meter?: AiUsageMeter,
  ctx?: { applicationId?: string | null; userId?: string | null },
  /**
   * Optional live hooks for the applicant-facing question: chunks as it is
   * written, and the finished text the moment it exists. Supplied by the socket
   * gateway; omitted everywhere else, which keeps the single-shot path for
   * tests and batch callers.
   */
  questionHooks?: AskQuestionHooks,
) {
  // The user-facing turn (the question text a person reads) and the
  // behind-the-scenes extraction are separate registry tasks, so they meter
  // separately: 'intake' as a single operation could never show which half of
  // the graph the money went to.
  const llm = chatModelForTask('intake_question_generation', {
    apiKey: openaiKey,
    meter,
    ctx,
  });
  const cheapLlm = chatModelForTask('intake_answer_extraction', {
    apiKey: openaiKey,
    meter,
    ctx,
  });

  const graph = new StateGraph(IntakeAnnotation)
    .addNode(
      'load_framework',
      timed('load_framework', makeLoadFrameworkNode(supabase)),
    )
    .addNode(
      'ask_question',
      timed('ask_question', makeAskQuestionNode(llm, language, questionHooks)),
    )
    .addNode(
      'process_answer',
      timed('process_answer', makeProcessAnswerNode(cheapLlm, language)),
    )
    .addNode(
      'update_profile',
      timed('update_profile', makeUpdateProfileNode(supabase)),
    )
    .addNode('check_complete', timed('check_complete', checkComplete))
    .addNode(
      'confirm_update',
      timed(
        'confirm_update',
        makeConfirmUpdateNode(llm, language, questionHooks),
      ),
    )
    .addConditionalEdges('__start__', entryRouter, {
      load_framework: 'load_framework',
      process_answer: 'process_answer',
    })
    .addEdge('load_framework', 'ask_question')
    .addEdge('ask_question', END)
    .addEdge('process_answer', 'update_profile')
    // The checklist is NOT here, and its absence is the point.
    //
    // update_checklist derives the document requirements. Outside Canada — the
    // only country with a `country_framework` — that means `discoveryChecklist`,
    // a full structured generation, measured at 9.4–10.0s on production. It ran
    // on EVERY turn of the interview, and for most of that history it ran in
    // front of the reply, so the applicant paid all of it before reading a word.
    //
    // Pairing it with ask_question got it off the critical path but not off the
    // bill: the same generation still fired every turn, rebuilding a list that
    // an applicant answering questions is not yet reading. It now runs once,
    // on demand, when they actually go to their documents —
    // IntakeService.rebuildChecklist. What used to be N generations per intake
    // is one.
    //
    // The interview does not depend on it. ask_question is told what is already
    // tracked so it does not repeat itself, and a stale-by-one-turn list is a
    // strictly smaller problem than a 10s generation per answer.
    .addEdge('update_profile', 'check_complete')
    .addConditionalEdges('check_complete', intakeRouter, {
      ask_question: 'ask_question',
      confirm_update: 'confirm_update',
    })
    .addEdge('confirm_update', END);

  return graph.compile();
}

export type CompiledIntakeGraph = ReturnType<typeof buildIntakeGraph>;
