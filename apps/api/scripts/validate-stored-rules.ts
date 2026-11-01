/**
 * Validate every rule stored in visa_requirements against the rule language.
 *
 * A malformed rule does not error at read time — evaluateRule returns
 * 'unknown' and the requirement renders as "may be required" forever. That is
 * safe but silently wrong, so the validation belongs at the data-quality gate.
 */
import './lib/node20-websocket';
import { createClient } from '@supabase/supabase-js';
import { validateRule, evaluateRule, explainRule } from '../src/modules/visa-rules/rule-evaluator';

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .from('visa_requirements')
    .select('requirement_code, label, rule, status')
    .order('display_order');
  if (error) throw new Error(error.message);

  let bad = 0;
  for (const r of data ?? []) {
    if (r.rule === null) {
      console.log(`  UNCONDITIONAL  ${r.requirement_code}`);
      continue;
    }
    const errs = validateRule(r.rule);
    if (errs.length) {
      bad++;
      console.log(`  INVALID        ${r.requirement_code}: ${errs.map((e) => `${e.path} ${e.message}`).join('; ')}`);
      continue;
    }
    // With no facts supplied every conditional rule must be 'unknown', never
    // 'false' — a requirement must not vanish before the applicant is asked.
    const empty = evaluateRule(r.rule as never, {});
    console.log(`  VALID          ${r.requirement_code}  no-facts=${empty}  "${explainRule(r.rule as never)}"`);
    if (empty === 'false') {
      bad++;
      console.log(`     ^ REJECTED: evaluates false with no facts, so it would disappear from the checklist`);
    }
  }
  console.log(bad === 0 ? '\nAll rules valid.' : `\n${bad} rule problem(s).`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
