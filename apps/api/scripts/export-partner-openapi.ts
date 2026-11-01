/**
 * Writes the partner OpenAPI document to docs/partner-api/openapi.json.
 *
 * The checked-in file is a CONVENIENCE for people and tools that want a static
 * URL; `partner-openapi.ts` is the source of truth. Regenerate with
 * `pnpm --filter api openapi:partner` after changing a route.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPartnerOpenApi } from '../src/modules/partner/openapi/partner-openapi';

const target = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'partner-api',
  'openapi.json',
);
writeFileSync(target, `${JSON.stringify(buildPartnerOpenApi(), null, 2)}\n`);
console.log(`wrote ${target}`);
