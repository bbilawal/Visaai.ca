#!/usr/bin/env node
/**
 * DEP-001 gate: fail only when a flagged package is reachable from an app we
 * actually deploy.
 *
 * The Phase 8 audit found 18 advisories, of which ZERO could be reached from
 * `apps/api` or `apps/web`. The Critical one needed `vitest --ui` to be running;
 * `image-size` and `ip-address` come from the Expo/Metro toolchain. Failing the
 * build on those trains everyone to ignore the scanner, which is how a real one
 * gets waved through.
 *
 * So severity is not the gate. REACHABILITY is.
 *
 * Method matters here. `pnpm why` run inside `apps/api` resolves against the
 * WORKSPACE ROOT and cheerfully reports mobile-only packages as API
 * dependencies — it produced four false positives during the audit.
 * `require.resolve(pkg, { paths: [app] })` answers the question the running
 * server actually asks.
 *
 * Maintaining the list: when osv-scanner reports something new, add it here
 * with the advisory id. If it is NOT reachable the gate stays green and the
 * entry documents why; if it IS reachable the build fails until it is upgraded.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** Apps whose node_modules end up on a production host. */
const DEPLOYED = ['apps/api', 'apps/web'];

/** Packages currently carrying an advisory (osv-scanner, 2026-08-09). */
const FLAGGED = [
  { name: 'image-size', advisories: ['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr'] },
  { name: 'ip-address', advisories: ['GHSA-mwp4-54f8-5fhr', 'GHSA-22jq-vg5j-6vgg', 'GHSA-4xrf-jv44-h6hh'] },
  { name: 'body-parser', advisories: ['GHSA-v422-hmwv-36x6'] },
  { name: 'esbuild', advisories: ['GHSA-67mh-4wv8-2f99'] },
  { name: 'uuid', advisories: ['GHSA-w5hq-g745-h8pq'] },
];

const reachable = [];
for (const { name, advisories } of FLAGGED) {
  for (const app of DEPLOYED) {
    try {
      const entry = require.resolve(`${name}/package.json`, { paths: [resolve(ROOT, app)] });
      const { version } = require(entry);
      reachable.push({ name, version, app, advisories });
    } catch {
      // Not resolvable from this app — the advisory cannot affect it.
    }
  }
}

if (reachable.length > 0) {
  for (const r of reachable) {
    console.error(
      `::error::${r.name}@${r.version} is resolvable from ${r.app} and carries ${r.advisories.join(', ')}. ` +
        `Upgrade it, or remove it from FLAGGED in scripts/check-vulnerable-deps.mjs once the advisory is withdrawn.`,
    );
  }
  process.exit(1);
}

console.log(
  `dependency gate: ${FLAGGED.length} flagged package(s) checked against ${DEPLOYED.join(', ')} — none reachable`,
);
