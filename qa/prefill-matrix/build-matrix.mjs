/**
 * Emits the country × visa-program matrix the prefill run walks, straight from
 * the compiled strategy registry — so the matrix can never claim a pair the
 * backend cannot resolve (and never miss one it can).
 *
 *   pnpm --filter api build && node qa/prefill-matrix/build-matrix.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const require = createRequire(join(REPO, 'apps', 'api', 'package.json'));
const { strategyRegistry } = require(join(REPO, 'apps', 'api', 'dist', 'strategies'));

const countries = strategyRegistry.listCountries();
const pairs = [];

for (const { code, name, programs } of countries) {
  for (const programId of programs) {
    const resolved = strategyRegistry.resolve(code, programId);
    if (!resolved) throw new Error(`registry lists ${code}/${programId} but cannot resolve it`);
    const { country, program } = resolved;
    pairs.push({
      countryCode: code,
      countryName: name,
      programId,
      label: program.label,
      portalId: country.portal().portalId,
      documents: program.requiredDocuments().map((d) => ({
        code: d.code,
        label: d.label,
        required: d.required !== false,
        ownedBy: d.ownedBy ?? 'applicant',
      })),
      forms: (program.forms?.() ?? []).map((f) => ({
        formCode: f.formCode,
        formName: f.formName,
        sourceUrl: f.sourceUrl ?? null,
      })),
    });
  }
}

mkdirSync(HERE, { recursive: true });
const out = join(HERE, 'matrix.json');
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), countries: countries.length, pairs }, null, 2) + '\n');
console.log(`matrix: ${countries.length} countries, ${pairs.length} country×program pairs -> ${out}`);
