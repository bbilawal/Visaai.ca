import { AI_TASKS, AI_TASK_NAMES } from '../../src/modules/shared/ai/task-registry';
import { resolveModel } from '../../src/modules/shared/ai/model-policy';
const OLD: Record<string, string> = {
  document_classification: 'gpt-4o (vision path)', field_extraction: 'gpt-4o-mini',
  user_draft_generation: 'gpt-4o', intake_question_generation: 'gpt-4o',
  intake_answer_extraction: 'gpt-4o-mini', form_prefill: 'gpt-4o', vri_assessment: 'gpt-4o',
  visa_category_suggestion: 'gpt-4o-mini', visa_requirement_estimate: 'gpt-4o-mini',
  profile_evaluation: 'gpt-4o', recommendation_copy: 'gpt-4o-mini',
};
const lines = ['| Task | Was | Tier | Model | Effort | Max out | Cacheable | Batch | Threshold |',
               '|---|---|---|---|---|---|---|---|---|'];
for (const n of AI_TASK_NAMES) {
  const t = AI_TASKS[n];
  const m = resolveModel(t.defaultTier);
  lines.push(`| \`${t.name}\` | ${OLD[t.name] ?? '_new_' } | ${t.defaultTier} | \`${m.model}\` | ${m.reasoningEffort} | ${t.maxOutputTokens} | ${t.cacheable ? 'yes' : 'no'} | ${t.batchEligible ? 'yes' : 'no'} | ${(t.qualityThreshold * 100).toFixed(0)}% |`);
}
console.log(lines.join('\n'));
