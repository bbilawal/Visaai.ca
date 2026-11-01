/**
 * QA discovery probe — dumps the AUTHORITATIVE product inventory straight from
 * the backend strategy registry, so the E2E matrix is derived from the product
 * rather than from anyone's assumptions.
 *
 * Run from apps/api:
 *   node_modules/.bin/ts-node -T --project tsconfig.json \
 *     ../../qa/visaai-autonomous-e2e/fixtures/dump-inventory.ts
 */
import '../../../apps/api/src/strategies/index';
import { strategyRegistry } from '../../../apps/api/src/strategies';

const countries = strategyRegistry.listCountries();

const call = <T>(fn: (() => T) | undefined, fallback: T): T => {
  try {
    return fn ? fn() : fallback;
  } catch {
    return fallback;
  }
};

const rows = countries.flatMap((c) => {
  const country = strategyRegistry.getCountry(c.code)!;
  return country.programs().map((p) => {
    const prog = p as unknown as {
      forms?: () => { formCode: string; formName: string }[];
      documents?: () => { code: string; required: boolean }[];
      eligibilityChecks?: () => { id: string }[];
      validationRules?: () => { id: string; severity: string }[];
      evidenceRules?: () => { id: string }[];
      riskSignals?: () => { id: string; weight: number }[];
    };
    return {
      country_code: c.code,
      country_name: c.name,
      program_id: p.id,
      program_label: (p as { label?: string }).label ?? p.id,
      forms: call(prog.forms, []).map((f) => f.formCode),
      documents: call(prog.documents, []).map(
        (d) => `${d.code}${d.required ? '*' : ''}`,
      ),
      eligibility_checks: call(prog.eligibilityChecks, []).map((e) => e.id),
      validation_rules: call(prog.validationRules, []).map(
        (v) => `${v.id}:${v.severity}`,
      ),
      evidence_rules: call(prog.evidenceRules, []).map((e) => e.id),
      risk_signals: call(prog.riskSignals, []).map((r) => `${r.id}@${r.weight}`),
    };
  });
});

console.log(
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      selectable_country_count: countries.length,
      matrix_row_count: rows.length,
      countries,
      rows,
    },
    null,
    2,
  ),
);
