#!/usr/bin/env node
/**
 * CycloneDX SBOM generator for this pnpm workspace.
 *
 * WHY NOT @cyclonedx/cyclonedx-npm
 *   It shells out to `npm ls`, which cannot read pnpm's symlinked store layout.
 *   In this repository it fails with "failed to parse npm-ls response" every
 *   time. The CI step that called it was written as
 *   `... || echo "::warning::SBOM generation failed (non-blocking)"`, so it has
 *   been failing silently — the job stayed green and the uploaded artifact was
 *   never produced. A supply-chain control that cannot fail is not a control.
 *
 * WHAT THIS DOES
 *   Reads `pnpm licenses list --json`, which enumerates every package actually
 *   present in the resolved dependency graph, and emits CycloneDX 1.5 JSON.
 *   It also flags licences that need a human decision before shipping.
 *
 * USAGE
 *   node infra/scripts/generate-sbom.mjs [--out sbom.json] [--fail-on-restrictive]
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT = outIndex >= 0 ? args[outIndex + 1] : 'sbom.json';
const FAIL_ON_RESTRICTIVE = args.includes('--fail-on-restrictive');

/**
 * Licences that make shipping a proprietary hosted product a legal question
 * rather than an engineering one. LGPL is deliberately absent: dynamic linking
 * of an npm dependency does not trigger its copyleft the way GPL does.
 */
const RESTRICTIVE = /^(GPL|AGPL|SSPL|CC-BY-SA|EUPL|OSL|CPAL|BUSL)/i;

let raw;
try {
  raw = execFileSync('pnpm', ['licenses', 'list', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error('pnpm licenses list failed:', err.message);
  process.exit(1);
}

const byLicense = JSON.parse(raw);
const components = [];
const restrictive = [];
const undeclared = [];

for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    for (const version of pkg.versions ?? []) {
      components.push({
        type: 'library',
        'bom-ref': `pkg:npm/${pkg.name}@${version}`,
        name: pkg.name,
        version,
        purl: `pkg:npm/${encodeURIComponent(pkg.name).replace('%40', '@')}@${version}`,
        description: pkg.description ?? undefined,
        author: pkg.author ?? undefined,
        licenses:
          license && license !== 'Unknown'
            ? [{ license: { id: license } }]
            : undefined,
        externalReferences: pkg.homepage
          ? [{ type: 'website', url: pkg.homepage }]
          : undefined,
      });

      if (RESTRICTIVE.test(license)) restrictive.push(`${pkg.name}@${version} (${license})`);
      if (!license || license === 'Unknown') undeclared.push(`${pkg.name}@${version}`);
    }
  }
}

components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'VisaAI', name: 'generate-sbom.mjs', version: '1.0.0' }],
    component: { type: 'application', name: 'visaai', 'bom-ref': 'pkg:generic/visaai' },
  },
  components,
};

writeFileSync(OUT, JSON.stringify(bom, null, 2));

console.log(`SBOM written: ${OUT}`);
console.log(`  components:        ${components.length}`);
console.log(`  licence groups:    ${Object.keys(byLicense).length}`);
console.log(`  undeclared licence: ${undeclared.length}`);
if (restrictive.length) {
  console.log(`  RESTRICTIVE (${restrictive.length}) — needs a licensing decision:`);
  for (const r of restrictive) console.log(`    ${r}`);
} else {
  console.log('  restrictive:       none');
}

if (FAIL_ON_RESTRICTIVE && restrictive.length) {
  console.error('::error::restrictive licences present in the dependency graph');
  process.exit(1);
}
